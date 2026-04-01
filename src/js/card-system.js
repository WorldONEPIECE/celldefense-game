/**
 * card-system.js — 卡牌系统
 * 负责：加载卡牌数据 → 构建起始牌组 → 抽/打/弃/洗 → 通知UI
 *
 * 架构约束：
 *   - 不含裸数字，所有参数从 balanceConfig.global 读取
 *   - 不含硬编码字符串
 *   - 所有卡牌效果委托给 EffectResolver
 *   - 手牌变化通过 HAND_UPDATED 事件驱动UI
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

export class CardSystem {
  /**
   * @param {Object}          cardsData      — cards.json 完整内容
   * @param {Object}          balanceConfig  — balance.json 完整内容
   * @param {ResourceSystem}  resources
   * @param {EffectResolver}  effectResolver
   * @param {Object}          gameState
   * @param {I18n}            i18n
   */
  constructor(cardsData, balanceConfig, resources, effectResolver, gameState, i18n) {
    this._allCards      = cardsData;
    this._balance       = balanceConfig;
    this._resources     = resources;
    this._effectResolver = effectResolver;
    this._gameState     = gameState;
    this._i18n          = i18n;

    /** @type {Map<string, Object>} Phase1可用卡牌池 */
    this._cardPool = new Map();
  }

  // ─── 初始化 ────────────────────────────────────────────────────────────────

  /**
   * 加载可用卡牌，过滤 pool_excluded_phase1: true
   * 必须在 buildStarterDeck 前调用
   */
  loadCards() {
    this._cardPool.clear();
    for (const [id, card] of Object.entries(this._allCards)) {
      if (id.startsWith('_')) continue;          // 跳过 _comment / _version
      if (card.pool_excluded_phase1) continue;   // 跳过 Phase2 Enhancement 卡
      this._cardPool.set(id, card);
    }
    console.log(`[CardSystem] Loaded ${this._cardPool.size} cards into pool.`);
  }

  /**
   * 构建起始牌组，来源：balance.json global.starter_deck 列表
   * 写入 gameState.deck（已洗牌），清空 hand / discard
   */
  buildStarterDeck() {
    const starterIds = this._balance.global.starter_deck || [];
    const deck = [];

    for (const id of starterIds) {
      const card = this._cardPool.get(id);
      if (card) {
        deck.push({ ...card });   // shallow copy 防止污染原始数据
      } else {
        console.warn(`[CardSystem] Starter card not in pool: "${id}"`);
      }
    }

    this._gameState.deck    = this.shuffle(deck);
    this._gameState.discard = [];
    this._gameState.hand    = [];

    console.log(`[CardSystem] Starter deck ready: ${deck.length} cards.`);
  }

  // ─── 核心操作 ──────────────────────────────────────────────────────────────

  /**
   * Fisher-Yates 洗牌（返回新数组，不修改原数组）
   * @param {Object[]} arr
   * @returns {Object[]}
   */
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * 抽 n 张牌到手牌
   * 牌堆耗尽时自动洗弃牌堆补充
   * @param {number} n
   */
  draw(n) {
    for (let i = 0; i < n; i++) {
      // 牌堆空：洗弃牌堆
      if (this._gameState.deck.length === 0) {
        if (this._gameState.discard.length === 0) break;
        this._gameState.deck    = this.shuffle(this._gameState.discard);
        this._gameState.discard = [];
        EventBus.emit(EVENTS.DECK_SHUFFLED, { deckSize: this._gameState.deck.length });
      }

      const card = this._gameState.deck.pop();
      this._gameState.hand.push(card);
      EventBus.emit(EVENTS.CARD_DRAWN, { cardId: card.id });
    }

    this._notifyHandUpdate();
  }

  /**
   * 打出一张手牌
   * @param {string} cardId
   * @returns {boolean} 是否成功出牌
   */
  playCard(cardId) {
    if (this._gameState.phase !== 'player_turn') return false;

    const idx = this._gameState.hand.findIndex(c => c.id === cardId);
    if (idx === -1) {
      console.warn(`[CardSystem] Card not in hand: "${cardId}"`);
      return false;
    }

    const card = this._gameState.hand[idx];

    // play_condition 检查（如 tnf_alpha 要求 viral_load >= 15）
    if (card.play_condition) {
      if (!this._effectResolver._evaluateCondition(card.play_condition)) {
        console.log(`[CardSystem] Play condition not met: "${cardId}"`);
        return false;
      }
    }

    // 费用检查
    if (!this._resources.canAfford(card.cost || {})) {
      console.log(`[CardSystem] Cannot afford: "${cardId}"`);
      return false;
    }

    // 扣费
    this._resources.pay(card.cost || {});

    // 执行效果（委托 EffectResolver）
    this._effectResolver.resolve(card.effects || [], { source: 'player', card });

    // 高费卡增加疲劳
    this._resources.applyCardFatigue(card.cost?.atp || 0);

    // 手牌 → 弃牌堆
    this._gameState.hand.splice(idx, 1);
    this._gameState.discard.push(card);

    EventBus.emit(EVENTS.CARD_PLAYED, { cardId, card });
    this._notifyHandUpdate();
    return true;
  }

  /**
   * 回合结束，弃所有手牌
   */
  discardHand() {
    for (const card of this._gameState.hand) {
      this._gameState.discard.push(card);
      EventBus.emit(EVENTS.CARD_DISCARDED, { cardId: card.id });
    }
    this._gameState.hand = [];
    this._notifyHandUpdate();
  }

  /**
   * 获取统计数据（供UI显示）
   * @returns {{ deckSize: number, discardSize: number, handSize: number }}
   */
  getStats() {
    return {
      deckSize:    this._gameState.deck.length,
      discardSize: this._gameState.discard.length,
      handSize:    this._gameState.hand.length,
    };
  }

  // ─── 内部工具 ──────────────────────────────────────────────────────────────

  _notifyHandUpdate() {
    EventBus.emit(EVENTS.HAND_UPDATED, {
      hand:        this._gameState.hand,
      deckSize:    this._gameState.deck.length,
      discardSize: this._gameState.discard.length,
    });
  }
}
