/**
 * main.js — 游戏主入口
 *
 * v1.3 T7：过载状态跟踪，VIRAL_LOAD_OVERLOAD 绑定，
 *          HSV 潜伏逻辑内聚至 VirusAI，VirusAI 接收 globalConfig
 */

import EventBus, { EVENTS } from './engine/event-bus.js';
import { ResourceSystem } from './engine/resource-system.js';
import { EffectResolver } from './engine/effect-resolver.js';
import i18n from './engine/i18n.js';
import { ThreeScene } from './three-scene.js';
import { UIRenderer } from './ui-renderer.js';
import { CardSystem } from './card-system.js';
import { VirusAI } from './virus-ai.js';

const GameState = {
  phase: 'player_turn',
  turnCount: 1,
  hand: [], deck: [], discard: [],
  activeStatuses: [], activePathways: [], suppressedPathways: [],
  nullifiedCards: new Set(),
  currentVirus: null,
  isGameOver: false, isVictory: false,
  isOverloaded: false,
  viralLoadFloor: 0,

  addStatus(status) {
    if (status.source_id) {
      const idx = this.activeStatuses.findIndex(s => s.source_id === status.source_id);
      if (idx !== -1) { this.activeStatuses[idx] = status; return; }
    }
    this.activeStatuses.push(status);
  },
  addActivePathway(pathway) {
    const ex = this.activePathways.find(p => p.pathway === pathway.pathway);
    if (ex) ex.remaining_turns = Math.max(ex.remaining_turns, pathway.remaining_turns);
    else this.activePathways.push(pathway);
  },
  addSuppressedPathway(pathway) {
    const ex = this.suppressedPathways.find(p => p.pathway === pathway.pathway);
    if (ex) ex.remaining_turns = Math.max(ex.remaining_turns, pathway.remaining_turns);
    else this.suppressedPathways.push(pathway);
  },
  addNullifiedCard(id)  { this.nullifiedCards.add(id); },
  isCardNullified(id)   { return this.nullifiedCards.has(id); },
  isPathwayActive(id) {
    const active     = this.activePathways.some(p => p.pathway === id && p.remaining_turns > 0);
    const suppressed = this.suppressedPathways.some(p => p.pathway === id && p.remaining_turns > 0);
    return active && !suppressed;
  },
  tickStatuses() {
    // Infinity - 1 === Infinity，永久状态不被移除
    this.activeStatuses     = this.activeStatuses.filter(s => --s.remaining_turns > 0);
    this.activePathways     = this.activePathways.filter(p => --p.remaining_turns > 0);
    this.suppressedPathways = this.suppressedPathways.filter(p => --p.remaining_turns > 0);
  },
};

let resources = null, ui = null, threeScene = null;
let cardSystem = null, virusAI = null, globalCfg = null;

async function boot() {
  console.log('[CellDefense] Booting...');

  const [balanceCfg, hostProfiles, cardsData, virusesData] = await Promise.all([
    fetchJSON('./data/balance.json'),
    fetchJSON('./data/host-profiles.json'),
    fetchJSON('./data/cards.json'),
    fetchJSON('./data/viruses.json'),
  ]);
  globalCfg = balanceCfg.global;

  await i18n.load('zh-CN');

  resources = new ResourceSystem(balanceCfg, hostProfiles['default']);
  resources.init();

  const effectResolver = new EffectResolver(resources, GameState);

  cardSystem = new CardSystem(cardsData, balanceCfg, resources, effectResolver, GameState, i18n);
  cardSystem.loadCards();
  cardSystem.buildStarterDeck();

  virusAI = new VirusAI(virusesData, globalCfg, resources, GameState);
  virusAI.setVirus('influenza_h1n1');
  GameState.currentVirus = virusesData['influenza_h1n1'];

  bindCoreEvents();

  ui = new UIRenderer(resources, GameState, i18n, globalCfg);
  ui.init();

  threeScene = new ThreeScene(document.getElementById('three-canvas'));
  threeScene.init();
  threeScene.startLoop();

  virusAI.processVirusEntry();
  startPlayerTurn();

  console.log('[CellDefense] Boot complete.');
  EventBus.emit(EVENTS.GAME_START, { turn: 1 });
}

function bindCoreEvents() {
  EventBus.on(EVENTS.GAME_OVER, () => {
    GameState.isGameOver = true; GameState.phase = 'game_over'; ui?.showGameOver(false);
  });
  EventBus.on(EVENTS.GAME_VICTORY, () => {
    GameState.isVictory = true; GameState.phase = 'game_over'; ui?.showGameOver(true);
  });
  EventBus.on(EVENTS.RESOURCE_DEPLETED, ({ id }) => {
    if (id !== 'viral_load') return;
    if (GameState.viralLoadFloor > 0) resources.set('viral_load', GameState.viralLoadFloor);
    else EventBus.emit(EVENTS.GAME_VICTORY, {});
  });
  EventBus.on(EVENTS.RESOURCE_CHANGED, ({ id }) => {
    if (id === 'viral_load') {
      const now = resources.get('viral_load') >= globalCfg.viral_load_overload_threshold;
      if (now !== GameState.isOverloaded) {
        GameState.isOverloaded = now;
        ui?.renderVirusPanel();
      }
    }
    ui?.renderResourcePanel();
  });
  EventBus.on(EVENTS.VIRAL_LOAD_OVERLOAD, ({ current }) => {
    console.log(`[CellDefense] OVERLOAD! viral_load=${current}`);
    ui?.renderTurnInfo();
  });
  EventBus.on(EVENTS.HAND_UPDATED,      () => ui?.renderHandArea());
  EventBus.on(EVENTS.ANIMATION_TRIGGER, ({ animation }) =>
    console.log(`[Animation] ${animation} (Phase 1C)`));
}

function startPlayerTurn() {
  if (GameState.isGameOver) return;
  GameState.phase = 'player_turn';
  EventBus.emit(EVENTS.TURN_START,        { turn: GameState.turnCount });
  EventBus.emit(EVENTS.PLAYER_TURN_START, { turn: GameState.turnCount });
  resources.processTurnRegen();
  cardSystem.draw(globalCfg.draw_per_turn);
  ui?.renderAll();
}

function endPlayerTurn() {
  if (GameState.phase !== 'player_turn') return;
  cardSystem.discardHand();
  EventBus.emit(EVENTS.PLAYER_TURN_END, { turn: GameState.turnCount });
  runVirusTurn();
}

function runVirusTurn() {
  GameState.tickStatuses();  // 病毒回合开头tick：保证本回合加入的压制在下一玩家回合有效
  GameState.phase = 'virus_turn';
  EventBus.emit(EVENTS.VIRUS_TURN_START, { turn: GameState.turnCount });
  virusAI.processTurn();
  EventBus.emit(EVENTS.VIRUS_TURN_END, { turn: GameState.turnCount });
  runSettlement();
}

function runSettlement() {
  GameState.phase = 'settlement';
  EventBus.emit(EVENTS.TURN_SETTLEMENT, { turn: GameState.turnCount });
  for (const s of GameState.activeStatuses) {
    if (s.type === 'resource_generate' || s.type === 'resource_drain') {
      resources.delta(s.resource, s.amount);
    }
  }
  GameState.turnCount++;
  ui?.renderAll();
  setTimeout(() => startPlayerTurn(), 300);
}

window.CellDefense = {
  endTurn:      endPlayerTurn,
  playCard:     (id) => cardSystem?.playCard(id),
  getState:     () => GameState,
  getResources: () => resources,
  getCardStats: () => cardSystem?.getStats(),
  debug: {
    setDebug:      (v)     => EventBus.setDebug(v),
    listEvents:    ()      => EventBus.listEvents(),
    deltaResource: (id, n) => resources.delta(id, n),
    setVirus:      (id)    => { virusAI.setVirus(id); virusAI.processVirusEntry(); },
  },
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

boot().catch(err => {
  console.error('[CellDefense] Boot failed:', err);
  document.body.innerHTML = `<div style="color:red;padding:2rem;font-family:monospace;"><h2>启动失败</h2><pre>${err.stack}</pre></div>`;
});
