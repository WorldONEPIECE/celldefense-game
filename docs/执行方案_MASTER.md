# CellDefense 执行方案
**项目路径：** `D:\0.1__StudyGame\cellgame` | **GitHub：** `WorldONEPIECE/celldefense-game` (main)

---

## 给下一个 Claude 的操作规范

**每次对话必须做的事：**
- 先读本文件 + 进度记录.md，绝不问已有答案的问题
- 所有代码用 Filesystem MCP 写到 `src/`，不要只贴对话框
- **⚠ Push 时机：本地测试第一版无 bug 后才 push，不要在写完代码时自动 push**
- commit 格式 `[T编号] 简述`
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

**当前可玩状态（T12后）：** 打开 index.html → 选病毒（=选关卡起点）→ 打牌 → 胜利弹奖励卡选择 → 自动进入下一关，直到 HIV 最终关结束。完整 5 关链路可运行，缺分支地图和美化。

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

## 当前文件结构

```
src/
├─ index.html               ← 主界面 + 病毒选择UI + 奖励层CSS（全在里面）
├─ data/
│   ├─ balance.json         ← 7种资源定义 + 全局参数 + starter_deck（10张）
│   ├─ host-profiles.json   ← 宿主档案（default + Phase2预留）
│   ├─ cards.json           ← 40张卡完整数据（36张Phase1可用，4张Phase2）
│   ├─ viruses.json         ← 5种病毒完整数据（含NCBI登录号和行为树）
│   ├─ events.json          ← 5个随机事件（E01-E05，加权随机）
│   ├─ levels.json          ← ✅ 5关配置（T12完成）
│   └─ i18n/
│       ├─ zh-CN.json       ← 完整中文包（卡/病毒/事件/UI/levels全覆盖）
│       └─ en-US.json       ← 空存根（Phase 2 填）
└─ js/
    ├─ main.js              ← 启动+回合骨架+关卡流程（v1.5，T12）
    ├─ ui-renderer.js       ← DOM 渲染
    ├─ three-scene.js       ← 静态 Three.js 细胞背景
    ├─ card-system.js       ← 抽/打/弃/洗牌逻辑
    ├─ virus-ai.js          ← 病毒行为引擎（完全 JSON 驱动）
    ├─ event-system.js      ← 随机事件系统
    └─ engine/
        ├─ event-bus.js         ← 全局事件总线（29个标准事件常量）
        ├─ resource-system.js   ← 注册表式资源
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
  suppressedPathways,
  nullifiedCards,      // Set<string>
  currentVirus,        // viruses.json 中的完整对象
  isGameOver, isVictory,
  isOverloaded,        // viral_load >= overload_threshold
  viralLoadFloor,      // HIV/HSV 阻止 viral_load 归零触发胜利
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

**GAME_VICTORY 路径（T12新增）：**
```
handleVictory()
  ↳ reward_count > 0 → showRewardOverlay(choices) → 玩家选 1 张 → selectRewardCard()
      ↳ next_level 存在 → startNextLevel(levelId)
      ↳ next_level null → ui.showGameOver(true)  ← 真正最终胜利
  ↳ reward_count = 0 + next_level 存在 → startNextLevel(levelId)
  ↳ reward_count = 0 + next_level null → ui.showGameOver(true)
```

**tickStatuses 时序（不得改变）：** 在 `runVirusTurn()` 开头调用。

**VIRAL_LOAD_OVERLOAD 归属：** 只由 VirusAI.processTurn() 在过载状态转变时发出，resource-system.js 不发。

### VirusAI 触发器类型
| 触发器 | 何时处理 |
|--------|---------|
| `passive` | processVirusEntry()，永久生效 |
| `on_first_turn` | processVirusEntry()，触发一次 |
| `on_virus_turn` | processTurn() 每病毒回合检查 |
| `on_viral_load_cleared_attempt` | processTurn() 末尾（HSV潜伏用） |

### EffectResolver 效率系数
打出卡牌时 resolve() 计算 `_getCardEfficiencyMultiplier(card)`：遍历 activeStatuses 中 type=`card_efficiency_reduce` 条目，按 target_tag / target_card 匹配叠乘。正值效果乘系数，负值（代价）不受影响。

### 病毒选择 / 关卡启动流（T12后）
```
index.html selectVirus(id) → window._selectedVirus = id → startGame() → import main.js
→ boot() 读 window._selectedVirus → 找对应 level（levels.json 中 virus_id 匹配）
→ currentLevel = 该关卡 → resources.set('viral_load', level.initial_viral_load)
→ virusAI.processVirusEntry() → startPlayerTurn()
```

### startNextLevel() 关键步骤顺序（不得乱序）
```js
// 1. 手动清空上一关病毒挂的所有状态（setVirus() 不清这些）
GameState.activeStatuses = [];
GameState.activePathways = [];
GameState.suppressedPathways = [];
GameState.nullifiedCards.clear();
// 2. 重置游戏标志
GameState.isGameOver = false; GameState.isVictory = false;
GameState.isOverloaded = false; GameState.viralLoadFloor = 0;
GameState.phase = 'player_turn'; GameState.turnCount = 1;
// 3. 资源归 base（viral_load 胜利时已是0，reset不触发事件）
resources.reset();
resources.set('viral_load', level.initial_viral_load);
// 4. 合并牌组（保留积累，不重建 starter deck）
GameState.deck = cardSystem.shuffle([...GameState.deck, ...GameState.discard]);
GameState.discard = []; GameState.hand = [];
// 5. 切换病毒（同时清 viralLoadFloor/isOverloaded/nullifiedCards）
virusAI.setVirus(level.virus_id);
GameState.currentVirus = virusesData[level.virus_id];
// 6. 触发病毒进入效果
virusAI.processVirusEntry();
```

### levels.json 结构
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
  }
  // level_2: adenovirus_5, vl=4 | level_3: sars_cov_2, vl=5
  // level_4: hsv_1, vl=6     | level_5: hiv_1, vl=5, reward_count=0, next_level=null
}
```

---

## 游戏核心数值（来自 balance.json）

| 参数 | 值 |
|------|-----|
| 每回合抽牌 | 2 |
| 起始牌组 | 10张（balance.json global.starter_deck） |
| 过载阈值 | 20（viral_load >= 20 触发过载） |
| 过载增殖加成 | +1/回合 |
| 疲劳高消耗阈值 | ATP花费 >= 3 时 fatigue+1 |
| 氧化应激溢出伤害 | cell_integrity -10 |
| 随机事件间隔 | 3-5 回合 |

---

## 下一步任务：T13 Roguelike 分支地图

**目标：** 在 levels.json 基础上，给玩家展示一个可视化的关卡路线图（类 Slay the Spire 的节点地图），每局随机生成分支路径，玩家选择下一个节点。

**待规划的核心决策（开工前先在本文件更新规格）：**
1. 地图生成算法：固定 5 层 vs 随机分支（几列？几层？）
2. 节点类型：战斗节点 / 事件节点 / 商店节点（Phase 1B 范围内只做战斗节点）
3. 地图 UI：是否用 SVG / Canvas / 纯 DOM？
4. 与 levels.json 的关系：每节点对应一个 virus_id，还是节点类型决定用哪个病毒？
5. 地图状态持久化：在 GameState 中新增 mapState 字段？

**暂定最小实现（供下一个 Claude 参考）：**
- 纯 DOM 地图覆盖层（参考 #reward-overlay 样式）
- 固定 5 层，每层 2 个可选节点，随机分配病毒（除 HIV 固定在第 5 层）
- 玩家选节点 → `startNextLevel(levelId)` → 和现有流程无缝衔接
- levels.json 需扩展：加 `branch_weight` 控制各病毒出现概率

---
*v4.0 — 最后更新：T12 完成（本地ready，待测试后push）*
