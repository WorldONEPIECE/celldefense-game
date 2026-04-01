/**
 * main.js — 游戏主入口
 * 负责：加载配置 → 初始化引擎 → 启动UI渲染循环
 *
 * Phase 1A 实现内容：
 *   - 加载 balance.json / host-profiles.json / cards.json
 *   - 初始化 EventBus / ResourceSystem / I18n / CardSystem / EffectResolver
 *   - 渲染资源面板 + 手牌区
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

// ─── 游戏状态对象 ─────────────────────────────────────────────────────────────

const GameState = {
  phase: 'player_turn',  // 'player_turn' | 'virus_turn' | 'settlement' | 'game_over'
  turnCount: 1,
  hand: [],
  deck: [],
  discard: [],
  activeStatuses: [],
  activePathways: [],
  currentVirus: null,
  isGameOver: false,
  isVictory: false,

  addStatus(status) {
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

  isPathwayActive(pathwayId) {
    return this.activePathways.some(p => p.pathway === pathwayId && p.remaining_turns > 0);
  },

  tickStatuses() {
    this.activeStatuses = this.activeStatuses.filter(s => --s.remaining_turns > 0);
    this.activePathways = this.activePathways.filter(p => --p.remaining_turns > 0);
  },
};

// ─── 全局引擎实例 ─────────────────────────────────────────────────────────────

let resources = null;
let ui = null;
let threeScene = null;
let cardSystem = null;

// ─── 启动流程 ─────────────────────────────────────────────────────────────────

async function boot() {
  console.log('[CellDefense] Booting...');

  // 1. 加载配置
  const [balanceCfg, hostProfiles, cardsData] = await Promise.all([
    fetchJSON('./data/balance.json'),
    fetchJSON('./data/host-profiles.json'),
    fetchJSON('./data/cards.json'),
  ]);

  // 2. 加载语言包
  await i18n.load('zh-CN');

  // 3. 初始化资源系统
  const hostProfile = hostProfiles['default'];
  resources = new ResourceSystem(balanceCfg, hostProfile);
  resources.init();

  // 4. 初始化效果解析器
  const effectResolver = new EffectResolver(resources, GameState);

  // 5. 初始化卡牌系统
  cardSystem = new CardSystem(cardsData, balanceCfg, resources, effectResolver, GameState, i18n);
  cardSystem.loadCards();
  cardSystem.buildStarterDeck();

  // 6. 绑定核心事件
  bindCoreEvents();

  // 7. 初始化UI渲染器
  ui = new UIRenderer(resources, GameState, i18n);
  ui.init();

  // 8. 初始化 Three.js 背景
  threeScene = new ThreeScene(document.getElementById('three-canvas'));
  threeScene.init();
  threeScene.startLoop();

  // 9. 开始第一回合
  startPlayerTurn();

  console.log('[CellDefense] Boot complete.');
  EventBus.emit(EVENTS.GAME_START, { turn: 1 });
}

// ─── 核心事件绑定 ─────────────────────────────────────────────────────────────

function bindCoreEvents() {
  // 游戏结束
  EventBus.on(EVENTS.GAME_OVER, ({ reason }) => {
    GameState.isGameOver = true;
    GameState.phase = 'game_over';
    ui?.showGameOver(false);
  });

  EventBus.on(EVENTS.GAME_VICTORY, () => {
    GameState.isVictory = true;
    GameState.phase = 'game_over';
    ui?.showGameOver(true);
  });

  // 病毒载量清零 → 胜利
  EventBus.on(EVENTS.RESOURCE_DEPLETED, ({ id }) => {
    if (id === 'viral_load') {
      EventBus.emit(EVENTS.GAME_VICTORY, {});
    }
  });

  // 资源变化 → 更新UI
  EventBus.on(EVENTS.RESOURCE_CHANGED, () => {
    ui?.renderResourcePanel();
  });

  // 手牌更新 → 重渲手牌区
  EventBus.on(EVENTS.HAND_UPDATED, () => {
    ui?.renderHandArea();
  });

  // 动画触发 → Phase 1C 实现
  EventBus.on(EVENTS.ANIMATION_TRIGGER, ({ animation }) => {
    console.log(`[Animation] Trigger: ${animation} (3D animations activate in Phase 1C)`);
  });
}

// ─── 回合流程 ─────────────────────────────────────────────────────────────────

function startPlayerTurn() {
  if (GameState.isGameOver) return;
  GameState.phase = 'player_turn';
  EventBus.emit(EVENTS.TURN_START, { turn: GameState.turnCount });
  EventBus.emit(EVENTS.PLAYER_TURN_START, { turn: GameState.turnCount });

  // 回合开始资源再生
  resources.processTurnRegen();

  // 抽牌
  cardSystem.draw(resources._globalParams.draw_per_turn);

  // 状态持续时间-1
  GameState.tickStatuses();

  ui?.renderAll();
}

function endPlayerTurn() {
  if (GameState.phase !== 'player_turn') return;

  // 弃所有手牌
  cardSystem.discardHand();

  EventBus.emit(EVENTS.PLAYER_TURN_END, { turn: GameState.turnCount });
  runVirusTurn();
}

function runVirusTurn() {
  GameState.phase = 'virus_turn';
  EventBus.emit(EVENTS.VIRUS_TURN_START, { turn: GameState.turnCount });

  // Phase 1A 占位：T6实现 VirusAI 后替换
  if (GameState.currentVirus) {
    const replication = GameState.currentVirus.replication_per_turn || 0;
    resources.delta('viral_load', replication);
    EventBus.emit(EVENTS.VIRUS_REPLICATE, {
      virus: GameState.currentVirus.id,
      amount: replication,
    });
  }

  EventBus.emit(EVENTS.VIRUS_TURN_END, { turn: GameState.turnCount });
  runSettlement();
}

function runSettlement() {
  GameState.phase = 'settlement';
  EventBus.emit(EVENTS.TURN_SETTLEMENT, { turn: GameState.turnCount });

  // 结算持续状态效果（resource_generate 类型）
  for (const status of GameState.activeStatuses) {
    if (status.type === 'resource_generate') {
      resources.delta(status.resource, status.amount);
    }
  }

  GameState.turnCount++;
  ui?.renderAll();

  setTimeout(() => startPlayerTurn(), 300);
}

// ─── 全局暴露（给 HTML 按钮调用）──────────────────────────────────────────────

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
