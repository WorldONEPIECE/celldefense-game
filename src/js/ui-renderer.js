import EventBus, { EVENTS } from './engine/event-bus.js';

export class UIRenderer {
  constructor(resources, gameState, i18n) {
    this._res = resources; this._state = gameState; this._i18n = i18n;
  }

  init() {
    const btn = document.getElementById('btn-end-turn');
    if (btn) { btn.addEventListener('click', () => window.CellDefense?.endTurn()); btn.textContent = this._i18n.get('ui.buttons.end_turn'); }
    this.renderAll();
    console.log('[UIRenderer] Initialized.');
  }

  renderAll() { this.renderResourcePanel(); this.renderTurnInfo(); this.renderHandArea(); this.renderVirusPanel(); }

  renderResourcePanel() {
    const panel = document.getElementById('resource-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (const state of this._res.getAllStates()) {
      const label = this._i18n.get(state.display_key);
      const pct = state.max > 0 ? (state.current / state.max) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'resource-row';
      row.innerHTML = `
        <div class="resource-label">
          <span class="resource-icon">${state.icon}</span>
          <span class="resource-name">${label}</span>
        </div>
        <div class="resource-bar-wrap">
          <div class="resource-bar ${state.is_negative ? 'bar-negative' : 'bar-positive'}" style="width:${pct}%;background:${state.color};"></div>
        </div>
        <div class="resource-value">${state.current}<span class="resource-max">/${state.max}</span></div>`;
      panel.appendChild(row);
    }
  }

  renderTurnInfo() {
    const el = document.getElementById('turn-info');
    if (!el) return;
    const turnLabel = this._i18n.get('ui.turn.turn_count', { n: this._state.turnCount });
    const phaseKey = this._state.phase === 'player_turn' ? 'ui.turn.player_turn'
      : this._state.phase === 'virus_turn' ? 'ui.turn.virus_turn' : 'ui.turn.settlement';
    el.innerHTML = `<span class="turn-count">${turnLabel}</span><span class="turn-phase">${this._i18n.get(phaseKey)}</span>`;
    const btn = document.getElementById('btn-end-turn');
    if (btn) btn.disabled = this._state.phase !== 'player_turn' || this._state.isGameOver;
  }

  renderHandArea() {
    const area = document.getElementById('hand-area');
    if (!area) return;
    area.innerHTML = '';
    for (const card of this._state.hand) area.appendChild(this._createCardElement(card));
    if (this._state.hand.length === 0) {
      const p = document.createElement('div'); p.className = 'hand-placeholder'; p.textContent = '手牌加载中 (T4实现)'; area.appendChild(p);
    }
  }

  _createCardElement(card) {
    const el = document.createElement('div');
    el.className = 'card'; el.dataset.cardId = card.id;
    const name = this._i18n.get(`cards.${card.id}.name`);
    const desc = this._i18n.get(`cards.${card.id}.description`);
    const costStr = Object.entries(card.cost || {}).map(([r, a]) => `${a} ${this._i18n.get(`ui.resources.${r}}`)}`).join(' + ');
    el.innerHTML = `
      <div class="card-art" style="background:${card.color_placeholder || '#334'}"><span class="card-art-label">${name[0]}</span></div>
      <div class="card-body"><div class="card-name">${name}</div><div class="card-cost">${costStr}</div><div class="card-desc">${desc}</div></div>`;
    el.addEventListener('click', () => window.CellDefense?.playCard?.(card.id));
    return el;
  }

  renderVirusPanel() {
    const panel = document.getElementById('virus-panel');
    if (!panel) return;
    const virus = this._state.currentVirus;
    if (!virus) { panel.innerHTML = `<div class="virus-placeholder">等待病毒入侵 (T6实现)</div>`; return; }
    const name = this._i18n.get(`viruses.${virus.id}.name`);
    const vl = this._res.get('viral_load'), maxVl = this._res.getState('viral_load').max;
    panel.innerHTML = `
      <div class="virus-name">${name}</div>
      <div class="virus-load-wrap"><span>病毒载量</span>
        <div class="virus-load-bar-bg"><div class="virus-load-bar" style="width:${(vl/maxVl)*100}%"></div></div>
        <span>${vl}/${maxVl}</span></div>`;
  }

  showGameOver(isVictory) {
    const overlay = document.getElementById('gameover-overlay');
    if (!overlay) return;
    overlay.innerHTML = `<div class="gameover-box ${isVictory ? 'victory' : 'defeat'}">
      <h2>${this._i18n.get(isVictory ? 'ui.game_over.victory' : 'ui.game_over.defeat')}</h2>
      <button onclick="location.reload()">${this._i18n.get('ui.game_over.restart')}</button></div>`;
    overlay.style.display = 'flex';
  }
}
