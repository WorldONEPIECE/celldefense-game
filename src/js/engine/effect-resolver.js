import EventBus, { EVENTS } from './event-bus.js';

export class EffectResolver {
  constructor(resourceSystem, gameState) {
    this._resources = resourceSystem;
    this._gameState = gameState;
    this._handlers = new Map();
    this._registerBuiltinHandlers();
  }

  resolve(effects, context = {}) {
    for (const effect of effects) this._executeEffect(effect, context);
  }

  registerHandler(type, handler) { this._handlers.set(type, handler); }

  _registerBuiltinHandlers() {
    this.registerHandler('resource_delta', (e) => this._resources.delta(e.resource, e.amount));
    this.registerHandler('resource_generate', (e) => {
      this._resources.delta(e.resource, e.amount);
      if (e.per_turn && e.duration > 1)
        this._gameState.addStatus({ type: 'resource_generate', resource: e.resource, amount: e.amount, remaining_turns: e.duration - 1 });
    });
    this.registerHandler('trigger_pathway', (e) => {
      this._gameState.addActivePathway({ pathway: e.pathway, remaining_turns: e.duration || 1 });
      EventBus.emit(EVENTS.PATHWAY_TRIGGERED, { pathway: e.pathway, duration: e.duration });
    });
    this.registerHandler('viral_load_reduce', (e) => this._resources.delta('viral_load', -e.amount));
    this.registerHandler('status_apply', (e) => {
      this._gameState.addStatus({ type: e.status, remaining_turns: e.duration || 1, value: e.value, target: e.target || 'player' });
      EventBus.emit(EVENTS.STATUS_APPLIED, { status: e.status, duration: e.duration });
    });
    this.registerHandler('trigger_animation', (e, ctx) =>
      EventBus.emit(EVENTS.ANIMATION_TRIGGER, { animation: e.animation, source: ctx.card?.id }));
    this.registerHandler('conditional', (e, ctx, r) => {
      if (this._evaluateCondition(e.condition)) r.resolve(e.effects_if_true, ctx);
      else if (e.effects_if_false) r.resolve(e.effects_if_false, ctx);
    });
  }

  _executeEffect(effect, context) {
    const handler = this._handlers.get(effect.type);
    if (!handler) { console.warn(`[EffectResolver] Unknown type: "${effect.type}"`); return; }
    try { handler(effect, context, this); } catch(e) { console.error(`[EffectResolver] ${effect.type}:`, e); }
  }

  _evaluateCondition(condition) {
    if (!condition) return true;
    switch (condition.type) {
      case 'resource_gte':    return this._resources.get(condition.resource) >= condition.value;
      case 'resource_lte':    return this._resources.get(condition.resource) <= condition.value;
      case 'viral_load_gte':  return this._resources.get('viral_load') >= condition.value;
      case 'pathway_active':  return this._gameState.isPathwayActive(condition.pathway);
      default: console.warn(`[EffectResolver] Unknown condition: "${condition.type}"`); return false;
    }
  }
}
