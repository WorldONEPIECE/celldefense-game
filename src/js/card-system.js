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
  constructor(cardsData, balanceConfig, resources, effectResolver, gameState, i18n) {
    this._allCards       = cardsData;
    this._balance        = balanceConfig;
    this._resources      = resources;
    this._effectResolver = effectResolver;
    this._gameState      = gameState;
    this._i18n           = i18n;
    this._cardPool = new Map();
  }

  loadCards() {
    this._cardPool.clear();
    for (const [id, card] of Object.entries(this._allCards)) {
      if (id.startsWith('_')) continue;
      if (card.pool_excluded_phase1) continue;
      this._cardPool.set(id, card);
    }
    console.log(`[CardSystem] Loaded ${this._cardPool.size} cards into pool.`);
  }

  buildStarterDeck() {
    const starterIds = this._balance.global.starter_deck || [];
    const deck = [];
    for (const id of starterIds) {
      const card = this._cardPool.get(id);
      if (card) {
        deck.push({ ...card });
      } else {
        console.warn(`[CardSystem] Starter card not in pool: "${id}"`);
      }
    }
    this._gameState.deck    = this.shuffle(deck);
    this._gameState.discard = [];
    this._gameState.hand    = [];
    console.log(`[CardSystem] Starter deck ready: ${deck.length} cards.`);
  }

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  draw(n) {
    for (let i = 0; i < n; i++) {
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

  playCard(cardId) {
    if (this._gameState.phase !== 'player_turn') return false;

    const idx = this._gameState.hand.findIndex(c => c.id === cardId);
    if (idx === -1) {
      console.warn(`[CardSystem] Card not in hand: "${cardId}"`);
      return false;
    }

    const card = this._gameState.hand[idx];

    if (card.play_condition) {
      if (!this._effectResolver._evaluateCondition(card.play_condition)) {
        console.log(`[CardSystem] Play condition not met: "${cardId}"`);
        return false;
      }
    }

    if (!this._resources.canAfford(card.cost || {})) {
      console.log(`[CardSystem] Cannot afford: "${cardId}"`);
      return false;
    }

    this._resources.pay(card.cost || {});

    // 病毒废除检查：卡可打出且消耗资源，但效果不生效
    const nullified = this._gameState.isCardNullified?.(cardId) ?? false;
    if (!nullified) {
      this._effectResolver.resolve(card.effects || [], { source: 'player', card });
    } else {
      console.log(`[CardSystem] Effect nullified by virus: "${cardId}"`);
    }

    this._resources.applyCardFatigue(card.cost?.atp || 0);

    this._gameState.hand.splice(idx, 1);
    this._gameState.discard.push(card);

    EventBus.emit(EVENTS.CARD_PLAYED, { cardId, card });
    this._notifyHandUpdate();
    return true;
  }

  discardHand() {
    for (const card of this._gameState.hand) {
      this._gameState.discard.push(card);
      EventBus.emit(EVENTS.CARD_DISCARDED, { cardId: card.id });
    }
    this._gameState.hand = [];
    this._notifyHandUpdate();
  }

  getStats() {
    return {
      deckSize:    this._gameState.deck.length,
      discardSize: this._gameState.discard.length,
      handSize:    this._gameState.hand.length,
    };
  }

  _notifyHandUpdate() {
    EventBus.emit(EVENTS.HAND_UPDATED, {
      hand:        this._gameState.hand,
      deckSize:    this._gameState.deck.length,
      discardSize: this._gameState.discard.length,
    });
  }
}
