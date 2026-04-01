/**
 * main.js — 游戏主入口
 * 负责：加载配置 → 初始化引擎 → 启动UI渲染循环
 *
 * Phase 1A 实现内容：
 *   - 加载 balance.json / host-profiles.json / cards.json / viruses.json
 *   - 初始化 EventBus / ResourceSystem / I18n / CardSystem / EffectResolver / VirusAI
 *   - 渲染资源面板 + 手牌区 + 病毒面板
 *   - 回合推进：玩家回合（抽牌→打牌→弃牌）→ 病毒回合 → 结算
 *   - 初始化 Three.js 背景场景（静态细胞）
 */

import EventBus, { EVENTS } from './engine/event-bus.js';
import { ResourceSystem } from './engine/resource-system.js';
import { EffectResolver } from './engine/effect-resolver.js';
import i18n from './engine/i18n.js';
import { ThreeScene } from './three-scene.js';
import { UIRenderer } from './ui-renderer.js';
import { CardSystem } from './card-system.js';
import { VirusAI } from './virus-ai.js';

// ─── 游戏状态对象 ─────────────────────────────────────────────────────────────

const GameState = {
  phase: 'player_turn',
  turnCount: 1,
  hand: [],
  deck: [],
  discard: [],
  activeStatuses: [],
  activePathways: [],
  suppressedPathways: [],
  nullifiedCards: new Set(),
  currentVirus: null,
  isGameOver: false,
  isVictory: false,
  viralLoadFloor: 0,
  latencyReactivationIn: 0,
  latencyReactivationLoad: 0,

  addStatus(status) {
    if (status.source_id) {
      const idx = this.activeStatuses.findIndex(s => s.source_id === status.source_id);
      if (idx !== -1) { this.activeStatuses[idx] = status; return; }
    }
    this.activeStatuses.push(status);
  },

  addActivePathway(pathway) {
    const existing = this.activePathways.find(p => p.pathway === pathway.pathway);
    if (existing) {
      existing.remaining_turns = Math.max(existing.remaining_turns, pathway.remaining_turns);
    } else {
      this.activePathways.push(pathway);
    }
  },

  addSuppressedPathway(pathway) {
    const existing = this.suppressedPathways.find(p => p.pathway === pathway.pathway);
    if (existing) {
      existing.remaining_turns = Math.max(existing.remaining_turns, pathway.remaining_turns);
    } else {
      this.suppressedPathways.push(pathway);
    }
  },

  addNullifiedCard(cardId) {
    this.nullifiedCards.add(cardId);
  },

  isPathwayActive(pathwayId) {
    const active     = this.activePathways.some(p => p.pathway === pathwayId && p.remaining_turns > 0);
    const suppressed = this.suppressedPathways.some(p => p.pathway === pathwayId && p.remaining_turns > 0);
    return active && !suppressed;
  },

  isCardNullified(cardId) {
    return this.nullifiedCards.has(cardId);
  },

  tickStatuses() {
    this.activeStatuses     = this.activeStatuses.filter(s => --s.remaining_turns > 0);
    this.activePathways     = this.activePathways.filter(p => --p.remaining_turns > 0);
    this.suppressedPathways = this.suppressedPathways.filter(p => --p.remaining_turns > 0);
    // nullifiedCards 被动型，不自动移除
  },
};

// ─── 全局引擎实例 ─────────────────────────────────────────────────────────────

let resources  = null;
let ui         = null;
let threeScene = null;
let cardSystem = null;
let virusAI    = null;

// ─── 启动流程 ─────────────────────────────────────────────────────────────────

async function boot() {
  console.log('[CellDefense] Booting...');

  const [balanceCfg, hostProfiles, cardsData, virusesData] = await Promise.all([
    fetchJSON('./data/balance.json'),
    fetchJSON('./data/host-profiles.json'),
    fetchJSON('./data/cards.json'),
    fetchJSON('./data/viruses.json'),
  ]);

  await i18n.load('zh-CN');

  const hostProfile = hostProfiles['default'];
  resources = new ResourceSystem(balanceCfg, hostProfile);
  resources.init();

  const effectResolver = new EffectResolver(resources, GameState);

  cardSystem = new CardSystem(cardsData, balanceCfg, resources, effectResolver, GameState, i18n);
  cardSystem.loadCards();
  cardSystem.buildStarterDeck();

  virusAI = new VirusAI(virusesData, resources, GameState);
  virusAI.setVirus('influenza_h1n1');
  GameState.currentVirus = virusesData['influenza_h1n1'];

  bindCoreEvents();

  ui = new UIRenderer(resources, GameState, i18n);
  ui.init();

  threeScene = new ThreeScene(document.getElementById('three-canvas'));
  threeScene.init();
  threeScene.startLoop();

  virusAI.processVirusEntry();

  startPlayerTurn();

  console.log('[CellDefense] Boot complete.');
  EventBus.emit(EVENTS.GAME_START, { turn: 1 });
}

// ─── 核心事件绑定 ─────────────────────────────────────────────────────────────

function bindCoreEvents() {
  EventBus.on(EVENTS.GAME_OVER, () => {
    GameState.isGameOver = true;
    GameState.phase = 'game_over';
    ui?.showGameOver(false);
  });

  EventBus.on(EVENTS.GAME_VICTORY, () => {
    GameState.isVictory = true;
    GameState.phase = 'game_over';
    ui?.showGameOver(true);
  });

  // 病毒载量归零 → 检查 viralLoadFloor（HIV整合/HSV潜伏时不得归零）
  EventBus.on(EVENTS.RESOURCE_DEPLETED, ({ id }) => {
    if (id !== 'viral_load') return;
    if (GameState.viralLoadFloor > 0) {
      resources.set('viral_load', GameState.viralLoadFloor);
      console.log(`[CellDefense] viral_load floored to ${GameState.viralLoadFloor}`);
    } else {
      EventBus.emit(EVENTS.GAME_VICTORY, {});
    }
  });

  EventBus.on(EVENTS.RESOURCE_CHANGED, () => { ui?.renderResourcePanel(); });
  EventBus.on(EVENTS.HAND_UPDATED,     () => { ui?.renderHandArea(); });

  EventBus.on(EVENTS.ANIMATION_TRIGGER, ({ animation }) => {
    console.log(`[Animation] Trigger: ${animation} (Phase 1C)`);
  });
}

// ─── 回合流程 ─────────────────────────────────────────────────────────────────

function startPlayerTurn() {
  if (GameState.isGameOver) return;
  GameState.phase = 'player_turn';
  EventBus.emit(EVENTS.TURN_START,        { turn: GameState.turnCount });
  EventBus.emit(EVENTS.PLAYER_TURN_START, { turn: GameState.turnCount });

  resources.processTurnRegen();
  cardSystem.draw(resources._globalParams.draw_per_turn);

  ui?.renderAll();
}

function endPlayerTurn() {
  if (GameState.phase !== 'player_turn') return;
  cardSystem.discardHand();
  EventBus.emit(EVENTS.PLAYER_TURN_END, { turn: GameState.turnCount });
  runVirusTurn();
}

function runVirusTurn() {
  // tickStatuses 在病毒回合开头执行，保证病毒本回合加入的压制在下个玩家回合有效
  GameState.tickStatuses();

  // HSV 潜伏再激活倒计时
  if (GameState.latencyReactivationIn > 0) {
    GameState.latencyReactivationIn--;
    if (GameState.latencyReactivationIn === 0 && GameState.latencyReactivationLoad > 0) {
      resources.set('viral_load', GameState.latencyReactivationLoad);
      EventBus.emit(EVENTS.VIRUS_MUTATED, { virus: GameState.currentVirus?.id, mutation: 'reactivation' });
    }
  }

  GameState.phase = 'virus_turn';
  EventBus.emit(EVENTS.VIRUS_TURN_START, { turn: GameState.turnCount });

  virusAI.processTurn();

  EventBus.emit(EVENTS.VIRUS_TURN_END, { turn: GameState.turnCount });
  runSettlement();
}

function runSettlement() {
  GameState.phase = 'settlement';
  EventBus.emit(EVENTS.TURN_SETTLEMENT, { turn: GameState.turnCount });

  // 结算持续状态（resource_generate 和 resource_drain 统一处理）
  for (const status of GameState.activeStatuses) {
    if (status.type === 'resource_generate' || status.type === 'resource_drain') {
      resources.delta(status.resource, status.amount);
    }
  }

  GameState.turnCount++;
  ui?.renderAll();

  setTimeout(() => startPlayerTurn(), 300);
}

// ─── 全局暴露 ─────────────────────────────────────────────────────────────────

window.CellDefense = {
  endTurn:      endPlayerTurn,
  playCard:     (id) => cardSystem?.playCard(id),
  getState:     () => GameState,
  getResources: () => resources,
  getCardStats: () => cardSystem?.getStats(),
  debug: {
    setDebug:      (v) => EventBus.setDebug(v),
    listEvents:    () => EventBus.listEvents(),
    deltaResource: (id, n) => resources.delta(id, n),
    setVirus:      (id) => { virusAI.setVirus(id); virusAI.processVirusEntry(); },
  },
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

// ─── 启动 ─────────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error('[CellDefense] Boot failed:', err);
  document.body.innerHTML = `
    <div style="color:red;padding:2rem;font-family:monospace;">
      <h2>启动失败</h2>
      <pre>${err.stack}</pre>
    </div>`;
});
