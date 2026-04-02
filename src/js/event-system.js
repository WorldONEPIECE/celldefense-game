/**
 * event-system.js — 随机事件系统 (T11)
 *
 * 职责：
 *   - 管理随机事件触发间隔
 *   - 加权随机选取事件
 *   - 通过 EffectResolver 执行效果
 *   - 控制 #event-overlay 显示/消失
 *   - 消失后 emit RANDOM_EVENT_RESOLVED，由 main.js 继续下一回合
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

export class EventSystem {
  constructor(eventsData, globalCfg, resources, effectResolver, gameState, i18n) {
    this._events         = eventsData;
    this._globalCfg      = globalCfg;
    this._resources      = resources;
    this._effectResolver = effectResolver;
    this._gameState      = gameState;
    this._i18n           = i18n;

    this._turnsSinceLastEvent = 0;
    this._nextTriggerAt       = this._rollInterval();

    this._overlay    = document.getElementById('event-overlay');
    this._titleEl    = document.getElementById('event-title');
    this._descEl     = document.getElementById('event-desc');
    this._dismissBtn = document.getElementById('event-dismiss');

    if (this._dismissBtn) {
      this._dismissBtn.addEventListener('click', () => this._dismiss());
    }
  }

  checkAndTrigger(currentTurn) {
    this._turnsSinceLastEvent++;
    if (this._turnsSinceLastEvent < this._nextTriggerAt) return false;

    const event = this._pickEvent(currentTurn);
    if (!event) return false;

    this._triggerEvent(event);
    this._turnsSinceLastEvent = 0;
    this._nextTriggerAt       = this._rollInterval();
    return true;
  }

  _pickEvent(currentTurn) {
    const pool = Object.values(this._events)
      .filter(e => e.id && !e.id.startsWith('_') && currentTurn >= (e.min_turn ?? 1));
    if (pool.length === 0) return null;

    const totalWeight = pool.reduce((sum, e) => sum + (e.weight ?? 10), 0);
    let rand = Math.random() * totalWeight;
    for (const event of pool) {
      rand -= (event.weight ?? 10);
      if (rand <= 0) return event;
    }
    return pool[pool.length - 1];
  }

  _triggerEvent(event) {
    this._effectResolver.resolve(event.effects ?? [], { source: 'event', event });
    EventBus.emit(EVENTS.RANDOM_EVENT_TRIGGERED, { eventId: event.id });

    if (this._overlay && this._titleEl && this._descEl) {
      this._titleEl.textContent = this._i18n.get(event.name_key);
      this._descEl.textContent  = this._i18n.get(event.description_key);
      if (this._dismissBtn) {
        this._dismissBtn.textContent = this._i18n.get('ui.events.dismiss');
      }
      this._overlay.style.display = 'flex';
    }
    console.log(`[EventSystem] Triggered: ${event.id}`);
  }

  _dismiss() {
    if (this._overlay) this._overlay.style.display = 'none';
    EventBus.emit(EVENTS.RANDOM_EVENT_RESOLVED, {});
  }

  _rollInterval() {
    const min = this._globalCfg.event_trigger_interval_min ?? 3;
    const max = this._globalCfg.event_trigger_interval_max ?? 5;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
