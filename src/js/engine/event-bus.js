/**
 * EventBus — 全局事件钩子系统
 * 所有游戏逻辑通过事件驱动，未来加新机制只需挂载新钩子，不改现有逻辑。
 *
 * 使用方式：
 *   EventBus.on('card_played', handler)
 *   EventBus.emit('card_played', cardData)
 *   EventBus.off('card_played', handler)
 *   EventBus.once('turn_start', handler)
 *
 * 标准事件列表（见下方 EVENTS 常量）
 */

export const EVENTS = {
  // 回合生命周期
  GAME_START:              'game_start',
  TURN_START:              'turn_start',
  PLAYER_TURN_START:       'player_turn_start',
  PLAYER_TURN_END:         'player_turn_end',
  VIRUS_TURN_START:        'virus_turn_start',
  VIRUS_TURN_END:          'virus_turn_end',
  TURN_SETTLEMENT:         'turn_settlement',
  TURN_END:                'turn_end',

  // 卡牌事件
  CARD_DRAWN:              'card_drawn',
  CARD_PLAYED:             'card_played',
  CARD_DISCARDED:          'card_discarded',
  HAND_UPDATED:            'hand_updated',
  DECK_SHUFFLED:           'deck_shuffled',

  // 资源事件
  RESOURCE_CHANGED:        'resource_changed',
  RESOURCE_OVERFLOW:       'resource_overflow',
  RESOURCE_DEPLETED:       'resource_depleted',

  // 病毒事件
  VIRUS_ENTER:             'virus_enter',
  VIRUS_REPLICATE:         'virus_replicate',
  VIRUS_ACTION:            'virus_action',
  VIRUS_SKILL_TRIGGERED:   'virus_skill_triggered',
  VIRUS_MUTATED:           'virus_mutated',
  VIRAL_LOAD_OVERLOAD:     'viral_load_overload',
  VIRAL_LOAD_CLEARED:      'viral_load_cleared',

  // 防线事件
  DEFENSE_LAYER_ACTIVATED: 'defense_layer_activated',
  DEFENSE_LAYER_BREACHED:  'defense_layer_breached',
  PATHWAY_TRIGGERED:       'pathway_triggered',

  // 状态事件
  STATUS_APPLIED:          'status_applied',
  STATUS_EXPIRED:          'status_expired',
  FATIGUE_CHANGED:         'fatigue_changed',
  OXIDATIVE_STRESS_PEAK:   'oxidative_stress_peak',

  // 随机事件
  RANDOM_EVENT_TRIGGERED:  'random_event_triggered',
  RANDOM_EVENT_RESOLVED:   'random_event_resolved',

  // 动画触发
  ANIMATION_TRIGGER:       'animation_trigger',
  ANIMATION_COMPLETE:      'animation_complete',

  // 游戏结局
  GAME_OVER:               'game_over',
  GAME_VICTORY:            'game_victory',

  // Phase 2 预留
  HOST_PROFILE_CHANGED:    'host_profile_changed',
  LANGUAGE_CHANGED:        'language_changed',
  ADJACENT_CELL_SIGNAL:    'adjacent_cell_signal',
};

class EventBusClass {
  constructor() {
    this._listeners = new Map();
    this._onceListeners = new Map();
    this._debug = false;
  }

  setDebug(enabled) { this._debug = enabled; }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return this;
  }

  once(event, handler) {
    if (!this._onceListeners.has(event)) this._onceListeners.set(event, new Set());
    this._onceListeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    if (!handler) { this._listeners.delete(event); this._onceListeners.delete(event); return this; }
    this._listeners.get(event)?.delete(handler);
    this._onceListeners.get(event)?.delete(handler);
    return this;
  }

  emit(event, payload) {
    if (this._debug) console.log(`[EventBus] ${event}`, payload);
    const listeners = this._listeners.get(event);
    if (listeners) for (const h of listeners) { try { h(payload); } catch(e) { console.error(`[EventBus] ${event}:`, e); } }
    const once = this._onceListeners.get(event);
    if (once?.size) { for (const h of once) { try { h(payload); } catch(e) { console.error(`[EventBus] once ${event}:`, e); } } this._onceListeners.delete(event); }
    return this;
  }

  clear() { this._listeners.clear(); this._onceListeners.clear(); }
  listEvents() { return [...new Set([...this._listeners.keys(), ...this._onceListeners.keys()])]; }
}

const EventBus = new EventBusClass();
export default EventBus;
