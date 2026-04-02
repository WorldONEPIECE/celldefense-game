/**
 * virus-ai.js — 病毒行为引擎
 * 完全 JSON 驱动，不硬编码任何病毒名/数值。
 *
 * 修订历史：
 *   v1.0 T6 — 初始实现
 *   v1.1 T7 — 修复被动技能未触发、HSV潜伏触发器未实现、
 *             resource_drain永久状态用Infinity修复、
 *             setVirus清空nullifiedCards；
 *             新增过载状态跟踪，潜伏/再激活逻辑内聚至本模块。
 *
 * 触发器类型说明：
 *   on_first_turn              — 病毒入侵时立即触发一次
 *   passive                    — 病毒入侵时永久生效（和 on_first_turn 同时处理）
 *   on_virus_turn              — 每个病毒回合开始检查
 *   on_viral_load_cleared_attempt — 病毒回合检查：载量 ≤ 清零阈值时触发（HSV潜伏）
 */

import EventBus, { EVENTS } from './engine/event-bus.js';

export class VirusAI {
  /**
   * @param {Object}         virusesData   — viruses.json 完整内容
   * @param {Object}         globalConfig  — balance.json global 部分
   * @param {ResourceSystem} resources
   * @param {Object}         gameState
   */
  constructor(virusesData, globalConfig, resources, gameState) {
    this._allViruses  = virusesData;
    this._globalCfg   = globalConfig;
    this._resources   = resources;
    this._gameState   = gameState;

    this._virus            = null;
    this._virusTurnCount   = 0;
    this._isOverloaded     = false;
    this._provirusEstablished = false;

    this._inLatency              = false;
    this._latencyCountdown       = 0;
    this._latencyReactivationLoad = 0;
  }

  setVirus(virusId) {
    const v = this._allViruses[virusId];
    if (!v) throw new Error(`[VirusAI] Unknown virus: "${virusId}"`);

    this._virus               = v;
    this._virusTurnCount      = 0;
    this._isOverloaded        = false;
    this._provirusEstablished = false;
    this._inLatency           = false;
    this._latencyCountdown    = 0;
    this._latencyReactivationLoad = 0;

    this._gameState.nullifiedCards.clear();
    this._gameState.viralLoadFloor = 0;
    this._gameState.isOverloaded   = false;

    console.log(`[VirusAI] Virus set: ${virusId}`);
  }

  processVirusEntry() {
    if (!this._virus) return;

    this._resources.set('viral_load', this._virus.initial_load ?? 0);

    for (const theft of this._virus.resource_theft ?? []) {
      if (theft.trigger === 'on_virus_enter') {
        this._addPermanentDrain(theft);
      }
    }

    for (const skill of this._virus.special_skills ?? []) {
      if (skill.trigger === 'on_first_turn' || skill.trigger === 'passive') {
        this._executeSkillEffect(skill);
      }
    }

    EventBus.emit(EVENTS.VIRUS_ENTER, {
      virus:       this._virus.id,
      initialLoad: this._virus.initial_load,
    });
  }

  processTurn() {
    if (!this._virus) return;

    // 潜伏期处理
    if (this._inLatency) {
      this._latencyCountdown--;
      console.log(`[VirusAI] Latency countdown: ${this._latencyCountdown}`);
      if (this._latencyCountdown <= 0) {
        this._inLatency = false;
        this._gameState.viralLoadFloor = 0;
        this._resources.set('viral_load', this._latencyReactivationLoad);
        EventBus.emit(EVENTS.VIRUS_MUTATED, {
          virus: this._virus.id, mutation: 'reactivation', load: this._latencyReactivationLoad,
        });
        console.log('[VirusAI] HSV reactivated!');
      }
      return;
    }

    this._virusTurnCount++;

    // 过载状态更新
    const currentLoad   = this._resources.get('viral_load');
    const threshold     = this._globalCfg.viral_load_overload_threshold;
    const wasOverloaded = this._isOverloaded;
    this._isOverloaded  = currentLoad >= threshold;
    this._gameState.isOverloaded = this._isOverloaded;
    if (this._isOverloaded && !wasOverloaded) {
      EventBus.emit(EVENTS.VIRAL_LOAD_OVERLOAD, { current: currentLoad });
    }

    // 增殖（含过载加成）
    let rep = this._virus.replication_per_turn ?? 0;
    if (this._isOverloaded) rep += this._globalCfg.overload_replication_bonus ?? 0;
    this._resources.delta('viral_load', rep);
    EventBus.emit(EVENTS.VIRUS_REPLICATE, { virus: this._virus.id, amount: rep });

    // 非持续性资源掠夺
    for (const theft of this._virus.resource_theft ?? []) {
      if (theft.trigger === 'on_virus_enter' ||
          theft.trigger === 'on_provirus_established') continue;
      if (theft.trigger_condition && !this._evaluateCondition(theft.trigger_condition)) continue;
      this._resources.delta(theft.resource, theft.delta_per_turn);
    }

    // on_virus_turn 特殊技能
    for (const skill of this._virus.special_skills ?? []) {
      if (skill.trigger !== 'on_virus_turn') continue;
      if (skill.condition && !this._evaluateCondition(skill.condition)) continue;
      this._executeSkillEffect(skill);
    }

    // on_viral_load_cleared_attempt（HSV潜伏触发）
    for (const skill of this._virus.special_skills ?? []) {
      if (skill.trigger !== 'on_viral_load_cleared_attempt') continue;
      if (skill.condition && !this._evaluateCondition(skill.condition)) continue;
      this._executeSkillEffect(skill);
    }
  }

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

  _executeSkillEffect(skill) {
    const effect = skill.effect;
    if (!effect) return;
    console.log(`[VirusAI] Skill: ${skill.id} → ${effect.type}`);

    switch (effect.type) {

      case 'pathway_suppress':
        this._gameState.addSuppressedPathway({
          pathway:         effect.pathway,
          remaining_turns: (effect.duration ?? 1) + 1,
        });
        break;

      case 'defense_structure_damage': {
        const pw = this._gameState.activePathways.find(p => p.pathway === effect.target);
        if (pw) pw.remaining_turns = Math.max(0, pw.remaining_turns - (effect.amount ?? 1));
        EventBus.emit(EVENTS.DEFENSE_LAYER_BREACHED, { target: effect.target, amount: effect.amount });
        break;
      }

      case 'defense_structure_destroy': {
        const idx = this._gameState.activePathways.findIndex(p => p.pathway === effect.target);
        if (idx !== -1) this._gameState.activePathways.splice(idx, 1);
        EventBus.emit(EVENTS.DEFENSE_LAYER_BREACHED, { target: effect.target, destroyed: true });
        break;
      }

      case 'card_nullify':
        this._gameState.addNullifiedCard(effect.card_id);
        break;

      case 'card_efficiency_reduce':
        this._gameState.addStatus({
          type:            'card_efficiency_reduce',
          target_tag:      effect.card_tag  ?? null,
          target_card:     effect.card_id   ?? null,
          multiplier:      effect.multiplier ?? 1,
          remaining_turns: Infinity,
          source_id:       skill.id,
        });
        break;

      case 'discard_card': {
        const idx = this._gameState.hand.findIndex(c => c.id === effect.card_id);
        if (idx !== -1) {
          const [card] = this._gameState.hand.splice(idx, 1);
          this._gameState.discard.push(card);
          EventBus.emit(EVENTS.CARD_DISCARDED, { cardId: card.id, forced: true });
          EventBus.emit(EVENTS.HAND_UPDATED, {
            hand: this._gameState.hand,
            deckSize: this._gameState.deck.length,
            discardSize: this._gameState.discard.length,
          });
        }
        break;
      }

      case 'provirus_establish':
        if (!this._provirusEstablished) {
          this._provirusEstablished = true;
          this._resources.delta('cell_integrity', -(effect.cell_integrity_damage ?? 0));
          this._gameState.viralLoadFloor = effect.viral_load_floor ?? 1;
          for (const theft of this._virus.resource_theft ?? []) {
            if (theft.trigger === 'on_provirus_established') this._addPermanentDrain(theft);
          }
          EventBus.emit(EVENTS.VIRUS_MUTATED, { virus: this._virus.id, mutation: 'provirus' });
        }
        break;

      case 'latency_enter':
        if (!this._inLatency) {
          this._inLatency               = true;
          this._latencyCountdown        = effect.reactivation_turns ?? 3;
          this._latencyReactivationLoad = effect.reactivation_load  ?? 4;
          this._gameState.viralLoadFloor = this._resources.get('viral_load');
          EventBus.emit(EVENTS.VIRUS_MUTATED, { virus: this._virus.id, mutation: 'latency' });
          console.log(`[VirusAI] HSV entered latency. Reactivates in ${this._latencyCountdown} turns.`);
        }
        break;

      default:
        console.warn(`[VirusAI] Unhandled effect type: "${effect.type}"`);
    }

    EventBus.emit(EVENTS.VIRUS_SKILL_TRIGGERED, {
      virus: this._virus.id, skill: skill.id, effect: effect.type,
    });
  }

  _addPermanentDrain(theft) {
    this._gameState.addStatus({
      type:            'resource_drain',
      resource:        theft.resource,
      amount:          theft.delta_per_turn,
      remaining_turns: Infinity,
      source_id:       `${this._virus.id}_${theft.id}`,
    });
  }
}
