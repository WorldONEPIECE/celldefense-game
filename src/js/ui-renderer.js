/**
 * ui-renderer.js — 2D界面渲染器
 *
 * v1.1 T7：接收 globalCfg，过载警告 + 潜伏状态显示，
 *          牌堆数量，手牌可用/不可用视觉区分
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

export class UIRenderer {
  constructor(resources, gameState, i18n, globalCfg = {}) {
    this._res       = resources;
    this._state     = gameState;
    this._i18n      = i18n;
    this._globalCfg = globalCfg;
  }

  init() {
    const btn = document.getElementById('btn-end-turn');
    if (btn) {
      btn.addEventListener('click', () => window.CellDefense?.endTurn());
      btn.textContent = this._i18n.get('ui.buttons.end_turn');
    }
    this.renderAll();
    console.log('[UIRenderer] Initialized.');
  }

  renderAll() {
    this.renderResourcePanel();
    this.renderTurnInfo();
    this.renderHandArea();
    this.renderVirusPanel();
  }

  renderResourcePanel() {
    const panel = document.getElementById('resource-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (const state of this._res.getAllStates()) {
      const label = this._i18n.get(state.display_key);
      const pct   = state.max > 0 ? Math.min((state.current / state.max) * 100, 100) : 0;
      const row   = document.createElement('div');
      row.className = 'resource-row';
      row.innerHTML = `
        <div class="resource-label">
          <span class="resource-icon">${state.icon}</span>
          <span class="resource-name">${label}</span>
        </div>
        <div class="resource-bar-wrap">
          <div class="resource-bar ${state.is_negative ? 'bar-negative' : 'bar-positive'}"
               style="width:${pct}%;background:${state.color};"></div>
        </div>
        <div class="resource-value">${Math.floor(state.current)}<span class="resource-max">/${state.max}</span></div>`;
      panel.appendChild(row);
    }
  }

  renderTurnInfo() {
    const el = document.getElementById('turn-info');
    if (!el) return;
    const turnLabel = this._i18n.get('ui.turn.turn_count', { n: this._state.turnCount });
    const phaseKey  = {
      player_turn: 'ui.turn.player_turn',
      virus_turn:  'ui.turn.virus_turn',
      settlement:  'ui.turn.settlement',
    }[this._state.phase] ?? 'ui.turn.player_turn';
    const deckSz    = this._state.deck.length;
    const handSz    = this._state.hand.length;
    const discardSz = this._state.discard.length;
    const overloadBadge = this._state.isOverloaded
      ? `<span class="status-badge badge-overload">${this._i18n.get('ui.status.overloaded')}</span>`
      : '';
    el.innerHTML = `
      <span class="turn-count">${turnLabel}</span>
      <span class="turn-phase">${this._i18n.get(phaseKey)}</span>
      ${overloadBadge}
      <span class="deck-info">🃏${handSz}&nbsp;📦${deckSz}&nbsp;🗑${discardSz}</span>`;
    const btn = document.getElementById('btn-end-turn');
    if (btn) btn.disabled = this._state.phase !== 'player_turn' || this._state.isGameOver;
  }

  renderHandArea() {
    const area = document.getElementById('hand-area');
    if (!area) return;
    area.innerHTML = '';
    if (this._state.hand.length === 0) {
      const ph = document.createElement('div');
      ph.className = 'hand-placeholder';
      ph.textContent = '（手牌为空）';
      area.appendChild(ph);
      return;
    }
    for (const card of this._state.hand) area.appendChild(this._createCardElement(card));
  }

  _createCardElement(card) {
    const el       = document.createElement('div');
    el.dataset.cardId = card.id;
    const name     = this._i18n.get(`cards.${card.id}.name`);
    const desc     = this._i18n.get(`cards.${card.id}.description`);
    const cost     = card.cost || {};
    const canPay   = this._res.canAfford(cost);
    const nullified = this._state.isCardNullified?.(card.id) ?? false;

    let conditionMet = true;
    if (card.play_condition) {
      const val = this._res.get(card.play_condition.resource ?? 'viral_load');
      conditionMet = card.play_condition.type === 'resource_gte'
        ? val >= card.play_condition.value : true;
    }

    const playable = canPay && conditionMet && !nullified
      && this._state.phase === 'player_turn' && !this._state.isGameOver;

    el.className = `card ${playable ? 'card-playable' : 'card-unplayable'}${nullified ? ' card-nullified' : ''}`;

    const costStr = Object.entries(cost)
      .map(([res, amt]) => `${amt}${this._i18n.get(`ui.resources.${res}`)}`).join('+');

    el.innerHTML = `
      <div class="card-art" style="background:${card.color_placeholder || '#334'};">
        <span class="card-rarity rarity-${card.rarity || 'common'}">${(card.rarity?.[0] ?? 'C').toUpperCase()}</span>
      </div>
      <div class="card-body">
        <div class="card-name">${name}</div>
        <div class="card-cost">${costStr || '免费'}</div>
        <div class="card-desc">${desc}</div>
        ${nullified ? '<div class="card-nullified-note">⛔ 效果已被病毒废除</div>' : ''}
      </div>`;

    el.addEventListener('click', () => { if (playable) window.CellDefense?.playCard(card.id); });
    return el;
  }

  renderVirusPanel() {
    const panel = document.getElementById('virus-panel');
    if (!panel) return;
    const virus = this._state.currentVirus;
    if (!virus) {
      panel.innerHTML = '<div class="virus-placeholder">等待病毒入侵</div>';
      return;
    }
    const name        = this._i18n.get(`viruses.${virus.id}.name`);
    const viralLoad   = Math.floor(this._res.get('viral_load'));
    const maxLoad     = this._res.getState('viral_load').max;
    const overloadTh  = this._globalCfg.viral_load_overload_threshold ?? 20;
    const loadPct     = Math.min((viralLoad / maxLoad) * 100, 100);
    const thresholdPct = (overloadTh / maxLoad) * 100;
    const isOverloaded = this._state.isOverloaded;
    const overloadBonus = this._globalCfg.overload_replication_bonus ?? 1;

    panel.innerHTML = `
      <div class="virus-name">${name}</div>
      <div class="virus-genome">${virus.genome_type ?? ''}</div>
      <div class="virus-load-section">
        <div class="virus-load-label">
          <span>病毒载量</span>
          <span class="${isOverloaded ? 'load-value-overload' : ''}">${viralLoad} / ${maxLoad}</span>
        </div>
        <div class="virus-load-bar-bg">
          <div class="virus-load-bar ${isOverloaded ? 'bar-overloaded' : ''}" style="width:${loadPct}%;"></div>
          <div class="overload-threshold-line" style="left:${thresholdPct}%;" title="过载阈值 ${overloadTh}"></div>
        </div>
      </div>
      ${isOverloaded ? `<div class="overload-warning">${this._i18n.get('ui.status.overloaded')} — 增殖+${overloadBonus}</div>` : ''}
      <div class="virus-rep">增殖速度: +${virus.replication_per_turn}${isOverloaded ? ` (+${overloadBonus}过载)` : ''}/回合</div>`;
  }

  showGameOver(isVictory) {
    const overlay = document.getElementById('gameover-overlay');
    if (!overlay) return;
    const msgKey = isVictory ? 'ui.game_over.victory' : 'ui.game_over.defeat';
    overlay.innerHTML = `
      <div class="gameover-box ${isVictory ? 'victory' : 'defeat'}">
        <h2>${this._i18n.get(msgKey)}</h2>
        <p>共经历 ${this._state.turnCount - 1} 个回合</p>
        <button onclick="location.reload()">${this._i18n.get('ui.game_over.restart')}</button>
      </div>`;
    overlay.style.display = 'flex';
  }
}
