# CellDefense 执行方案
**项目路径：** `D:\0.1__StudyGame\cellgame` | **GitHub：** `WorldONEPIECE/celldefense-game` (main)

---

## 给下一个 Claude 的操作规范

**每次对话必须做的事：**
- 先读本文件 + 进度记录.md，绝不问已有答案的问题
- 所有代码用 Filesystem MCP 写到 `src/`，不要只贴对话框
- 同一对话内所有文件写完后**一次性** push GitHub，commit 格式 `[T编号] 简述`
- 对话结束前更新进度记录.md（本文件只在架构变化时才改）
- **每次改代码先做跨文件自检**：构造函数参数、事件名、GameState字段、emit/listen 对称性

**MCP 工具链（Windows，全用 node 直接路径，禁止 npx）：**
- `Filesystem` → 读写本地文件
- `GitHub` → push 到 `WorldONEPIECE/celldefense-game`
- `NCBI Datasets` → 查病毒真实数据
- `Scrapling Fetch` → 抓生物数据库页面

---

## 项目是什么

浏览器直接运行的 Roguelike 卡牌游戏（类 Slay the Spire），以**真实细胞免疫学**为核心机制。玩家用卡牌代表免疫反应对抗真实病毒（5种，均有 NCBI 数据）。

技术栈：**HTML5 + Three.js r158 + 原生 ES6 JS**，零构建工具，浏览器直开。

**当前可玩状态：** 打开 index.html → 选病毒 → 打牌 → 随机事件会弹出 → 胜负判定正常。是完整可玩原型，缺关卡链和美化。

---

## 架构铁律（违反会破坏整个系统）

```
❌ JS 里出现裸数字（如 const hp = 100）→ 必须从 balance.json 读
❌ JS 里硬编码中文字符串 → 必须走 i18n.get('key')
❌ 在 JS 里写死卡牌效果逻辑 → 效果全在 cards.json effects 数组，由 EffectResolver 执行
❌ 修改现有 EventBus 事件名称
❌ 永久状态用 9999 → 必须用 Infinity（Infinity-1===Infinity，不会被 tickStatuses 消耗）
```

---

## 当前文件结构（全部已推 GitHub）

```
src/
├─ index.html               ← 主界面 + 病毒选择 UI（CSS全在里面）
├─ data/
│   ├─ balance.json         ← 7种资源定义 + 全局参数 + starter_deck（10张）
│   ├─ host-profiles.json   ← 宿主档案（default + Phase2预留）
│   ├─ cards.json           ← 40张卡完整数据（36张Phase1可用，4张Phase2）
│   ├─ viruses.json         ← 5种病毒完整数据（含NCBI登录号和行为树）
│   ├─ events.json          ← 5个随机事件（E01-E05，加权随机）
│   ├─ levels.json          ← ❌ 待实现 (T12)
│   └─ i18n/
│       ├─ zh-CN.json       ← 完整中文包（卡/病毒/事件/UI全覆盖）
│       └─ en-US.json       ← 空存根（Phase 2 填）
└─ js/
    ├─ main.js              ← 启动流程 + 回合骨架 + 全局事件绑定
    ├─ ui-renderer.js       ← DOM 渲染（资源面板/手牌/病毒面板/游戏结束）
    ├─ three-scene.js       ← 静态 Three.js 细胞背景（Phase 1C 才做动画）
    ├─ card-system.js       ← 抽/打/弃/洗牌逻辑
    ├─ virus-ai.js          ← 病毒行为引擎（完全 JSON 驱动）
    ├─ event-system.js      ← 随机事件系统
    └─ engine/
        ├─ event-bus.js         ← 全局事件总线（29个标准事件常量）
        ├─ resource-system.js   ← 注册表式资源（从 balance.json 读，不含裸数字）
        ├─ i18n.js              ← 多语言引擎
        └─ effect-resolver.js   ← 卡牌效果解析器（支持效率系数）
```

---

## 关键接口（改动任何一个必须同步其他文件）

### 构造函数签名
```js
new ResourceSystem(balanceConfig, hostProfile)
new EffectResolver(resourceSystem, gameState)
new CardSystem(cardsData, balanceCfg, resources, effectResolver, gameState, i18n)
new VirusAI(virusesData, globalConfig, resources, gameState)    // globalConfig = balanceCfg.global
new EventSystem(eventsData, globalCfg, resources, effectResolver, gameState, i18n)
new UIRenderer(resources, gameState, i18n, globalCfg)          // globalCfg 第4个，默认{}
```

### GameState 关键字段
```js
GameState = {
  phase,           // 'player_turn'|'virus_turn'|'settlement'|'game_over'
  turnCount,
  hand, deck, discard,
  activeStatuses,      // [{type, remaining_turns, source_id?, ...}]
  activePathways,      // [{pathway, remaining_turns}]
  suppressedPathways,  // 病毒压制的通路，isPathwayActive() 会排除
  nullifiedCards,      // Set<string>，被病毒废除效果的卡ID
  currentVirus,        // viruses.json 中的完整对象
  isGameOver, isVictory,
  isOverloaded,        // viral_load >= overload_threshold，由 RESOURCE_CHANGED 事件维护
  viralLoadFloor,      // HIV整合/HSV潜伏时 >0，阻止 viral_load 归零触发胜利
}
```

### 资源 ID（7个，全小写）
`atp` `amino_acid` `nucleotide` `cell_integrity` `oxidative_stress` `viral_load` `fatigue`

### 病毒 ID（5个）
`influenza_h1n1` `sars_cov_2` `adenovirus_5` `hsv_1` `hiv_1`

### 关键事件流

**回合循环：**
```
startPlayerTurn → [资源再生, 抽牌, 渲染]
endPlayerTurn → cardSystem.discardHand() → runVirusTurn
runVirusTurn → GameState.tickStatuses() → virusAI.processTurn() → runSettlement
runSettlement → [结算持续状态] → eventSystem.checkAndTrigger()
  ↳ 若触发事件 → 等待 RANDOM_EVENT_RESOLVED → startPlayerTurn
  ↳ 若不触发   → setTimeout(startPlayerTurn, 300)
```

**胜负：**
```
cell_integrity → 0  : ResourceSystem emit GAME_OVER
viral_load → 0      : RESOURCE_DEPLETED → 检查 viralLoadFloor
  ↳ floor > 0 (HIV/HSV) : resources.set('viral_load', floor)，阻止胜利
  ↳ floor === 0          : emit GAME_VICTORY
```

**tickStatuses 时序（不得改变）：** 在 `runVirusTurn()` 开头调用。病毒本回合加的压制（remaining+1补偿）在下一个玩家回合有效。

**VIRAL_LOAD_OVERLOAD 归属：** 只由 VirusAI.processTurn() 在过载状态**转变时**发出。resource-system.js 不发这个事件。

### VirusAI 触发器类型
| 触发器 | 何时处理 |
|--------|----------|
| `passive` | processVirusEntry()，永久生效 |
| `on_first_turn` | processVirusEntry()，触发一次 |
| `on_virus_turn` | processTurn() 每病毒回合检查 |
| `on_viral_load_cleared_attempt` | processTurn() 末尾（HSV潜伏用） |

### EffectResolver 效率系数
打出卡牌时，resolve() 先计算 `_getCardEfficiencyMultiplier(card)`：
遍历 activeStatuses 中 type=`card_efficiency_reduce` 的条目，按 `target_tag` 或 `target_card` 匹配叠乘。正值效果乘系数，负值（代价）不受影响。

### 病毒选择流
`index.html selectVirus(id)` → `window._selectedVirus = id` → `startGame()` → `import main.js` → `boot()` 读 `window._selectedVirus ?? 'influenza_h1n1'`

---

## 游戏核心数值（来自 balance.json，供参考）

| 参数 | 值 |
|------|----|
| 每回合抽牌 | 2 |
| 起始牌组 | 10张（balance.json global.starter_deck） |
| 过载阈值 | 20（viral_load >= 20 触发过载） |
| 过载增殖加成 | +1/回合 |
| 疲劳高消耗阈值 | ATP花费 >= 3 时 fatigue+1 |
| 氧化应激溢出伤害 | cell_integrity -10 |
| 随机事件间隔 | 3-5 回合（加权随机选取） |

---

## 下一步任务：T12 关卡配置

### 需要新建的文件
`src/data/levels.json`：

```json
{
  "level_1": {
    "id": "level_1",
    "name_key": "levels.level_1.name",
    "virus_id": "influenza_h1n1",
    "initial_viral_load": 3,
    "reward_pool": ["cgas_sensing", "lysosome_fusion", "jak_stat", "release_ifnb", "nk_recruit"],
    "reward_count": 3,
    "next_level": "level_2"
  },
  "level_2": { "virus_id": "adenovirus_5", "next_level": "level_3", ... },
  "level_3": { "virus_id": "sars_cov_2", "next_level": "level_4", ... },
  "level_4": { "virus_id": "hsv_1", "next_level": "level_5", ... },
  "level_5": { "virus_id": "hiv_1", "next_level": null, ... }
}
```

### 需要修改的文件

**main.js：**
1. boot() 并行加载 levels.json，存储 `let virusesData` 供关卡切换用
2. 新增 `let currentLevelId = 'level_1'`
3. GAME_VICTORY 事件处理器改为调用 `handleVictory()` 而非直接 showGameOver
4. 实现 `handleVictory()`：
   - 从 levelsData[currentLevelId].reward_pool 随机抽 reward_count 张（不重复，只取 cardPool 里有的）
   - 显示奖励选择 UI → 玩家选1张 → 加入 gameState.deck
   - 若 next_level 存在 → startNextLevel(next_level)
   - 若 next_level 为 null → ui.showGameOver(true)（真正的最终胜利）
5. 实现 `startNextLevel(levelId)`：
   - **清空病毒挂的持续状态**：`GameState.activeStatuses = GameState.activeStatuses.filter(s => s.remaining_turns !== Infinity)`
   - `resources.reset()`
   - 保留已积累牌组：`GameState.deck = cardSystem.shuffle([...GameState.deck, ...GameState.discard]); GameState.discard = []; GameState.hand = []`
   - `virusAI.setVirus(level.virus_id)` （内部会清 nullifiedCards/viralLoadFloor）
   - `GameState.currentVirus = virusesData[level.virus_id]`
   - `virusAI.processVirusEntry()` （设初始载量）
   - `GameState.turnCount = 1; currentLevelId = levelId`
   - `startPlayerTurn()`

**index.html：** 新增 `#reward-overlay`（样式参考 event-overlay，按钮3个）

**zh-CN.json：** 新增 `"levels": { "level_1": { "name": "第一关：流感入侵" }, ... }`

### T12 注意事项
- 奖励卡从 `cardSystem._cardPool`（Map 对象）里随机取，已过滤 pool_excluded_phase1:true 的卡
- 同一张卡允许多次出现在牌组里（Roguelike 标准）
- startNextLevel 必须先清 Infinity 持续状态，否则上一关病毒效果会延续
- resources.reset() 会把 viral_load 重置为 base=0，不需要额外处理

---
*v3.2 — 最后更新：Phase 1B T9/T10/T11 完成后*
