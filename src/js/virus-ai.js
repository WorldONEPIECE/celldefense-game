/**
 * virus-ai.js — 病毒行为引擎
 * 完全 JSON 驱动，不硬编码任何病毒名/数値。
 *
 * 职责：
 *   - 从 viruses.json 加载病毒行为定义
 *   - 处理每回合复制、资源掠夺、特殊技能
 *   - 所有效果通过 GameState / ResourceSystem 接口执行
 *   - 触发对应 EventBus 事件
 *
 * 支持的 effect 类型：
 *   pathway_suppress         — 压制防御通路（玩家打出相关卡无效）
 *   defense_structure_damage — 减少 activePathways 的剩余回合
 *   defense_structure_destroy— 直接清除 activePathways 中的结构
 *   card_nullify             — 标记特定卡牌无法发动效果（GameState.nullifiedCards）
 *   card_efficiency_reduce   — 标记某类/某张卡效果减弱（GameState.activeStatuses）
 *   discard_card             — 强制丢弃手牌中特定卡
 *   provirus_establish       — HIV整合，建立储存库 + 触发持续资源消耗
 *   latency_enter            — HSV潜伏，设定病毒载量下限与再激活计时
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

export class VirusAI {
  /**
   * @param {Object}         virusesData  — viruses.json 完整内容
   * @param {ResourceSystem} resources
   * @param {Object}         gameState
   */
  constructor(virusesData, resources, gameState) {
    this._allViruses = virusesData;
    this._resources  = resources;
    this._gameState  = gameState;

    /** @type {Object|null} 当前病毒定义 */
    this._virus = null;
    /** 病毒自己的内部回合计数（用于 turn_gte 条件） */
    this._virusTurnCount = 0;
    /** HIV provirus 是否已整合 */
    this._provirusEstablished = false;
  }

  // ─── 初始化 ────────────────────────────────────────────────────────────────

  /**
   * 选定病毒，并重置内部状态
   * @param {string} virusId
   */
  setVirus(virusId) {
    const v = this._allViruses[virusId];
    if (!v) throw new Error(`[VirusAI] Unknown virus: "${virusId}"`);
    this._virus               = v;
    this._virusTurnCount      = 0;
    this._provirusEstablished = false;
    console.log(`[VirusAI] Virus set: ${virusId}`);
  }

  /**
   * 病毒首次入侵时调用（boot流程 / 新关卡开始）
   * 设定初始载量，触发 on_virus_enter 效果
   */
  processVirusEntry() {
    if (!this._virus) return;

    this._resources.set('viral_load', this._virus.initial_load ?? 0);

    // 持续性资源掠夺（on_virus_enter 类型 → 挂状态，每回合结算扒除）
    for (const theft of this._virus.resource_theft ?? []) {
      if (theft.trigger === 'on_virus_enter') {
        this._gameState.addStatus({
          type:           'resource_drain',
          resource:       theft.resource,
          amount:         theft.delta_per_turn,
          remaining_turns: 9999,
          source_id:      `${this._virus.id}_${theft.id}`,
        });
      }
    }

    // on_first_turn 技能
    for (const skill of this._virus.special_skills ?? []) {
      if (skill.trigger === 'on_first_turn') {
        this._executeSkillEffect(skill);
      }
    }

    EventBus.emit(EVENTS.VIRUS_ENTER, {
      virus:       this._virus.id,
      initialLoad: this._virus.initial_load,
    });
  }

  // ─── 每回合处理 ──────────────────────────────────────────────────────────────

  /**
   * 主回合逻辑，在 runVirusTurn() 中调用
   * 顺序：增殖 → 资源掠夺 → 特殊技能
   */
  processTurn() {
    if (!this._virus) return;
    this._virusTurnCount++;

    // 1. 病毒载量增殖
    const rep = this._virus.replication_per_turn ?? 0;
    this._resources.delta('viral_load', rep);
    EventBus.emit(EVENTS.VIRUS_REPLICATE, { virus: this._virus.id, amount: rep });

    // 2. 非入侵型/非整合型资源掠夺
    for (const theft of this._virus.resource_theft ?? []) {
      if (theft.trigger === 'on_virus_enter' ||
          theft.trigger === 'on_provirus_established') continue;

      if (theft.trigger_condition) {
        if (!this._evaluateCondition(theft.trigger_condition)) continue;
      }

      this._resources.delta(theft.resource, theft.delta_per_turn);
    }

    // 3. on_virus_turn 特殊技能
    for (const skill of this._virus.special_skills ?? []) {
      if (skill.trigger !== 'on_virus_turn') continue;
      if (skill.condition && !this._evaluateCondition(skill.condition)) continue;
      this._executeSkillEffect(skill);
    }
  }

  // ─── 条件判断 ──────────────────────────────────────────────────────────────

  _evaluateCondition(cond) {
    if (!cond) return true;
    switch (cond.type) {
      case 'viral_load_gte':  return this._resources.get('viral_load') >= cond.value;
      case 'viral_load_lte':  return this._resources.get('viral_load') <= cond.value;
      case 'turn_gte':        return this._virusTurnCount >= cond.value;
      case 'even_turn':       return this._gameState.turnCount % 2 === 0;
      case 'card_in_hand':    return this._gameState.hand.some(c => c.id === cond.card_id);
      default:
        console.warn(`[VirusAI] Unknown condition: "${cond.type}"`);
        return false;
    }
  }

  // ─── 效果执行 ──────────────────────────────────────────────────────────────

  _executeSkillEffect(skill) {
    const effect = skill.effect;
    if (!effect) return;

    console.log(`[VirusAI] Skill triggered: ${skill.id} → ${effect.type}`);

    switch (effect.type) {

      case 'pathway_suppress': {
        // +1 补偿：tickStatuses 在 runVirusTurn 开头执行，
        // 使本回合加入的压制恰好在下一个玩家回合内有效
        this._gameState.addSuppressedPathway({
          pathway:         effect.pathway,
          remaining_turns: (effect.duration ?? 1) + 1,
        });
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'defense_structure_damage': {
        const target  = effect.target;
        const dmg     = effect.amount ?? 1;
        const pathway = this._gameState.activePathways.find(p => p.pathway === target);
        if (pathway) {
          pathway.remaining_turns = Math.max(0, pathway.remaining_turns - dmg);
        }
        EventBus.emit(EVENTS.DEFENSE_LAYER_BREACHED, { target, amount: dmg });
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'defense_structure_destroy': {
        const target = effect.target;
        const idx    = this._gameState.activePathways.findIndex(p => p.pathway === target);
        if (idx !== -1) this._gameState.activePathways.splice(idx, 1);
        EventBus.emit(EVENTS.DEFENSE_LAYER_BREACHED, { target, destroyed: true });
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'card_nullify': {
        this._gameState.addNullifiedCard(effect.card_id);
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'card_efficiency_reduce': {
        this._gameState.addStatus({
          type:        'card_efficiency_reduce',
          target_tag:  effect.card_tag  ?? null,
          target_card: effect.card_id   ?? null,
          multiplier:  effect.multiplier ?? 1,
          remaining_turns: effect.duration ?? 9999,
          source_id:   skill.id,
        });
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'discard_card': {
        const idx = this._gameState.hand.findIndex(c => c.id === effect.card_id);
        if (idx !== -1) {
          const [card] = this._gameState.hand.splice(idx, 1);
          this._gameState.discard.push(card);
          EventBus.emit(EVENTS.CARD_DISCARDED, { cardId: card.id, forced: true });
          EventBus.emit(EVENTS.HAND_UPDATED, {
            hand:        this._gameState.hand,
            deckSize:    this._gameState.deck.length,
            discardSize: this._gameState.discard.length,
          });
        }
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'provirus_establish': {
        if (!this._provirusEstablished) {
          this._provirusEstablished = true;
          this._resources.delta('cell_integrity', -(effect.cell_integrity_damage ?? 0));
          this._gameState.viralLoadFloor = effect.viral_load_floor ?? 1;
          for (const theft of this._virus.resource_theft ?? []) {
            if (theft.trigger === 'on_provirus_established') {
              this._gameState.addStatus({
                type:           'resource_drain',
                resource:       theft.resource,
                amount:         theft.delta_per_turn,
                remaining_turns: 9999,
                source_id:      `${this._virus.id}_${theft.id}`,
              });
            }
          }
          EventBus.emit(EVENTS.VIRUS_MUTATED, { virus: this._virus.id, mutation: 'provirus' });
        }
        this._emitSkillEvent(skill, effect);
        break;
      }

      case 'latency_enter': {
        this._gameState.viralLoadFloor          = this._gameState.currentVirus?.initial_load ?? 1;
        this._gameState.latencyReactivationIn   = effect.reactivation_turns ?? 3;
        this._gameState.latencyReactivationLoad = effect.reactivation_load  ?? 4;
        EventBus.emit(EVENTS.VIRUS_MUTATED, { virus: this._virus.id, mutation: 'latency' });
        this._emitSkillEvent(skill, effect);
        break;
      }

      default:
        console.warn(`[VirusAI] Unhandled effect type: "${effect.type}"`);
    }
  }

  _emitSkillEvent(skill, effect) {
    EventBus.emit(EVENTS.VIRUS_SKILL_TRIGGERED, {
      virus:  this._virus.id,
      skill:  skill.id,
      effect: effect.type,
    });
  }
}
