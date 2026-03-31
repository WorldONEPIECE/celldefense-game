import EventBus, { EVENTS } from './engine/event-bus.js';
import { ResourceSystem } from './engine/resource-system.js';
import i18n from './engine/i18n.js';
import { ThreeScene } from './three-scene.js';
import { UIRenderer } from './ui-renderer.js';

const GameState = {
  phase: 'player_turn',
  turnCount: 1,
  hand: [], deck: [], discard: [],
  activeStatuses: [], activePathways: [],
  currentVirus: null,
  isGameOver: false, isVictory: false,

  addStatus(status) { this.activeStatuses.push(status); },
  addActivePathway(pathway) {
    const ex = this.activePathways.find(p => p.pathway === pathway.pathway);
    if (ex) ex.remaining_turns = Math.max(ex.remaining_turns, pathway.remaining_turns);
    else this.activePathways.push(pathway);
  },
  isPathwayActive(id) { return this.activePathways.some(p => p.pathway === id && p.remaining_turns > 0); },
  tickStatuses() {
    this.activeStatuses = this.activeStatuses.filter(s => --s.remaining_turns > 0);
    this.activePathways = this.activePathways.filter(p => --p.remaining_turns > 0);
  },
};

let resources = null, ui = null, threeScene = null;

async function boot() {
  console.log('[CellDefense] Booting...');
  const [balanceCfg, hostProfiles] = await Promise.all([
    fetchJSON('./data/balance.json'),
    fetchJSON('./data/host-profiles.json'),
  ]);
  await i18n.load('zh-CN');
  resources = new ResourceSystem(balanceCfg, hostProfiles['default']);
  resources.init();
  bindCoreEvents();
  ui = new UIRenderer(resources, GameState, i18n);
  ui.init();
  threeScene = new ThreeScene(document.getElementById('three-canvas'));
  threeScene.init();
  threeScene.startLoop();
  startPlayerTurn();
  console.log('[CellDefense] Boot complete.');
  EventBus.emit(EVENTS.GAME_START, { turn: 1 });
}

function bindCoreEvents() {
  EventBus.on(EVENTS.GAME_OVER, () => { GameState.isGameOver = true; GameState.phase = 'game_over'; ui?.showGameOver(false); });
  EventBus.on(EVENTS.GAME_VICTORY, () => { GameState.isVictory = true; GameState.phase = 'game_over'; ui?.showGameOver(true); });
  EventBus.on(EVENTS.RESOURCE_DEPLETED, ({ id }) => { if (id === 'viral_load') EventBus.emit(EVENTS.GAME_VICTORY, {}); });
  EventBus.on(EVENTS.RESOURCE_CHANGED, () => ui?.renderResourcePanel());
  EventBus.on(EVENTS.ANIMATION_TRIGGER, ({ animation }) => console.log(`[Animation] ${animation} (Phase 1C)`));
}

function startPlayerTurn() {
  if (GameState.isGameOver) return;
  GameState.phase = 'player_turn';
  EventBus.emit(EVENTS.TURN_START, { turn: GameState.turnCount });
  EventBus.emit(EVENTS.PLAYER_TURN_START, { turn: GameState.turnCount });
  resources.processTurnRegen();
  GameState.tickStatuses();
  ui?.renderAll();
}

function endPlayerTurn() {
  if (GameState.phase !== 'player_turn') return;
  EventBus.emit(EVENTS.PLAYER_TURN_END, { turn: GameState.turnCount });
  runVirusTurn();
}

function runVirusTurn() {
  GameState.phase = 'virus_turn';
  EventBus.emit(EVENTS.VIRUS_TURN_START, { turn: GameState.turnCount });
  if (GameState.currentVirus) {
    const rep = GameState.currentVirus.replication_per_turn || 0;
    resources.delta('viral_load', rep);
    EventBus.emit(EVENTS.VIRUS_REPLICATE, { virus: GameState.currentVirus.id, amount: rep });
  }
  EventBus.emit(EVENTS.VIRUS_TURN_END, { turn: GameState.turnCount });
  runSettlement();
}

function runSettlement() {
  GameState.phase = 'settlement';
  EventBus.emit(EVENTS.TURN_SETTLEMENT, { turn: GameState.turnCount });
  for (const s of GameState.activeStatuses)
    if (s.type === 'resource_generate') resources.delta(s.resource, s.amount);
  GameState.turnCount++;
  ui?.renderAll();
  setTimeout(() => startPlayerTurn(), 300);
}

window.CellDefense = {
  endTurn: endPlayerTurn,
  getState: () => GameState,
  getResources: () => resources,
  debug: { setDebug: (v) => EventBus.setDebug(v), listEvents: () => EventBus.listEvents(), deltaResource: (id, n) => resources.delta(id, n) }
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
