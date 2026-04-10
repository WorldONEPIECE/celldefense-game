/**
 * event-system.js — 随机事件系统 (T11)
 * Bug Fix (T15)：_pickEvent 过滤条件加 typeof e === 'object'，防止 _comment/_version 字符串进入事件池。
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

export class EventSystem {
  constructor(eventsData, globalCfg, resources, effectResolver, gameState, i18n) {
    this._events=eventsData; this._globalCfg=globalCfg; this._resources=resources;
    this._effectResolver=effectResolver; this._gameState=gameState; this._i18n=i18n;
    this._turnsSinceLastEvent=0; this._nextTriggerAt=this._rollInterval();
    this._overlay=document.getElementById('event-overlay');
    this._titleEl=document.getElementById('event-title');
    this._descEl=document.getElementById('event-desc');
    this._dismissBtn=document.getElementById('event-dismiss');
    if (this._dismissBtn) this._dismissBtn.addEventListener('click', () => this._dismiss());
  }

  checkAndTrigger(currentTurn) {
    this._turnsSinceLastEvent++;
    if (this._turnsSinceLastEvent < this._nextTriggerAt) return false;
    const event = this._pickEvent(currentTurn);
    if (!event) return false;
    this._triggerEvent(event);
    this._turnsSinceLastEvent=0; this._nextTriggerAt=this._rollInterval();
    return true;
  }

  _pickEvent(currentTurn) {
    const pool = Object.values(this._events).filter(e =>
      e && typeof e === 'object' && e.id &&
      !e.id.startsWith('_') && currentTurn >= (e.min_turn ?? 1)
    );
    if (pool.length === 0) return null;
    const totalWeight = pool.reduce((sum, e) => sum + (e.weight ?? 10), 0);
    let rand = Math.random() * totalWeight;
    for (const event of pool) { rand -= (event.weight ?? 10); if (rand <= 0) return event; }
    return pool[pool.length - 1];
  }

  _triggerEvent(event) {
    this._effectResolver.resolve(event.effects ?? [], { source: 'event', event });
    EventBus.emit(EVENTS.RANDOM_EVENT_TRIGGERED, { eventId: event.id });
    if (this._overlay && this._titleEl && this._descEl) {
      this._titleEl.textContent = this._i18n.get(event.name_key) || event.id;
      this._descEl.textContent  = this._i18n.get(event.description_key) || '';
      this._overlay.style.display = 'flex';
      if (this._dismissBtn) this._dismissBtn.textContent = this._i18n.get('ui.events.dismiss') || '确认';
    }
    console.log(`[EventSystem] Event triggered: ${event.id}`);
  }

  _dismiss() { if (this._overlay) this._overlay.style.display='none'; EventBus.emit(EVENTS.RANDOM_EVENT_RESOLVED, {}); }

  _rollInterval() {
    const min=this._globalCfg.event_trigger_interval_min??3, max=this._globalCfg.event_trigger_interval_max??5;
    return Math.floor(Math.random()*(max-min+1))+min;
  }
}
