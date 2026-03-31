import EventBus, { EVENTS } from './event-bus.js';

export class ResourceSystem {
  constructor(balanceConfig, hostProfile) {
    this._config = balanceConfig;
    this._hostProfile = hostProfile;
    this._resources = new Map();
    this._globalParams = balanceConfig.global;
    this._initialized = false;
  }

  init() {
    const resourceDefs = this._config.resources;
    const modifiers = this._hostProfile.resource_modifiers || {};
    for (const [id, def] of Object.entries(resourceDefs)) {
      const mod = modifiers[id] || {};
      const base  = def.base  + (mod.base_delta  || 0);
      const max   = def.max   + (mod.max_delta   || 0);
      const regen = def.regen + (mod.regen_delta || 0);
      this._resources.set(id, { id, current: base, base, max, regen,
        display_key: def.display_key, color: def.color, icon: def.icon,
        is_negative: def.is_negative || false });
    }
    this._initialized = true;
    console.log('[ResourceSystem] Initialized:', [...this._resources.keys()]);
    return this;
  }

  get(id) { return this._getState(id).current; }
  getState(id) { return { ...this._getState(id) }; }
  getAllStates() { return [...this._resources.values()].map(r => ({ ...r })); }

  set(id, value) {
    const state = this._getState(id);
    const prev = state.current;
    state.current = this._clamp(value, 0, state.max);
    this._emitChange(id, prev, state.current);
  }

  delta(id, amount) { this.set(id, this.get(id) + amount); }

  processTurnRegen() {
    const g = this._globalParams;
    const fatigue = this.get('fatigue');
    let fatiguePenalty = 0;
    if (fatigue >= g.fatigue_penalty_tier2) fatiguePenalty = g.fatigue_resource_penalty_per_tier * 2;
    else if (fatigue >= g.fatigue_penalty_tier1) fatiguePenalty = g.fatigue_resource_penalty_per_tier;

    for (const [id, state] of this._resources) {
      if (state.regen === 0) continue;
      let regenAmount = state.regen;
      if (regenAmount > 0 && !state.is_negative) regenAmount = Math.max(0, regenAmount - fatiguePenalty);
      this.delta(id, regenAmount);
    }

    if (this.get('oxidative_stress') >= this._getState('oxidative_stress').max) {
      EventBus.emit(EVENTS.OXIDATIVE_STRESS_PEAK, { damage: g.oxidative_stress_overflow_damage });
      this.delta('cell_integrity', -g.oxidative_stress_overflow_damage);
    }
    if (this.get('viral_load') >= g.viral_load_overload_threshold)
      EventBus.emit(EVENTS.VIRAL_LOAD_OVERLOAD, { current: this.get('viral_load') });
  }

  applyCardFatigue(cardCost) {
    const g = this._globalParams;
    if (cardCost >= g.fatigue_high_cost_threshold) {
      this.delta('fatigue', g.fatigue_per_high_cost_card);
      EventBus.emit(EVENTS.FATIGUE_CHANGED, { delta: g.fatigue_per_high_cost_card, current: this.get('fatigue') });
    }
  }

  canAfford(cost) {
    for (const [id, amount] of Object.entries(cost)) if (this.get(id) < amount) return false;
    return true;
  }

  pay(cost) { for (const [id, amount] of Object.entries(cost)) this.delta(id, -amount); }

  reset() {
    for (const [id, state] of this._resources) {
      const prev = state.current; state.current = state.base; this._emitChange(id, prev, state.current);
    }
  }

  _getState(id) {
    const s = this._resources.get(id);
    if (!s) throw new Error(`[ResourceSystem] Unknown resource: "${id}"`);
    return s;
  }
  _clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  _emitChange(id, prev, current) {
    if (prev === current) return;
    EventBus.emit(EVENTS.RESOURCE_CHANGED, { id, prev, current, delta: current - prev });
    if (current <= 0 && id === 'cell_integrity') EventBus.emit(EVENTS.GAME_OVER, { reason: 'cell_integrity_depleted' });
    if (current <= 0 && prev > 0) EventBus.emit(EVENTS.RESOURCE_DEPLETED, { id });
    if (current >= this._getState(id).max && prev < this._getState(id).max)
      EventBus.emit(EVENTS.RESOURCE_OVERFLOW, { id, max: this._getState(id).max });
  }
}
