# CellDefense：细胞防御 — 执行方案
**版本：** v3.0（精简版）| **项目路径：** `D:\0.1__StudyGame\cellgame` | **GitHub：** WorldONEPIECE/celldefense-game

---

## ⚠️ 给下一个Claude：必读

你是技术合作伙伴。洋哥是病毒学研究生，主要靠你写代码。规则：

1. **先读两个文档**，不要问已有答案的问题
2. **每次对话结束**：代码推GitHub，更新进度记录
3. **病毒机制必须真实**，数据从NCBI MCP查
4. **代码写进文件**，用Filesystem MCP写到 `src/`，不要只贴对话
5. **绝对不写死数据**，所有数值/文字/效果全走JSON + i18n

**MCP工具链**（Windows，均用node直接路径，禁用npx）：

| MCP | 用途 |
|-----|------|
| Filesystem | 读写 `D:\0.1__StudyGame\cellgame` |
| GitHub | 仓库 WorldONEPIECE/celldefense-game，main分支 |
| NCBI Datasets | 查病毒基因组/蛋白/机制 |
| Scrapling Fetch | 抓取生物数据库页面 |

**commit格式：** `[T编号] 任务简述`

---

## 一、项目定位

真实细胞生物学驱动的Roguelike卡牌游戏（类Slay the Spire）。玩家操控真核细胞免疫系统，抵御5种真实病毒入侵。技术栈：HTML5 + Three.js r158 + 原生JS ES6+，浏览器直接运行。

**版本规划：**
- Phase 1（当前）：单细胞版，5种病毒，40张卡，10关
- Phase 2（未来）：宿主体质差异（运动员/吸烟者/老年），生活方式强化牌
- Phase 3（远期）：多细胞协作

---

## 二、架构约束（永远不得违反）

### 禁止事项
```
❌ JS/HTML里出现裸数字（如 const baseATP = 3）
❌ JS/HTML里硬编码中文字符串
❌ 在JS引擎里写死卡牌效果逻辑
❌ 破坏现有EventBus事件命名规范
```

### 数据层结构（已实现）
```
src/data/
├─ balance.json        ← 7种资源定义 + 全局参数（已完成）
├─ host-profiles.json  ← default档案 + Phase 2体质预留（已完成）
├─ cards.json          ← 40张卡完整数据（已完成）
├─ viruses.json        ← 5种病毒NCBI数据（已完成）
├─ events.json         ← 待实现（T11）
├─ levels.json         ← 待实现（T12）
└─ i18n/
    ├─ zh-CN.json      ← 完整中文语言包（已完成）
    └─ en-US.json      ← 存根，Phase 2填充
```

### 引擎层结构（已实现）
```
src/js/
├─ main.js             ← 启动流程 + 回合骨架（已完成）
├─ ui-renderer.js      ← 2D界面渲染（已完成，手牌待对接）
├─ three-scene.js      ← 静态细胞背景（已完成）
├─ engine/
│   ├─ event-bus.js    ← EventBus + 29个标准事件（已完成）
│   ├─ resource-system.js ← 注册表式资源（已完成）
│   ├─ i18n.js         ← 多语言引擎（已完成）
│   └─ effect-resolver.js ← 组件化效果解析器（已完成）
├─ card-system.js      ← 待实现（T4后半）
├─ virus-ai.js         ← 待实现（T6）
└─ event-system.js     ← 待实现（T11）
```

### 资源系统规范
7种资源：`atp / amino_acid / nucleotide / cell_integrity / oxidative_stress / viral_load / fatigue`
所有访问通过 `ResourceSystem.get(id)` / `.delta(id, amount)` / `.set(id, value)`。
宿主数值通过 `hostProfile.resource_modifiers` 修正，引擎不含裸数字。

### EventBus标准事件（29个，不得重命名）
回合类：`game_start / turn_start / player_turn_start / player_turn_end / virus_turn_start / virus_turn_end / turn_settlement / turn_end`
卡牌类：`card_drawn / card_played / card_discarded / hand_updated / deck_shuffled`
资源类：`resource_changed / resource_overflow / resource_depleted`
病毒类：`virus_enter / virus_replicate / virus_action / virus_skill_triggered / virus_mutated / viral_load_overload / viral_load_cleared`
其他：`defense_layer_activated / defense_layer_breached / pathway_triggered / status_applied / status_expired / fatigue_changed / oxidative_stress_peak / random_event_triggered / random_event_resolved / animation_trigger / animation_complete / game_over / game_victory`
Phase2预留：`host_profile_changed / language_changed / adjacent_cell_signal`

---

## 三、游戏核心机制

### 资源系统

| 资源 | 生物对应 | 基础值/回合 | 特殊规则 |
|------|---------|-----------|---------|
| ATP | 细胞能量 | +3 | 大多数卡的消耗 |
| 氨基酸池 | 蛋白质原料 | +2 | 合成防御蛋白 |
| 核苷酸池 | RNA/DNA原料 | +1 | 核酸感应、DNA修复 |
| 细胞完整性 | 细胞结构 | 0（初100） | 归零游戏结束 |
| 氧化应激 | ROS积累 | +1 | 满格扣完整性-10 |
| 病毒载量 | 胞内病毒数 | 由病毒决定 | 过载阈值20 |
| 细胞疲劳度 | 持续应激 | -1（自愈） | 高消耗卡+1 |

**疲劳惩罚：** 疲劳>10时所有正资源产量-1；>20时产量-2
**过载状态：** viral_load ≥ 20，病毒获得额外技能

### 八层防线
```
层0 胞外预警 → 层1 细胞膜 → 层2 内体/溶酶体
→ 层3 细胞质感应 → 层4 细胞器网络 → 层5 细胞骨架
→ 层6 核周/核孔 → 层7 细胞核
```

### 消耗战机制
- **病毒载量**：每回合自动增殖（流感+2，冠状+1，腺病毒+1.5，HSV+1，HIV+0.5）
- **资源争夺**：冠状NSP1→氨基酸-1/回合；HIV整合后→核苷酸-1；腺病毒E1A→偶数回合ATP-1
- **随机事件**：每3-5回合触发一次（5个初版，EventBus接口无限扩展）

### 卡牌系统（40张，cards.json已完成）
7类：模式识别(8) / 干扰素通路(6) / 炎症招募(6) / 降解清除(6) / 结构防御(6) / 应急响应(4) / Enhancement预留(4，pool_excluded_phase1:true)

**稀有度：** common / uncommon / rare / legendary
**起始牌组（Phase 1A）：** 10张，从common/uncommon各选若干，排除enhancement类

### 5种病毒（viruses.json已完成，含NCBI数据）

| 病毒 | 基因组 | 载量+/回合 | 核心机制 | 专克卡 |
|------|--------|-----------|---------|--------|
| 流感H1N1 (NC_002023) | ssRNA- | +2 | NS1抑RIG-I；PB1-F2损MAVS | lysosome_fusion / nuclear_pore_block |
| SARS-CoV-2 (NC_045512) | ssRNA+ | +1 | NSP1-氨基酸-1；ORF3a阻自噬 | close_ace2 / cgas_sensing |
| 腺病毒5 (AC_000008) | dsDNA | +1.5 | VA RNA抗PKR；E1A-ATP节律 | dynein_competition / lysosome_fusion |
| HSV-1 (NC_001806) | dsDNA | +1 | ICP0毁PML；Us3抗凋亡；可潜伏 | cgas_sensing / pml_repair |
| HIV-1 (NC_001802) | ssRNA-RT | +0.5 | Vif降APOBEC3G；整合永久损伤 | samhd1_activation / apobec3g_protection |

---

## 四、开发进度

### Phase 1A：可运行原型
| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | HTML主框架 + CSS布局 + UIRenderer | ✅ |
| T2 | ResourceSystem + balance.json | ✅ |
| T3 | EventBus + i18n + EffectResolver + zh-CN.json | ✅ |
| T4 | cards.json(40张) + **CardSystem类**（抽/打/弃/洗） | 🔴 数据✅ 逻辑待 |
| T5 | 回合逻辑完善（打牌循环/弃手牌/疲劳UI） | ⬜ |
| T6 | VirusAI（流感行为树，JSON驱动） | ⬜ |
| T7 | 胜负判定完善（过载状态/清零胜利） | ⬜ |
| T8 | Three.js静态细胞背景 | ✅ |

### Phase 1B：内容完善（T9-T14）
T9完善所有40张卡 / T10全部5种病毒AI / T11随机事件系统 / T12关卡配置 / T13 Roguelike地图 / T14卡牌升级选择

### Phase 1C：打磨（T15-T20）
T15触发动画 / T16 Enhancement卡启用 / T17学术注释 / T18病毒图鉴 / T19平衡 / T20 UI美化+存档

---

## 五、下一步任务（T4后半 → T5 → T6）

### T4后半：card-system.js（首要）

```
src/js/card-system.js 需要实现：
- CardSystem类，构造函数接收 (cardsData, balanceConfig, resources, effectResolver, gameState, i18n)
- loadCards()：从cards.json读取，过滤pool_excluded_phase1:true
- buildStarterDeck()：构建起始10张牌组（可配置，建议balance.json里定义starter_deck列表）
- shuffle()：Fisher-Yates洗牌
- draw(n)：抽n张到手牌，牌堆空则洗弃牌堆，触发CARD_DRAWN事件
- playCard(cardId)：
    1. canAfford检查
    2. ResourceSystem.pay(cost)
    3. EffectResolver.resolve(effects)
    4. ResourceSystem.applyCardFatigue(cost.atp)
    5. 从手牌移到弃牌堆
    6. 触发CARD_PLAYED事件
- discardHand()：回合结束弃所有手牌
- 手牌变化时触发 HAND_UPDATED 事件 → UIRenderer.renderHandArea()
```

**main.js改动：** boot()里初始化CardSystem，`window.CellDefense.playCard = (id) => cardSystem.playCard(id)`

### T5：回合逻辑对接
- `startPlayerTurn()`里调用 `cardSystem.draw(balance.draw_per_turn)`
- `endPlayerTurn()`里调用 `cardSystem.discardHand()`
- 回合信息栏显示手牌数/剩余牌数

### T6：VirusAI（流感先做）
```
src/js/virus-ai.js 需要实现：
- VirusAI类，从viruses.json读取行为定义
- processTurn(virusId, resources, gameState)：
    1. 载量增殖（replication_per_turn）
    2. 资源掠夺（resource_theft）
    3. 特殊技能判断（special_skills的trigger和condition）
- 行为完全JSON驱动，VirusAI不硬编码任何病毒名/数值
- 触发 VIRUS_REPLICATE / VIRUS_SKILL_TRIGGERED 事件
```

**注意：** 当前main.js的runVirusTurn()有占位逻辑，接入VirusAI后替换。GameState.currentVirus设为 `viruses.influenza_h1n1`。

---

## 六、美术管线（简述）

- **Phase 1A-1B**：全部色块占位（color_placeholder字段），专注引擎
- **卡牌尺寸**：220×320px（插画60% / 文字40%）
- **Phase 1C**：Nano Banana（Google Gemini，科学插图风）批量生成40张插画
- **提示词模板**：`Scientific illustration style, cell biology textbook, [内容], colorful anatomical diagram, white background, no text, portrait ratio`
- **3D动画**：Phase 1C T15才实现，Phase 1A-1B Three.js只做静态背景

---

## 七、新对话启动指令

```
请用Filesystem MCP读取以下两个文件：
- D:\0.1__StudyGame\cellgame\docs\执行方案_MASTER.md
- D:\0.1__StudyGame\cellgame\docs\进度记录.md
读完后告诉我你理解这个项目了吗，当前应该执行哪个任务。
我的GitHub用户名是：WorldONEPIECE
```

---
*v3.0 — 精简版，Phase 1A数据层完成，引擎层完成，下一步T4后半(CardSystem)*
