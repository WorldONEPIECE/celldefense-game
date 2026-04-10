/**
 * ui-renderer.js — 2D界面渲染器
 *
 * v1.3 T17：
 *   - _createCardElement() 新增 mouseenter/mouseleave：hover卡牌时弹出学术注释 Tooltip
 *   - _showTooltip(card, cardEl)：定位并显示 #card-tooltip，内容来自 card.academic_note
 *   - _hideTooltip()：隐藏 Tooltip
 *   - CATEGORY_LABELS：分类中文名映射（内联常量，不走 i18n）
 *
 * v1.2 T14：新增 renderActivePathways()、renderDefenseLayers()
 * v1.1 T7：接收 globalCfg，过载阈値显示
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

const PATHWAY_LAYER_MAP = {
  'IFN_signaling':[0,3],'NF_kB':[0,1],'endosomal_entry':[2],'influenza_entry':[1,6],
  'RIG_I':[3],'cGAS_STING':[3],'PKR_eIF2a':[3],'MAVS_platform':[4],
  'MHC1_presentation':[4],'TRIM21_ubiquitin':[2],'chromatin_priming':[4,7],
  'JAK_STAT':[7],'ISG_expression':[7],'HIV_integration':[7],'HIV_RT_active':[6,7],'HSV_ICP0_active':[6],
};

const CATEGORY_LABELS = {
  pattern_recognition:'模式识别受体', signal_transduction:'信号转导',
  innate_immune:'固有免疫', interferon_pathway:'干扰素通路',
  effector_response:'效应应答', adaptive_immune:'适应性免疫',
  cytotoxic:'细胞毒性', apoptosis:'凋亡程序',
  metabolic:'代谢调节', enhancement:'宿主强化',
  repair:'修复维护', antioxidant:'抗氧化', emergency:'应急响应',
};

export class UIRenderer {
  constructor(resources, gameState, i18n, globalCfg = {}) {
    this._res=resources; this._state=gameState; this._i18n=i18n; this._globalCfg=globalCfg;
    this._tooltip=null; this._ttName=null; this._ttCategory=null; this._ttNote=null;
  }

  init() {
    const btn = document.getElementById('btn-end-turn');
    if (btn) { btn.addEventListener('click', () => window.CellDefense?.endTurn()); btn.textContent=this._i18n.get('ui.buttons.end_turn'); }
    this._tooltip=document.getElementById('card-tooltip');
    this._ttName=document.getElementById('tt-name');
    this._ttCategory=document.getElementById('tt-category');
    this._ttNote=document.getElementById('tt-note');
    this.renderAll();
    console.log('[UIRenderer] Initialized.');
  }

  renderAll() {
    this.renderResourcePanel(); this.renderTurnInfo(); this.renderHandArea();
    this.renderVirusPanel(); this.renderActivePathways(); this.renderDefenseLayers();
  }

  renderResourcePanel() {
    const panel = document.getElementById('resource-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (const state of this._res.getAllStates()) {
      const label = this._i18n.get(state.display_key);
      const pct = state.max > 0 ? Math.min((state.current/state.max)*100, 100) : 0;
      const row = document.createElement('div');
      row.className = 'resource-row';
      row.innerHTML = `
        <div class="resource-label"><span class="resource-icon">${state.icon}</span><span class="resource-name">${label}</span></div>
        <div class="resource-bar-wrap"><div class="resource-bar ${state.is_negative?'bar-negative':'bar-positive'}" style="width:${pct}%;background:${state.color};"></div></div>
        <div class="resource-value">${Math.floor(state.current)}<span class="resource-max">/${state.max}</span></div>`;
      panel.appendChild(row);
    }
  }

  renderTurnInfo() {
    const el = document.getElementById('turn-info');
    if (!el) return;
    const turnLabel = this._i18n.get('ui.turn.turn_count', { n: this._state.turnCount });
    const phaseKey = {player_turn:'ui.turn.player_turn',virus_turn:'ui.turn.virus_turn',settlement:'ui.turn.settlement'}[this._state.phase] ?? 'ui.turn.player_turn';
    const overloadBadge = this._state.isOverloaded ? `<span class="status-badge badge-overload">${this._i18n.get('ui.status.overloaded')}</span>` : '';
    el.innerHTML = `
      <span class="turn-count">${turnLabel}</span><span class="turn-phase">${this._i18n.get(phaseKey)}</span>
      ${overloadBadge}
      <span class="deck-info">🃏${this._state.hand.length} / 📦${this._state.deck.length} / 🗑${this._state.discard.length}</span>`;
    const btn = document.getElementById('btn-end-turn');
    if (btn) btn.disabled = this._state.phase !== 'player_turn' || this._state.isGameOver;
  }

  renderHandArea() {
    const area = document.getElementById('hand-area');
    if (!area) return;
    this._hideTooltip();
    area.innerHTML = '';
    if (this._state.hand.length === 0) {
      const ph = document.createElement('div'); ph.className='hand-placeholder'; ph.textContent='（手牌为空）'; area.appendChild(ph);
      return;
    }
    for (const card of this._state.hand) area.appendChild(this._createCardElement(card));
  }

  _createCardElement(card) {
    const el = document.createElement('div');
    el.dataset.cardId = card.id;
    const name=this._i18n.get(`cards.${card.id}.name`), desc=this._i18n.get(`cards.${card.id}.description`);
    const cost=card.cost||{}, canPay=this._res.canAfford(cost);
    const nullified=this._state.isCardNullified?.(card.id)??false;
    let conditionMet=true;
    if (card.play_condition) {
      const vl=this._res.get(card.play_condition.resource??'viral_load');
      conditionMet=card.play_condition.type==='resource_gte' ? vl>=card.play_condition.value : true;
    }
    const playable=canPay&&conditionMet&&!nullified&&this._state.phase==='player_turn'&&!this._state.isGameOver;
    el.className=`card ${playable?'card-playable':'card-unplayable'}${nullified?' card-nullified':''}`;
    const costStr=Object.entries(cost).map(([r,a])=>`${a}${this._i18n.get(`ui.resources.${r}`)}`).join('+');
    const nullifiedNote=nullified?'<div class="card-nullified-note">⛔ 效果已被病毒废除</div>':'';
    el.innerHTML=`
      <div class="card-art" style="background:${card.color_placeholder||'#334'};">
        <span class="card-rarity rarity-${card.rarity||'common'}">${card.rarity?.[0]?.toUpperCase()??'C'}</span>
      </div>
      <div class="card-body">
        <div class="card-name">${name}</div>
        <div class="card-cost">${costStr||'免费'}</div>
        <div class="card-desc">${desc}</div>
        ${nullifiedNote}
      </div>`;
    el.addEventListener('click', () => { if (playable) window.CellDefense?.playCard(card.id); });
    if (card.academic_note) {
      el.addEventListener('mouseenter', () => this._showTooltip(card, el));
      el.addEventListener('mouseleave', () => this._hideTooltip());
    }
    return el;
  }

  _showTooltip(card, cardEl) {
    if (!this._tooltip || !card.academic_note) return;
    this._ttName.textContent     = this._i18n.get(`cards.${card.id}.name`) || card.id;
    this._ttCategory.textContent = CATEGORY_LABELS[card.category] || card.category || '';
    this._ttNote.textContent     = card.academic_note;
    this._tooltip.style.opacity  = '0';
    this._tooltip.style.display  = 'block';
    this._tooltip.classList.add('visible');
    const cardRect=cardEl.getBoundingClientRect(), tipRect=this._tooltip.getBoundingClientRect(), margin=10;
    let left=cardRect.left+cardRect.width/2-tipRect.width/2;
    let top=cardRect.top-tipRect.height-margin;
    left=Math.max(margin, Math.min(left, window.innerWidth-tipRect.width-margin));
    if (top < margin) top = cardRect.bottom + margin;
    this._tooltip.style.left=`${left}px`; this._tooltip.style.top=`${top}px`;
    this._tooltip.style.opacity='1';
  }

  _hideTooltip() {
    if (!this._tooltip) return;
    this._tooltip.classList.remove('visible');
    this._tooltip.style.opacity='0';
  }

  renderVirusPanel() {
    const panel=document.getElementById('virus-panel');
    if (!panel) return;
    const virus=this._state.currentVirus;
    if (!virus) { panel.innerHTML='<div class="virus-placeholder">等待病毒入侵…</div>'; return; }
    const name=this._i18n.get(`viruses.${virus.id}.name`);
    const viralLoad=Math.floor(this._res.get('viral_load')), maxLoad=this._res.getState('viral_load').max;
    const overloadTh=this._globalCfg.viral_load_overload_threshold??20;
    const loadPct=Math.min((viralLoad/maxLoad)*100,100), threshPct=Math.min((overloadTh/maxLoad)*100,100);
    const isOver=this._state.isOverloaded;
    const overloadBar=isOver?`<div class="overload-warning">${this._i18n.get('ui.status.overloaded')} — 增殖+${this._globalCfg.overload_replication_bonus??1}</div>`:'';
    panel.innerHTML=`
      <div class="virus-name">${name}</div>
      <div class="virus-genome">${virus.genome_type??''}</div>
      <div class="virus-load-section">
        <div class="virus-load-label"><span>病毒载量</span><span class="${isOver?'load-value-overload':''}">${viralLoad} / ${maxLoad}</span></div>
        <div class="virus-load-bar-bg">
          <div class="virus-load-bar ${isOver?'bar-overloaded':''}" style="width:${loadPct}%;"></div>
          <div class="overload-threshold-line" style="left:${threshPct}%;" title="过载阈値 ${overloadTh}"></div>
        </div>
      </div>
      ${overloadBar}
      <div class="virus-rep">增殖: +${virus.replication_per_turn}${isOver?` (+${this._globalCfg.overload_replication_bonus??1} 过载)`:''}/回合</div>`;
  }

  renderActivePathways() {
    const panel=document.getElementById('active-pathways');
    if (!panel) return;
    const active=this._state.activePathways.filter(p=>p.remaining_turns>0);
    const suppressed=this._state.suppressedPathways.filter(p=>p.remaining_turns>0);
    if (active.length===0&&suppressed.length===0) { panel.innerHTML='<div style="font-size:11px;color:var(--text-secondary);font-style:italic;">无活跃通路</div>'; return; }
    panel.innerHTML='';
    for (const p of active) {
      const isSuppressed=suppressed.some(s=>s.pathway===p.pathway);
      const name=this._i18n.get(`pathways.${p.pathway}`)||p.pathway;
      const turnsStr=p.remaining_turns===Infinity?'∞':`${p.remaining_turns}回合`;
      const el=document.createElement('div'); el.className=`pathway-tag${isSuppressed?' pathway-suppressed':''}`;
      el.innerHTML=`<span>${isSuppressed?'⛔ ':''} ${name}</span><span>${turnsStr}</span>`;
      panel.appendChild(el);
    }
    for (const s of suppressed) {
      if (active.some(a=>a.pathway===s.pathway)) continue;
      const name=this._i18n.get(`pathways.${s.pathway}`)||s.pathway;
      const el=document.createElement('div'); el.className='pathway-tag pathway-suppressed';
      el.innerHTML=`<span>⛔ ${name}</span><span>${s.remaining_turns}回合</span>`;
      panel.appendChild(el);
    }
  }

  renderDefenseLayers() {
    const activeLayers=new Set();
    for (const p of this._state.activePathways) {
      if (p.remaining_turns<=0) continue;
      const isSuppressed=this._state.suppressedPathways.some(s=>s.pathway===p.pathway&&s.remaining_turns>0);
      if (!isSuppressed) { const layers=PATHWAY_LAYER_MAP[p.pathway]??[]; layers.forEach(l=>activeLayers.add(l)); }
    }
    document.querySelectorAll('.defense-layer').forEach(el=>{
      el.classList.toggle('active', activeLayers.has(parseInt(el.dataset.layer??'-1')));
    });
  }

  showGameOver(isVictory) {
    const overlay=document.getElementById('gameover-overlay');
    if (!overlay) return;
    const msgKey=isVictory?'ui.game_over.victory':'ui.game_over.defeat';
    overlay.innerHTML=`<div class="gameover-box ${isVictory?'victory':'defeat'}"><h2>${this._i18n.get(msgKey)}</h2><p>共经历 ${this._state.turnCount-1} 个回合</p><button onclick="location.reload()">${this._i18n.get('ui.game_over.restart')}</button></div>`;
    overlay.style.display='flex';
  }
}
