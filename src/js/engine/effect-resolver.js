/**
 * effect-resolver.js — 组件化效果解析器
 *
 * v1.1 T9：
 *   - _getCardEfficiencyMultiplier()：查询病毒挂载的 card_efficiency_reduce
 *   - 正值增益受效率系数影响，负值代价不受影响
 *   - 未注册资源静默跳过（has() 保护）
 */

import EventBus, { EVENTS } from './event-bus.js';

export class EffectResolver {
  constructor(resourceSystem, gameState) {
    this._resources = resourceSystem;
    this._gameState = gameState;
    this._handlers  = new Map();
    this._registerBuiltinHandlers();
  }

  resolve(effects, context = {}) {
    const mult = this._getCardEfficiencyMultiplier(context.card);
    for (const effect of effects) {
      this._executeEffect(effect, context, mult);
    }
  }

  registerHandler(type, handler) {
    this._handlers.set(type, handler);
  }

  _registerBuiltinHandlers() {

    this.registerHandler('resource_delta', (effect, ctx, mult) => {
      if (!this._resources.has(effect.resource)) {
        console.warn(`[EffectResolver] Unknown resource "${effect.resource}", skipping`);
        return;
      }
      const amount = effect.amount > 0 ? Math.round(effect.amount * mult) : effect.amount;
      this._resources.delta(effect.resource, amount);
    });

    this.registerHandler('resource_generate', (effect, ctx, mult) => {
      if (!this._resources.has(effect.resource)) {
        console.warn(`[EffectResolver] Unknown resource "${effect.resource}" in resource_generate, skipping`);
        return;
      }
      const amount = Math.round(effect.amount * mult);
      this._resources.delta(effect.resource, amount);
      if (effect.per_turn && effect.duration > 1) {
        this._gameState.addStatus({
          type:            'resource_generate',
          resource:        effect.resource,
          amount:          amount,
          remaining_turns: effect.duration - 1,
        });
      }
    });

    this.registerHandler('trigger_pathway', (effect, ctx, mult) => {
      this._gameState.addActivePathway({
        pathway:         effect.pathway,
        remaining_turns: effect.duration ?? 1,
      });
      EventBus.emit(EVENTS.PATHWAY_TRIGGERED, { pathway: effect.pathway, duration: effect.duration });
    });

    this.registerHandler('viral_load_reduce', (effect, ctx, mult) => {
      const amount = Math.round(effect.amount * mult);
      this._resources.delta('viral_load', -amount);
    });

    this.registerHandler('status_apply', (effect, ctx, mult) => {
      this._gameState.addStatus({
        type:            effect.status,
        remaining_turns: effect.duration ?? 1,
        value:           effect.value,
        target:          effect.target ?? 'player',
      });
      EventBus.emit(EVENTS.STATUS_APPLIED, { status: effect.status, duration: effect.duration });
    });

    this.registerHandler('trigger_animation', (effect, ctx, mult) => {
      EventBus.emit(EVENTS.ANIMATION_TRIGGER, { animation: effect.animation, source: ctx.card?.id });
    });

    this.registerHandler('conditional', (effect, ctx, mult) => {
      if (this._evaluateCondition(effect.condition)) {
        this.resolve(effect.effects_if_true ?? [], ctx);
      } else if (effect.effects_if_false) {
        this.resolve(effect.effects_if_false, ctx);
      }
    });
  }

  _getCardEfficiencyMultiplier(card) {
    if (!card) return 1;
    let mult = 1;
    for (const status of this._gameState.activeStatuses) {
      if (status.type !== 'card_efficiency_reduce') continue;
      const tagMatch  = status.target_tag  && card.tags?.includes(status.target_tag);
      const cardMatch = status.target_card && status.target_card === card.id;
      if (tagMatch || cardMatch) mult *= (status.multiplier ?? 1);
    }
    return mult;
  }

  _evaluateCondition(condition) {
    if (!condition) return true;
    switch (condition.type) {
      case 'resource_gte':   return this._resources.get(condition.resource) >= condition.value;
      case 'resource_lte':   return this._resources.get(condition.resource) <= condition.value;
      case 'viral_load_gte': return this._resources.get('viral_load') >= condition.value;
      case 'pathway_active': return this._gameState.isPathwayActive(condition.pathway);
      default:
        console.warn(`[EffectResolver] Unknown condition: "${condition.type}"`);
        return false;
    }
  }

  _executeEffect(effect, context, multiplier = 1) {
    const handler = this._handlers.get(effect.type);
    if (!handler) {
      console.warn(`[EffectResolver] Unknown effect type: "${effect.type}"`);
      return;
    }
    try {
      handler(effect, context, multiplier);
    } catch (err) {
      console.error(`[EffectResolver] Error in "${effect.type}":`, err, effect);
    }
  }
}
