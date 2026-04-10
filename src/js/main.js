/**
 * main.js v1.7 T15+T16
 * T15: Three.js触发动画 | T16: Enhancement卡解锁
 */

import EventBus, { EVENTS } from './engine/event-bus.js';
import { ResourceSystem }  from './engine/resource-system.js';
import { EffectResolver }  from './engine/effect-resolver.js';
import i18n                from './engine/i18n.js';
import { ThreeScene }      from './three-scene.js';
import { UIRenderer }      from './ui-renderer.js';
import { CardSystem }      from './card-system.js';
import { VirusAI }         from './virus-ai.js';
import { EventSystem }     from './event-system.js';
import { MapSystem }       from './map-system.js';

const GameState = {
  phase: 'player_turn', turnCount: 1,
  hand: [], deck: [], discard: [],
  activeStatuses: [], activePathways: [], suppressedPathways: [],
  nullifiedCards: new Set(),
  currentVirus: null,
  isGameOver: false, isVictory: false, isOverloaded: false,
  viralLoadFloor: 0, mapState: null,

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
    else    this.activePathways.push(pathway);
  },
  addSuppressedPathway(pathway) {
    const ex = this.suppressedPathways.find(p => p.pathway === pathway.pathway);
    if (ex) ex.remaining_turns = Math.max(ex.remaining_turns, pathway.remaining_turns);
    else    this.suppressedPathways.push(pathway);
  },
  addNullifiedCard(id)  { this.nullifiedCards.add(id); },
  isCardNullified(id)   { return this.nullifiedCards.has(id); },
  isPathwayActive(id) {
    const active     = this.activePathways.some(p => p.pathway === id && p.remaining_turns > 0);
    const suppressed = this.suppressedPathways.some(p => p.pathway === id && p.remaining_turns > 0);
    return active && !suppressed;
  },
  tickStatuses() {
    this.activeStatuses     = this.activeStatuses.filter(s => --s.remaining_turns > 0);
    this.activePathways     = this.activePathways.filter(p => --p.remaining_turns > 0);
    this.suppressedPathways = this.suppressedPathways.filter(p => --p.remaining_turns > 0);
  },
};

let resources=null, ui=null, threeScene=null, cardSystem=null, virusAI=null;
let eventSystem=null, mapSystem=null, globalCfg=null, effectResolver=null;
let virusesData=null, levelsData=null, currentLevel=null;

async function boot() {
  console.log('[CellDefense] Booting...');
  const [balanceCfg, hostProfiles, cardsData, _virusesData, eventsData, _levelsData] = await Promise.all([
    fetchJSON('./data/balance.json'), fetchJSON('./data/host-profiles.json'),
    fetchJSON('./data/cards.json'),   fetchJSON('./data/viruses.json'),
    fetchJSON('./data/events.json'),  fetchJSON('./data/levels.json'),
  ]);
  globalCfg=balanceCfg.global; virusesData=_virusesData; levelsData=_levelsData;
  await i18n.load('zh-CN');
  resources = new ResourceSystem(balanceCfg, hostProfiles['default']);
  resources.init();
  effectResolver = new EffectResolver(resources, GameState);
  cardSystem = new CardSystem(cardsData, balanceCfg, resources, effectResolver, GameState, i18n);
  cardSystem.loadCards();
  cardSystem.buildStarterDeck();
  const selectedVirusId = window._selectedVirus ?? 'influenza_h1n1';
  currentLevel = Object.values(levelsData).find(l => l && typeof l === 'object' && l.virus_id === selectedVirusId) ?? levelsData['level_1'];
  virusAI = new VirusAI(virusesData, globalCfg, resources, GameState);
  virusAI.setVirus(selectedVirusId);
  GameState.currentVirus = virusesData[selectedVirusId];
  eventSystem = new EventSystem(eventsData, globalCfg, resources, effectResolver, GameState, i18n);
  mapSystem = new MapSystem(levelsData, virusesData, i18n, GameState, (levelId) => startNextLevel(levelId));
  mapSystem.generateMap();
  _syncMapStateToStartLevel(currentLevel.id);
  bindCoreEvents();
  ui = new UIRenderer(resources, GameState, i18n, globalCfg);
  ui.init();
  threeScene = new ThreeScene(document.getElementById('three-canvas'));
  threeScene.init();
  threeScene.startLoop();
  resources.set('viral_load', currentLevel.initial_viral_load);
  virusAI.processVirusEntry();
  _updateLevelIndicator();
  startPlayerTurn();
  console.log(`[CellDefense] Boot complete. Level: ${currentLevel.id} | Virus: ${selectedVirusId}`);
  EventBus.emit(EVENTS.GAME_START, { turn: 1 });
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.classList.add('hidden');
}

function _syncMapStateToStartLevel(levelId) {
  const ms = GameState.mapState;
  if (!ms || !ms.layers[0]) return;
  const startNode = ms.layers[0].find(n => n.levelId === levelId);
  if (startNode) console.log(`[MapSystem] Start node synced: ${levelId}`);
}

function bindCoreEvents() {
  EventBus.on(EVENTS.GAME_OVER, () => { GameState.isGameOver=true; GameState.phase='game_over'; ui?.showGameOver(false); });
  EventBus.on(EVENTS.GAME_VICTORY, () => { GameState.isVictory=true; GameState.phase='game_over'; handleVictory(); });
  EventBus.on(EVENTS.RESOURCE_DEPLETED, ({ id }) => {
    if (id !== 'viral_load') return;
    if (GameState.viralLoadFloor > 0) resources.set('viral_load', GameState.viralLoadFloor);
    else EventBus.emit(EVENTS.GAME_VICTORY, {});
  });
  EventBus.on(EVENTS.RESOURCE_CHANGED, ({ id }) => {
    if (id === 'viral_load') {
      const nowOverloaded = resources.get('viral_load') >= globalCfg.viral_load_overload_threshold;
      if (nowOverloaded !== GameState.isOverloaded) { GameState.isOverloaded=nowOverloaded; ui?.renderVirusPanel(); }
    }
    ui?.renderResourcePanel();
  });
  EventBus.on(EVENTS.VIRAL_LOAD_OVERLOAD, ({ current }) => { console.log(`[CellDefense] OVERLOAD! viral_load=${current}`); ui?.renderTurnInfo(); });
  EventBus.on(EVENTS.HAND_UPDATED, () => { ui?.renderHandArea(); });
  EventBus.on(EVENTS.RANDOM_EVENT_RESOLVED, () => { ui?.renderAll(); setTimeout(() => startPlayerTurn(), 300); });

  // T15: Three.js 触发动画
  EventBus.on(EVENTS.CARD_PLAYED, ({ card }) => { threeScene?.triggerAnimation(_cardTypeToAnim(card?.category)); });
  EventBus.on(EVENTS.VIRUS_REPLICATE, () => threeScene?.triggerAnimation('viral_attack'));
  EventBus.on(EVENTS.VIRUS_ACTION,    () => threeScene?.triggerAnimation('viral_attack'));
  EventBus.on(EVENTS.VIRAL_LOAD_OVERLOAD, () => threeScene?.triggerAnimation('overload'));
  EventBus.on(EVENTS.GAME_VICTORY, () => threeScene?.triggerAnimation('victory'));
  EventBus.on(EVENTS.ANIMATION_TRIGGER, ({ animation }) => {
    if (animation?.includes('activation') || animation?.includes('sensing')) threeScene?.triggerAnimation('innate');
    else threeScene?.triggerAnimation('default');
  });
}

function _cardTypeToAnim(category) {
  const MAP = {
    pattern_recognition:'innate', signal_transduction:'innate', innate_immune:'innate', interferon_pathway:'innate',
    effector_response:'attack', adaptive_immune:'attack', cytotoxic:'attack', apoptosis:'attack',
    metabolic:'metabolic', enhancement:'metabolic', repair:'metabolic', antioxidant:'metabolic',
  };
  return MAP[category] ?? 'default';
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
  GameState.tickStatuses();
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
    if (s.type === 'resource_generate' || s.type === 'resource_drain') resources.delta(s.resource, s.amount);
  }
  GameState.turnCount++;
  ui?.renderAll();
  const eventTriggered = eventSystem?.checkAndTrigger(GameState.turnCount) ?? false;
  if (!eventTriggered) setTimeout(() => startPlayerTurn(), 300);
}

function handleVictory() {
  if (!currentLevel) { ui?.showGameOver(true); return; }
  if (currentLevel.next_level === null) { ui?.showGameOver(true); return; }
  if (currentLevel.reward_count > 0 && currentLevel.reward_pool.length > 0) {
    const candidates = currentLevel.reward_pool.map(id => cardSystem._cardPool.get(id)).filter(Boolean);
    const choices = cardSystem.shuffle(candidates).slice(0, currentLevel.reward_count);
    if (choices.length > 0) { showRewardOverlay(choices); return; }
  }
  mapSystem?.showMapOverlay();
}

function showRewardOverlay(choices) {
  const overlay=document.getElementById('reward-overlay'), container=document.getElementById('reward-cards'), subtitleEl=document.getElementById('reward-level-name');
  if (!overlay || !container) { mapSystem?.showMapOverlay(); return; }
  subtitleEl.textContent = `${i18n.get(currentLevel.name_key)||currentLevel.id} — 已清除`;
  container.innerHTML = '';
  for (const card of choices) {
    const name=i18n.get(`cards.${card.id}.name`)||card.id, desc=i18n.get(`cards.${card.id}.description`)||'';
    const rarityLabelMap={common:'普通',uncommon:'非凡',rare:'稀有',legendary:'传说'};
    const costStr=card.cost ? Object.entries(card.cost).map(([r,v])=>`${i18n.get(`ui.resources.${r}`)||r} ${v}`).join('  ') : '免费';
    const el=document.createElement('div');
    el.className='reward-card';
    el.innerHTML=`<div class="reward-card-name">${name}</div><div class="reward-card-rarity rarity-${card.rarity||'common'}">${rarityLabelMap[card.rarity]||''}</div><div class="reward-card-cost">消耗：${costStr}</div><div class="reward-card-desc">${desc}</div>`;
    el.addEventListener('click', () => selectRewardCard(card));
    container.appendChild(el);
  }
  overlay.style.display='flex';
}

function selectRewardCard(card) {
  document.getElementById('reward-overlay').style.display='none';
  if (card) { cardSystem._cardPool.set(card.id, card); GameState.deck.push({...card}); console.log(`[T12] Reward: ${card.id} → deck ${GameState.deck.length}`); }
  mapSystem?.showMapOverlay();
}

function startNextLevel(levelId) {
  const level = levelsData?.[levelId];
  if (!level) { console.error(`[T13] Level not found: "${levelId}"`); ui?.showGameOver(true); return; }
  currentLevel = level;
  console.log(`[CellDefense] → Level ${levelId} | Virus: ${level.virus_id}`);
  GameState.activeStatuses=[]; GameState.activePathways=[]; GameState.suppressedPathways=[]; GameState.nullifiedCards.clear();
  GameState.isGameOver=false; GameState.isVictory=false; GameState.isOverloaded=false; GameState.viralLoadFloor=0;
  GameState.phase='player_turn'; GameState.turnCount=1;
  resources.reset(); resources.set('viral_load', level.initial_viral_load);
  GameState.deck=cardSystem.shuffle([...GameState.deck,...GameState.discard]); GameState.discard=[]; GameState.hand=[];
  virusAI.setVirus(level.virus_id); GameState.currentVirus=virusesData[level.virus_id];
  virusAI.processVirusEntry();
  _updateLevelIndicator();
  ui?.renderAll();
  setTimeout(() => startPlayerTurn(), 600);
}

function _updateLevelIndicator() {
  const el=document.getElementById('level-indicator');
  if (!el || !currentLevel) return;
  el.textContent = i18n.get(currentLevel.name_key)||currentLevel.id;
}

window.CellDefense = {
  endTurn: endPlayerTurn,
  playCard: (id) => cardSystem?.playCard(id),
  getState: () => GameState, getResources: () => resources,
  getCardStats: () => cardSystem?.getStats(),
  getCurrentLevel: () => currentLevel, getMap: () => GameState.mapState,
  debug: {
    setDebug: (v) => EventBus.setDebug(v), listEvents: () => EventBus.listEvents(),
    deltaResource: (id,n) => resources.delta(id,n),
    setVirus: (id) => { virusAI.setVirus(id); virusAI.processVirusEntry(); },
    jumpToLevel: (levelId) => { GameState.isVictory=false; GameState.isGameOver=false; startNextLevel(levelId); },
    showMap: () => mapSystem?.showMapOverlay(),
    triggerAnim: (type) => threeScene?.triggerAnimation(type),
  },
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

window._cellDefenseBoot = () => {
  boot().catch(err => {
    console.error('[CellDefense] Boot failed:', err);
    const screen = document.getElementById('loading-screen');
    if (screen) screen.innerHTML = `<div style="color:#ff4455;font-family:monospace;padding:2rem;text-align:center;"><h2 style="margin-bottom:1rem;">启动失败</h2><pre style="font-size:11px;opacity:0.7;">${err.stack}</pre></div>`;
  });
};
