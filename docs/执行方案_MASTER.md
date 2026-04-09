# CellDefense 执行方案
**项目路径：** `D:\0.1__StudyGame\cellgame` | **GitHub：** `WorldONEPIECE/celldefense-game` (main)
**运行方式：** `cd D:\0.1__StudyGame\cellgame\src && python -m http.server 8080` → 访问 `http://localhost:8080`（必须用本地服务器，file://协议fetch被CORS拦截）

---

## 给下一个 Claude 的操作规范

**每次对话必须做的事：**
1. 先读本文件 + `docs/进度记录.md`，绝不问已有答案的问题
2. 所有代码用 Filesystem MCP 写到 `src/`，不要只贴对话框
3. **Push 时机：本地测试第一版无 bug 后才 push，不要在写完代码时自动 push**
4. commit 格式 `[T编号] 简述`
5. 对话结束前更新 `docs/进度记录.md`（本文件只在架构变化时才改）
6. **每次改代码先做跨文件自检**：构造函数参数、事件名、GameState字段、emit/listen 对称性

**MCP 工具链（Windows，全用 node 直接路径，禁止 npx）：**
- `Filesystem` → 读写本地文件（allowed: `D:\0.1__StudyGame\cellgame\`）
- `GitHub` → push 到 `WorldONEPIECE/celldefense-game`

---

## 项目是什么

浏览器直接运行的 Roguelike 卡牌游戏（类 Slay the Spire），以**真实细胞免疫学**为核心机制。玩家用卡牌代表免疫反应对抗真实病毒（5种，NCBI数据）。

**技术栈：** HTML5 + Three.js r158（从CDN静态加载） + 原生 ES6 JS，零构建工具，浏览器直开。

**当前可玩状态（T14后）：**
- 病毒选择界面（5种病毒/难度）→ Roguelike地图生成（5层随机分支）→ 打牌战斗 → 胜利弹奖励卡选择 → 弹地图选下一节点 → 循环至HIV最终关结束
- 右侧面板实时显示活跃免疫通路（绿色）和被病毒压制的通路（红色⛔）
- 防线层8层根据活跃通路动态高亮

---

## 文件结构（当前完整）

```
src/
├─ index.html               ← 主界面+所有CSS+病毒选择UI+覆盖层HTML
│                             静态加载 main.js（type=module）
├─ data/
│   ├─ balance.json         ← 7种资源定义+全局参数+starter_deck(10张)
│   ├─ host-profiles.json   ← 宿主档案
│   ├─ cards.json           ← 40张卡完整数据（36张Phase1可用，4张Phase2）
│   ├─ viruses.json         ← 5种病毒完整数据（含NCBI登录号和行为树）
│   ├─ events.json          ← 5个随机事件（E01-E05，加权随机）
│   ├─ levels.json          ← 5关配置（T12+T13，含branch_weight）
│   └─ i18n/
│       ├─ zh-CN.json       ← 完整中文包（含pathways.*键值，T14新增）
│       └─ en-US.json       ← 空存根（Phase 2填）
└─ js/
    ├─ main.js              ← 启动+回合流程+关卡流程 v1.6（T13+T14）
    ├─ ui-renderer.js       ← DOM渲染 v1.2（T14：活跃通路+防线层联动）
    ├─ map-system.js        ← Roguelike分支地图系统（T13新增）
    ├─ three-scene.js       ← Three.js静态细胞背景
    ├─ card-system.js       ← 抽/打/弃/洗牌逻辑
    ├─ virus-ai.js          ← 病毒行为引擎（v1.2，不再覆盖viral_load）
    ├─ event-system.js      ← 随机事件系统
    └─ engine/
        ├─ event-bus.js         ← 全局事件总线（29个标准事件常量）
        ├─ resource-system.js   ← 注册表式资源
        ├─ i18n.js              ← 多语言引擎
        └─ effect-resolver.js   ← 卡牌效果解析器（支持效率系数）
```

---

## 架构铁律（违反会破坏整个系统）

```
❌ JS 里出现裸数字 → 必须从 balance.json 读
❌ JS 里硬编码中文字符串 → 必须走 i18n.get('key')
❌ 在 JS 里写死卡牌效果逻辑 → 效果全在 cards.json effects 数组，由 EffectResolver 执行
❌ 修改现有 EventBus 事件名称
❌ 永久状态用 9999 → 必须用 Infinity（Infinity-1===Infinity，不会被 tickStatuses 消耗）
❌ levels.json 里的 _comment 字符串会被 Object.values() 取出 → 过滤条件必须是 l && typeof l === 'object' && l.virus_id
```

---

## 关键接口

### 构造函数签名
```js
new ResourceSystem(balanceConfig, hostProfile)
new EffectResolver(resourceSystem, gameState)
new CardSystem(cardsData, balanceCfg, resources, effectResolver, gameState, i18n)
new VirusAI(virusesData, globalConfig, resources, gameState)   // globalConfig = balanceCfg.global
new EventSystem(eventsData, globalCfg, resources, effectResolver, gameState, i18n)
new UIRenderer(resources, gameState, i18n, globalCfg)          // globalCfg 第4个，默认{}
new MapSystem(levelsData, virusesData, i18n, gameState, onNodeSelected)  // T13
```

### GameState 关键字段
```js
GameState = {
  phase,           // 'player_turn'|'virus_turn'|'settlement'|'game_over'
  turnCount,
  hand, deck, discard,
  activeStatuses,      // [{type, remaining_turns, source_id?, ...}]
  activePathways,      // [{pathway, remaining_turns}]
  suppressedPathways,
  nullifiedCards,      // Set<string>
  currentVirus,        // viruses.json 中的完整对象
  isGameOver, isVictory,
  isOverloaded,
  viralLoadFloor,      // HIV/HSV 阻止 viral_load 归零触发胜利
  mapState,            // T13：MapSystem 写入，startNextLevel() 不得清零
}
```

### 资源 ID（7个）
`atp` `amino_acid` `nucleotide` `cell_integrity` `oxidative_stress` `viral_load` `fatigue`

### 病毒 ID（5个）
`influenza_h1n1` `sars_cov_2` `adenovirus_5` `hsv_1` `hiv_1`

### 关键事件流

**回合循环：**
```
startPlayerTurn → [资源再生, 抽牌, renderAll]
endPlayerTurn → cardSystem.discardHand() → runVirusTurn
runVirusTurn → GameState.tickStatuses() → virusAI.processTurn() → runSettlement
runSettlement → [结算持续状态] → eventSystem.checkAndTrigger()
  ↳ 触发事件 → 等待 RANDOM_EVENT_RESOLVED → startPlayerTurn
  ↳ 不触发   → setTimeout(startPlayerTurn, 300)
```

**胜负：**
```
cell_integrity → 0  : ResourceSystem emit GAME_OVER
viral_load → 0      : RESOURCE_DEPLETED → 检查 viralLoadFloor
  ↳ floor > 0 (HIV/HSV) : resources.set('viral_load', floor)，阻止胜利
  ↳ floor === 0          : emit GAME_VICTORY → handleVictory()
```

**GAME_VICTORY 路径（T12+T13）：**
```
handleVictory()
  ↳ next_level === null（HIV）→ ui.showGameOver(true)  // 最终胜利，无地图
  ↳ reward_count > 0 → showRewardOverlay(choices) → 玩家选1张 → selectRewardCard()
      ↳ mapSystem.showMapOverlay() → 玩家选节点 → startNextLevel(levelId)
  ↳ reward_count = 0 → mapSystem.showMapOverlay()
```

### startNextLevel() 关键步骤（不得乱序）
```js
// 1. 清空上一关病毒状态（mapState 保留！）
GameState.activeStatuses = []; GameState.activePathways = [];
GameState.suppressedPathways = []; GameState.nullifiedCards.clear();
// 2. 重置标志
GameState.isGameOver = false; GameState.isVictory = false;
GameState.isOverloaded = false; GameState.viralLoadFloor = 0;
GameState.phase = 'player_turn'; GameState.turnCount = 1;
// 3. 资源归base
resources.reset(); resources.set('viral_load', level.initial_viral_load);
// 4. 合并牌组（保留积累，不重建starter deck）
GameState.deck = cardSystem.shuffle([...GameState.deck, ...GameState.discard]);
GameState.discard = []; GameState.hand = [];
// 5. 切换病毒（自动清 viralLoadFloor/isOverloaded/nullifiedCards）
virusAI.setVirus(level.virus_id); GameState.currentVirus = virusesData[level.virus_id];
// 6. 触发病毒进入效果（不再覆盖viral_load，已在步骤3设定）
virusAI.processVirusEntry();
```

### processVirusEntry() 重要说明
**不在此处设置 viral_load**。boot() 和 startNextLevel() 已按 levels.json 的 `initial_viral_load` 设好，如果在此重覆会破坏关卡差异化。

### MapSystem 生命周期
```js
mapSystem.generateMap()  // boot() 末尾调用一次，写入 GameState.mapState
mapSystem.showMapOverlay()  // 每关胜利后（选完奖励卡后）调用
// boss层（layer 4，HIV）只有1个节点，showMapOverlay 自动选择，不弹窗
// 节点选择后回调 onNodeSelected(levelId) → startNextLevel(levelId)
```

### levels.json 结构
```json
{
  "level_1": {
    "id": "level_1", "name_key": "levels.level_1.name",
    "virus_id": "influenza_h1n1", "initial_viral_load": 3,
    "branch_weight": 40,
    "reward_pool": ["cgas_sensing", ...], "reward_count": 3,
    "next_level": "level_2"
  }
}
```

### PATHWAY_LAYER_MAP（ui-renderer.js 中定义）
通路ID → 防线层索引（0-7），基于免疫学位置，T14新增。修改时需同步 `docs/执行方案_MASTER.md`。

### VirusAI 触发器类型
| 触发器 | 处理时机 |
|--------|----------|
| `passive` / `on_first_turn` | processVirusEntry() |
| `on_virus_turn` | processTurn() 每回合 |
| `on_viral_load_cleared_attempt` | processTurn() 末尾（HSV潜伏） |

### cardSystem._cardPool
是 `Map`，用 `.get(id)` 访问。过滤 `pool_excluded_phase1:true` 的卡（4张Phase2卡不在Phase1池中）。

---

## 游戏核心数值（来自 balance.json）

| 参数 | 值 |
|------|-----|
| 每回合抽牌 | 2 |
| 起始牌组 | 10张 |
| 过载阈值 | 20（viral_load >= 20） |
| 过载增殖加成 | +1/回合 |
| 随机事件间隔 | 3-5 回合 |

---

## 调试命令（控制台）

```js
CellDefense.debug.deltaResource('viral_load', -100)  // 触发胜利
CellDefense.debug.jumpToLevel('level_5')             // 跳到HIV关
CellDefense.debug.showMap()                          // 强制显示地图
CellDefense.getState().viralLoadFloor = 0            // 解除HIV潜伏锁
CellDefense.getMap()                                 // 查看地图状态
```

---

*v5.0 — 最后更新：T13+T14 完成并推送（commit 520f430）*
