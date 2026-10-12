# 任务书：实现《江湖从心》战斗系统

> **文档性质**：可独立交付的实施任务书。执行者（人或 AI 工具）**不需要**任何对话上下文，只需本文件 + 仓库内被引用的文档。
> **版本**：v1.0｜日期：2026-10-11
> **目标工程**：`/Users/zq/game-dev/jianghu-godot/`（Godot **4.7.x** + GDScript）
> **预计规模**：核心逻辑 ≈ 1,800~2,400 行 GDScript + 4 张数据表 + ≈ 60 项测试

---

## 0. 任务一句话

> 在 Godot 工程 `jianghu-godot/` 中实现**战斗系统**：纯逻辑的**战斗预结算内核**（伤害公式 / 出手顺序 / 内力 / 连招 / 词条 / 阵法 / 22 种状态 / 回合上限）+ 产出**表现事件流**供表现层回放，配套**单元与集成测试**、**数值验证报告**、**可视化战斗场景**。

**四条硬性要求**（来自需求方原文）：

| # | 要求 | 落地章节 |
|:-:|------|----------|
| 1 | **基于依赖的模式** | §2（依赖注入 + 分层，禁止反向依赖） |
| 2 | **战斗机制参考游戏设计** | §4、§5（逐条对齐 GDD，含精确公式） |
| 3 | **战斗风格动画参考依赖分析报告** | §6（对齐 `动画复用方案_v1.0.md`） |
| 4 | **优化提示语** | §7（已给出优化后的完整提示语表，直接落表） |

---

## 1. 上下文与现状（执行前必读）

### 1.1 仓库位置与关键文档

| 路径 | 内容 |
|------|------|
| `jianghu-godot/` | **本任务的目标工程**（Godot 4.7） |
| `jianghu-godot/docs/PROJECT_STRUCTURE.md` | 目录与命名规范（**唯一依据**） |
| `jianghu-design/GDD/02_系统设计.md` | 系统设计：**§2.1 战斗系统**、§2.4 功法 |
| `jianghu-design/GDD/03_数值框架.md` | 数值框架：**§3.1 战斗数值**（公式/上下限/权重） |
| `jianghu-design/12_tech/动画复用方案_v1.0.md` | **即需求方所说"依赖分析报告"**：动画分层与功法表现映射 |
| `jianghu-design/05_combat/烟雨江湖战斗对齐.md` | 阵法 / 状态 / 上阵人数成长的来源与决策 |
| `jianghu-game/` | TypeScript + Phaser 原型（动画内核已跑通，可参考但**不要改**） |

### 1.2 工程中已存在、**直接复用**的资产

| 文件 | 提供 |
|------|------|
| `src/core/battle/battle_grid.gd` | `class_name BattleGrid`：九宫格行列映射、同列、等距投影、渲染层级 |
| `src/core/battle/formation_resolver.gd` | `class_name FormationResolver`：阵法站位判定（ok/partial/fail 与 50% 折扣）、加成查询、文案渲染 |
| `src/autoload/event_bus.gd` | 全局事件总线（`battle_started` / `battle_event_fired` / `battle_finished` / `hit_stop_requested` 等信号已定义） |
| `src/autoload/data_registry.gd` | 配置表加载 + 启动校验；`rows(name) -> Array[Dictionary]`、`row(name, id) -> Dictionary` |
| `src/autoload/game_state.gd` | 运行时状态；含 `max_party_size()`、`party_scale()`、修为/境界/声望/正邪值字段 |
| `src/data/tables/*.json` | 已有 5 张表：`formations`(12) / `status`(22) / `gongfa_visual`(87) / `roster_tiers`(4) / `battle_constants`(14)，共 139 行 |
| `scenes/dev/formation_lab.tscn` | 阵法演练台（可作为战斗场景的 UI 参考） |
| `tools/ci/render_frames.sh` | 把真实画面渲染成 PNG（视觉验证） |

### 1.3 可用的命令（**已实测可用，直接抄**）

```bash
GODOT=/Users/zq/Downloads/Godot.app/Contents/MacOS/Godot
cd /Users/zq/game-dev/jianghu-godot

# 单元测试（无头、零依赖，退出码 = 失败用例数）→ 当前 57 项
"$GODOT" --headless --path . --script res://tests/run_tests.gd

# 集成测试（数据表 / 存档往返 / 迁移）→ 当前 33 项
"$GODOT" --headless --path . --scene res://tests/integration/integration_runner.tscn \
         -- --saves-dir="$(pwd)/build/itest"

# 视觉验证：渲染真实画面到 PNG（**不要加 --headless**，加了不出图）
GODOT_BIN="$GODOT" ./tools/ci/render_frames.sh "res://scenes/battle/battle.tscn" 30 build/frames 1280x720

# 运行游戏
"$GODOT" --path . --resolution 1280x720
```

**验收基线**：本任务开始前，上述两组测试应全绿（57 + 33 = **90 项**）。**不要破坏这 90 项。**

---

## 2. 架构要求：基于依赖的模式（**不可协商**）

### 2.1 依赖方向（只允许向下）

```
presentation/  ──→  core/  ──→  data/（接口）
      │                │
      └────────────────┴──→  （autoload 作为装配层，注入进 core）
```

**违规示例（review 直接打回）**：

- `src/core/**` 中出现 `Node` / `Node2D` / `get_tree()` / `await` / `Input.*` / `preload("res://scenes/...")`
- `src/core/**` 中直接引用 autoload 全局名（如 `DataRegistry` / `GameState` / `EventBus`）
- 核心逻辑函数内部 `print()` 调试（应通过返回值/事件上报）

### 2.2 依赖注入：core 通过**接口**取数据，不认识 autoload

**这是本任务"基于依赖的模式"的核心**。做法：

```gdscript
# src/core/battle/combat_data_source.gd
class_name CombatDataSource
extends RefCounted
## 战斗数据的抽象来源（依赖倒置：core 定义接口，装配层提供实现）

func gongfa(id: String) -> Dictionary:      # 功法战斗数据
	return {}
func gongfa_realm(index: int) -> Dictionary: # 功法境界倍率表
	return {}
func status(id: String) -> Dictionary:       # 状态定义
	return {}
func formation(id: String) -> Dictionary:    # 阵法定义
	return {}
func enemy(id: String) -> Dictionary:        # 敌方模板
	return {}
func constants() -> Dictionary:              # 战斗常量（上限/常数）
	return {}
```

另外提供两个实现：

| 实现 | 位置 | 用途 |
|------|------|------|
| `TableCombatDataSource` | `src/core/data/table_combat_data_source.gd` | 从**已加载的字典**构造（**不依赖 autoload**，测试用） |
| `RegistryCombatDataSource` | `src/data/registry/registry_combat_data_source.gd` | 从 `DataRegistry` 取（**装配层**，运行时用） |

**约束**：`src/core/**` 只允许依赖 `CombatDataSource` 抽象类；`RegistryCombatDataSource` 属于 data 层，**core 不得引用它**。

### 2.3 随机：必须可播种、可复现

```gdscript
# src/core/battle/battle_rng.gd
class_name BattleRng
extends RefCounted

func _init(seed_value: int) -> void: ...
func next_float() -> float          # [0,1)
func chance(p: float) -> bool       # p<=0 false, p>=1 true
func range_int(from: int, to: int) -> int
func pick(arr: Array) -> Variant
func state() -> int                 # 便于存档
```

**禁止**在 core 中使用全局 `randf()` / `randi()`。`BattleSetup` 必须携带 `seed`，**同 seed + 同输入 = 逐事件完全一致**（这是硬性验收项）。

### 2.4 预结算 + 表现分离（GDD 5.4 硬要求）

```
BattleSetup ──→ BattleSimulator.simulate() ──→ BattleResult
                     （纯逻辑，无渲染）           ├─ events: Array[Dictionary]   ← 表现层唯一输入
                                                  ├─ winner / rounds
                                                  └─ stats（伤害/治疗/连招次数…）
```

表现层**只读** `BattleResult.events` 做回放，**不得参与任何数值计算**；
"跳过战斗"= 直接把状态设到结果（不播事件）。

---

## 3. 数据契约（新增 4 张表）

> 全部放在 `src/data/tables/`，纯 JSON，**主键字段必须是 `id`**（`DataRegistry` 强制校验，缺失会报错）。
> 表中**不得出现**只有代码才懂的字段；所有数值必须可被策划直接修改。

### 3.1 `gongfa.json` —— 功法战斗数据（87 行）

**来源**：由现有 `gongfa_visual.json` 派生（该表已含 `id/name/group/quality/targets`）。

| 字段 | 类型 | 取值 | 说明 |
|------|------|------|------|
| `id` | string | `GF_*` | 主键，与 `gongfa_visual.json` 一致 |
| `name` | string | 中文名 | |
| `group` | string | `dao`/`jian`/`quan`/`anqi`/`qimen`/`qiang`/`neigong`/`shenfa` | 决定动作组（见 §6） |
| `type` | string | `external` / `neigong` / `shenfa` | 前 6 组为 `external`（外功） |
| `quality` | string | `fan`/`liang`/`shang`/`ji`/`jue` | 品质 |
| `power` | int | 10/20/35/55/80 | 品质基础威力（GDD 3.1.4） |
| `inner_cost` | int | 10/20/35/55/80 | 释放消耗内力（GDD 2.1-4） |
| `start_mark` | int | 0/1/2/3 | **起势**（外功必填；内功/身法为 0） |
| `end_mark` | int | 0/1/2/3 | **收势**（外功必填；内功/身法为 0） |
| `targets` | string | `single`/`column`/`row`/`all` | 打击范围 |
| `passive` | object\|null | `{name, realm, kind, value}` | 达到 `realm`（1~10）解锁的被动 |

**起势/收势生成规则**（保证连招链路存在，直接照此生成）：
> 按 `gongfa_visual.json` 中**同 group 内的出现顺序** `i`（从 0 起）：
> `start_mark = (i % 3) + 1`，`end_mark = ((i + 1) % 3) + 1`。
> 这样同组第 i 门功法的收势恰为第 i+1 门的起势 → 连招链路成立。

**被动**：GDD 已具名的 8 条照抄（下表），其余功法按 group 生成通用被动（解锁境界取 3/6/10）。

| 功法 id | 被动名 | 解锁境界 | 效果 |
|---------|--------|:--------:|------|
| `GF_kuangfeng_dao` | 狂风不息 | 3 | 攻击有 20% 概率追加一次 |
| `GF_duanyue_dao` | 断岳之势 | 6 | 对气血高于 50% 的敌人伤害 +30% |
| `GF_liuyun_jian` | 流云无迹 | 6 | 闪避 +20%，连击 +1 |
| `GF_luohan_quan` | 金刚怒目 | 3 | 眩晕概率 +15% |
| `GF_liuye_dao` | 柳叶纷飞 | 10 | 必中，无视防御概率 +15% |
| `GF_badao` | 霸者横栏 | 10 | 全体伤害 +25%，吸血 +15% |
| `GF_dugu_jiujian` | 无剑胜有剑 | 10 | 无视防御 +30%，先手 +25% |
| `GF_neigong_jichu` | 返璞归真 | 10 | 内力上限 +30%，全属性 +10% |

### 3.2 `gongfa_realm.json` —— 功法境界倍率（10 行）

| `index` | `name` | `multiplier` | `exp_required` | `cultivation_gain` |
|:-------:|--------|:------------:|:--------------:|:------------------:|
| 1 | 初窥门径 | 1.0 | 1000 | 0 |
| 2 | 略有小成 | 1.2 | 3000 | 1 |
| 3 | 登堂入室 | 1.5 | 6000 | 1 |
| 4 | 融会贯通 | 1.9 | 10000 | 1 |
| 5 | 炉火纯青 | 2.6 | 15000 | 1 |
| 6 | 登峰造极 | 3.3 | 21000 | 1 |
| 7 | 出神入化 | 4.3 | 28000 | 2 |
| 8 | 大巧若拙 | 5.4 | 36000 | 3 |
| 9 | 超凡入圣 | 6.6 | 45000 | 4 |
| 10 | 天人合一 | 8.0 | — | 5 |

> ⚠️ 倍率为 **×8.0 版本**（v0.13 上调后），不要用旧的 ×5.5。

### 3.3 `enemy_template.json` —— 敌方模板（≥ 24 行）

每个等级段 3 个 tier（`normal` / `elite` / `boss`），字段：`id, name, tier, level_min, level_max, hp, atk, def, spd, inner, skill_ids[], ai_preference`

**基础数值（GDD 3.2.3，直接照抄；气血/攻击/防御）**：

| 等级段 | 普通怪 | 精英 | BOSS |
|--------|:------:|:----:|:----:|
| Lv1~10 | 200/25/10 | 700/40/15 | 2200/55/20 |
| Lv11~25 | 800/75/35 | 2800/120/55 | 8800/160/70 |
| Lv26~45 | 1600/165/75 | 5600/260/110 | 17600/340/140 |
| Lv46~70 | 2700/330/155 | 9500/520/220 | 29700/700/270 |
| Lv71~100 | 6800/700/340 | 24000/1100/480 | 74800/1450/590 |
| 后天段 | 12000/1300/620 | 42000/2000/880 | 132000/2700/1080 |
| 先天段 | 18000/2000/900 | 63000/3100/1280 | 198000/4200/1560 |
| 宗师段 | 25000/2900/1250 | 87000/4500/1800 | 275000/6000/2200 |

- `spd` = 按 `level_min` 对应的玩家身法参考值 ×0.9（或直接给 60/120/200/320/480/700/950/1200）
- `inner` = 按同段玩家内力 ×0.8
- `skill_ids`：普通怪 1 个、精英 2 个、BOSS 3 个，从 `gongfa.json` 中选取（**必须保证每个 tier 至少有一个 `single` 目标技能**）
- **`hp` 在使用时乘以编队系数**：`编队系数 = 我方人数 ÷ 4`（3人=0.75 / 4人=1.0 / 5人=1.25 / 6人=1.5）

### 3.4 `hint_text.json` —— 提示语表（见 §7，**照表落库**）

字段：`id, key, tier(float|toast|log|tooltip), text, vars[]`

---

## 4. 核心模块规格（`src/core/battle/`）

> 全部 `extends RefCounted`，**不得 extends Node**。类型标注完整。文件顶部写模块职责注释。

### 4.1 `battle_types.gd` — 常量与枚举

```gdscript
class_name BattleTypes
extends RefCounted

enum Side { ALLY, ENEMY }
enum Outcome { ALLY_WIN, ENEMY_WIN, DRAW }

# 战斗常量（应与 src/data/tables/battle_constants.json 保持一致；该表为唯一真相）
const MAX_ROUNDS := 30
const CRIT_RATE_CAP := 0.75
const CRIT_DAMAGE_CAP := 3.0
const DODGE_CAP := 0.6
const HIT_MIN := 0.05
const HIT_MAX := 0.95
const DEFENSE_CONSTANT := 150.0
const DAMAGE_BONUS_CAP := 0.6      # 增伤总上限
const DAMAGE_REDUCTION_CAP := 0.9  # 减伤总上限
const CULTIVATION_DIFF_CAP_SINGLE := 120
const CULTIVATION_DIFF_CAP_TOTAL := 180
```

### 4.2 `battle_stats.gd` — L1 → L2 派生（GDD 3.1.1）

```gdscript
class_name BattleStats
extends RefCounted

## L1: {arm, agility, bone, inner}（臂力/身法/根骨/内息）
## 装备注入: {atk, def, hp, inner, crit, crit_dmg, hit, dodge, lifesteal, dmg_bonus}
static func derive(l1: Dictionary, equip: Dictionary, mods: Dictionary) -> Dictionary
# 返回 L2：{atk, def, hp_max, inner_max, inner_regen, crit_rate, crit_damage,
#          hit_rate, dodge_rate, speed, lifesteal, damage_bonus, damage_taken}
```

**公式（逐条照抄 GDD 3.1.1，不得改动）**：

| L2 | 公式 | 上限 |
|----|------|------|
| `atk` | `臂力 × 3 + 装备攻击` | — |
| `def` | `根骨 × 1.5 + 装备防御` | 减伤边际递减（常数 150） |
| `hp_max` | `根骨 × 20 + 装备气血 + 内功气血` | — |
| `inner_max` | `内息 × 10 + 内功内力` | — |
| `inner_regen` | `内息 / 10 + 内功加成`（每回合） | — |
| `crit_rate` | `0.05 + 臂力/1000 + 装备` | **0.75** |
| `crit_damage` | `1.5 + 装备` | **3.0** |
| `hit_rate` | `0.90 + 命中加成` | 结算时钳制 **0.05~0.95** |
| `dodge_rate` | `身法/1000 + 装备` | **0.60** |
| `speed` | `身法 + 轻功加成` | — |

> 注意：GDD 写「每 10 点身法 = +1%」，即 `身法/10%` = `身法/1000`（小数）。

### 4.3 `battle_actor.gd` — 战斗单位

```gdscript
class_name BattleActor
extends RefCounted

var id: String
var display_name: String
var side: int                 # BattleTypes.Side
var slot: int                 # 0~8 九宫格索引
var l2: Dictionary            # 派生属性
var hp: float
var inner: float
var skills: Array[String]     # 装备的功法 id（外功一/二/三 + 内功）
var realm_levels: Dictionary  # gongfa_id -> 境界 index(1~10)
var statuses: Array          # [{id, stacks, remaining, source}]
var alive: bool

func is_alive() -> bool
func hp_ratio() -> float
func take_damage(amount: float) -> float    # 返回实际扣血（不溢出）
func heal(amount: float) -> float
func spend_inner(cost: float) -> bool
func regen_inner() -> void
func has_status(id: String) -> bool
func status_stacks(id: String) -> int
```

### 4.4 `battle_formula.gd` — 伤害管线（**GDD 3.1.2，顺序不可调整**）

```gdscript
class_name BattleFormula
extends RefCounted

## 单次攻击结算：命中 → 暴击 → 伤害 → 防御减免 → 增伤/减伤 → 吸血 → 状态
static func resolve_attack(
    attacker: BattleActor,
    defender: BattleActor,
    skill: Dictionary,          # gongfa.json 的一行
    realm: Dictionary,          # gongfa_realm.json 对应行
    context: Dictionary,        # {combo_level, tag_bonus, talent_bonus, realm_bonus,
                                #  formation_bonus, cultivation_self, cultivation_target}
    rng: BattleRng
) -> Dictionary
# 返回 {hit: bool, crit: bool, damage: float, lifesteal: float,
#       events: Array[Dictionary], debug: Dictionary}
```

**核心公式**：

```
① 命中判定：命中率 = 0.90 + 命中加成 − 目标闪避，钳制 5%~95%
② 暴击判定：暴击率（上限 75%）；触发时伤害 ×暴击倍率（上限 300%）
③ 攻击力   = 臂力 × 3 + 装备攻击
   功法威力 = 品质基础威力 × 境界倍率 × 3
   修为差距 = 内力修为差距 + 功法类型修为差距（合计为负 → ÷2；单项封顶 ±120，合计 ±180）
   基础伤害 = 攻击力 + 修为差距 + 功法威力
④ 减伤修正 = 1 − 防御力 / (防御力 + 150)     结果不为负
⑤ 增伤修正 = 1 + 连招加成 + 词条加成 + 天赋加成 + 境界加成 + 阵法加成
             （总增伤 ≤ +60%；总减伤 ≤ 90%）
⑥ 吸血     = 最终伤害 × 吸血率（不超过气血上限，不溢出）
⑦ 施加状态：按概率施加（眩晕/击退/封穴/中毒/流血/灼烧/破防…）
```

**暴击与增伤的结算顺序**：`实际伤害 = 基础伤害 × 减伤修正 × 暴击修正 × 增伤修正`

**连招加成**（GDD 3.4.5）：二连 **+30%**；三连 **+60% 并触发吸血（+10%）**；连招失败无惩罚。

### 4.5 `status_runtime.gd` — 状态系统（22 种）

```gdscript
class_name StatusRuntime
extends RefCounted

static func apply(actor: BattleActor, status_id: String, duration: int,
                  stacks: int, data: CombatDataSource,
                  formation: Dictionary) -> Array   # 返回事件数组
static func tick(actor: BattleActor, data: CombatDataSource) -> Array
static func aggregate_mods(actor: BattleActor, data: CombatDataSource) -> Dictionary
static func can_act(actor: BattleActor, data: CombatDataSource) -> bool
static func can_cast(actor: BattleActor, data: CombatDataSource) -> bool
static func cleanse(actor: BattleActor, data: CombatDataSource) -> Array
```

**规则（照抄 GDD 2.1-9）**：

- 同状态**不叠加**，取最高值；**中毒（≤3 层）/ 流血（≤5 层）例外**，按层数叠加
- 每回合结束统一结算持续伤害与状态时长
- 中毒/灼烧按**最大气血**、流血按**当前气血**
- 属性类状态计入 L2 派生，**不得突破**既有上限（暴击 75% / 闪避 60% / 命中 5~95% / 暴伤 300%）
- 免疫标记：`ironWall` 免疫击退与破防；`immuneFirstControl`（守境阵 5 级）免疫首次控制
- `stun` → 无法行动；`seal` → 只能普攻；`root` → 闪避归零；`knockback` → 出手顺位后移 3 位

### 4.6 `combo_resolver.gd` — 连招

```gdscript
class_name ComboResolver
extends RefCounted

## 检查「上一式的收势」是否等于「本式的起势」
static func chains(prev: Dictionary, next: Dictionary) -> bool
## 返回 {level: 0|1|2|3, damage_bonus: float, lifesteal_bonus: float, label: String}
static func resolve_chain(skills: Array[Dictionary], cast_index: int, chain_len: int) -> Dictionary
```

- `chains(prev, next)` ⇔ `prev.end_mark == next.start_mark != 0`
- 链路长度 2 → `damage_bonus = 0.30`
- 链路长度 3 → `damage_bonus = 0.60`，`lifesteal_bonus = 0.10`
- 同列跨位也可连击（`BattleGrid.same_column`）

### 4.7 `battle_ai.gd` — 出战决策

```gdscript
class_name BattleAi
extends RefCounted

## preference: "combo"（优先连招，默认）| "damage"（优先输出）
static func choose_skill(actor: BattleActor, enemies: Array[BattleActor],
                         preference: String, data: CombatDataSource,
                         last_end_mark: int, rng: BattleRng) -> Dictionary
# 返回 {skill_id, reason: String, combo_preview: int}
static func choose_target(actor: BattleActor, enemies: Array[BattleActor],
                          targets: String, rng: BattleRng) -> Array[BattleActor]
```

**决策规则（按优先级）**：

1. 内力不足的技能**不可选**
2. `preference == "combo"`：优先选 `start_mark == last_end_mark` 且内力足够的技能
3. 否则退化为选**期望伤害最高**的技能
4. 全部不可用（含内力不足）→ **普攻**（`攻击力 × 0.5`，无消耗）
5. 目标选择：`single` → 同列优先（敌方 AI 亦如此）；`column` → 该列全体；`row` → 该行全体；`all` → 全体

### 4.8 `battle_setup.gd` / `battle_result.gd` / `battle_simulator.gd`

```gdscript
class_name BattleSetup
extends RefCounted
var seed: int
var allies: Array[Dictionary]     # 见下
var enemies: Array[Dictionary]
var ally_placement: Array         # 长度 9，元素为成员 id 或 null
var enemy_placement: Array
var formation_id: String
var formation_level: int
var ai_preference: String         # "combo" | "damage"
var party_scale: float            # 编队系数（默认由 allies.size()/4 推导）

# allies[i] = {id, name, l1:{arm,agility,bone,inner}, equip:{}, skills:[...],
#              realm_levels:{}, cultivation:{dao:..., neigong:...}, hp_max_override}
```

```gdscript
class_name BattleResult
extends RefCounted
var outcome: int                  # BattleTypes.Outcome
var rounds: int
var events: Array[Dictionary]     # 表现层唯一输入
var stats: Dictionary             # {total_damage, total_heal, combos, crits, misses,
                                  #  turns, ally_survivors, enemy_survivors, ttk_rounds}
var final_state: Dictionary       # 供"跳过战斗"直接落状态
```

**`BattleSimulator.simulate(setup, data) -> BattleResult`** 主循环：

```
1. 构建双方 BattleActor（L2 派生 + 装备 + 内功加成）
2. 施加阵法加成（我方）：FormationResolver.resolve(阵法, 站位, 等级)
   - 结果 partial → 加成 ×0.5；fail → 不加成，并产出提示事件
3. 先手判定：比较双方「最高身法 + 先手加成」，高者先手
4. 回合循环（最多 MAX_ROUNDS 轮）：
   a. 按身法从高到低排出行动顺序（同身法：先手方优先 → 站位 1→9）
   b. 每个存活单位行动一次：
      - 若眩晕 → 跳过（产出事件）
      - 若封穴 → 强制普攻
      - AI 选技能与目标 → 逐目标结算 BattleFormula.resolve_attack
      - 结算连招（上一动的收势 vs 本式起势）
      - 消耗内力；回复内力在回合末统一结算
   c. 回合末：状态 tick（持续伤害/治疗/时长递减/到期移除）→ 行动顺序重排
   d. 判定胜负：任一方全灭 → 结束
5. 达到 MAX_ROUNDS 仍未分出 → outcome = ENEMY_WIN（久战判负），产出提示事件
```

### 4.9 事件流规范（表现层唯一接口）

每个事件是 Dictionary，**必须含 `t`（自战斗开始的毫秒数，用于回放）与 `type`**：

| `type` | 关键字段 | 表现层行为（见 §6） |
|--------|----------|---------------------|
| `battle_start` | `allies`, `enemies`, `formation_result` | 布阵展示、阵法提示 |
| `round_start` | `round` | 回合数更新 |
| `turn_start` | `actor_id`, `slot` | 高亮当前行动者 |
| `skill_cast` | `actor_id`, `skill_id`, `group`, `motion`, `vfx`, `quality`, `targets` | **播放动作 + 特效**（字段直接来自 `gongfa_visual`） |
| `combo` | `actor_id`, `level`(2/3), `damage_bonus` | 连招飘字 + 特效叠加 |
| `attack_hit` | `actor_id`, `target_id`, `damage`, `crit`, `lifesteal` | 伤害飘字、受击、HitStop |
| `attack_miss` | `actor_id`, `target_id` | 落空飘字 |
| `inner_low` | `actor_id`, `skill_id`, `need`, `have` | 内力不足提示，改普攻 |
| `status_applied` | `target_id`, `status_id`, `stacks`, `duration` | 状态图标 + 提示 |
| `status_tick` | `target_id`, `status_id`, `damage`/`heal` | 持续伤害/治疗飘字 |
| `status_expired` | `target_id`, `status_id` | 图标移除 |
| `skill_passive` | `actor_id`, `passive_name` | 被动触发提示（如「狂风不息」） |
| `unit_down` | `actor_id` | 倒地 |
| `round_end` | `round` | |
| `hint` | `hint_key`, `vars` | **提示语**（key 查 §7 的表） |
| `battle_end` | `outcome`, `rounds`, `stats` | 结算界面 |

**约束**：每个事件都必须能被表现层**独立处理**（不依赖前序事件的状态），保证可跳过、可快进、可从任意点回放。

---

## 5. 战斗机制规格（逐条对齐 GDD，**数值不得自行发明**）

### 5.1 上阵与站位

- 上阵人数随进度成长 **3 → 4 → 5**（门派战 **6**）：用 `GameState.max_party_size()`
- 九宫格 3×3：前排 `0,1,2` / 中排 `3,4,5` / 后排 `6,7,8`（用 `BattleGrid`）
- 敌方 AI 优先攻击**同列**；范围功法（枪法横扫）连带密集站位
- **列连击**：同一列前中后三人若起势/收势匹配，可跨位触发连击

### 5.2 内力（**无冷却**）

- 消耗按品质：凡 10 / 良 20 / 上 35 / 极 55 / 绝 80
- 每回合回复：`内息 / 10 + 内功加成`
- 不足 → **自动普攻**（`攻击力 × 0.5`，无消耗），并产出 `inner_low` 事件
- **不引入通用招式冷却**（已决策，见 `烟雨江湖战斗对齐.md` §3.4）

### 5.3 阵法（12 个，已实现解析器）

- 战前装备 1 个；站位不符 → partial 生效 50% / fail 生效 0%
- 加成计入增伤/减伤修正，**总上限不变**（增伤 ≤ +60%，减伤 ≤ 90%）
- 特殊效果（`comboPower` / `columnDamage` / `backRowDamage` / `frontRowTaken` / `reflect` / `immuneFirstControl`）由战斗逻辑特判

### 5.4 三层词条（GDD 3.4.5）

| 层 | 组合 | 示例 |
|----|------|------|
| 一 | 外功 × 外功 | 狂风+断岳 → 断岳威力 +20%；刀法+拳掌「刚柔并济」攻击 +10% 防御 +10% |
| 二 | 内功 × 外功（词条类型 刚猛/灵动/诡变/深厚 匹配） | 金刚不坏体+断岳 → 刀法威力 +20% 防御 +10% |
| 三 | 内功 × 身法 | 吸星大法+凌波微步 → 吸血 +15% 闪避 +15% |

**总增伤上限 +60%**（与阵法叠加后仍不超过）。

> 词条数据可先内联为 `src/data/tables/tag_combo.json`，也可由 group/品质推导；**必须由数据驱动，不得硬编码在逻辑里**。

### 5.5 修为差距入伤害

```
内力修为差距     = 我方内功修为 − 敌方内功修为
功法类型修为差距 = 我方所用功法类型修为 − 敌方同类型修为
修为差距 = 两者相加；合计为负 → ÷ 2
封顶：单项 ±120，合计 ±180
跨类型不结算
```

---

## 6. 战斗表现与动画（对齐"依赖分析报告"）

> **依赖分析报告的结论**（`jianghu-design/12_tech/动画复用方案_v1.0.md`）：
> **不要做「每功法 × 每角色」的动画**（87 × 12 = 1,044 套），而是三层相加：
>
> ```
> 最终表现 = 角色皮肤层（每角色 1 套）
>          + 动作层（每【武器类型】1 组，56 个 clip 全角色共用）
>          + 功法特效层（16 个模板 + 参数化差异）
> ```

### 6.1 本任务在动画上的职责边界

**本任务只负责"发出正确的表现指令"，不负责绘制动画。**

- ✅ 必须做：在 `skill_cast` 事件中**原样透传** `gongfa_visual.json` 的表现字段
- ✅ 必须做：连招成功时在事件中带上 `combo.level`，供表现层**叠加特效**
- ✅ 必须做：品质 → 特效配色（表现层查表即可，逻辑层只传 `quality`）
- ❌ 不要做：精灵图、骨骼、粒子、着色器

### 6.2 逻辑层 → 表现层的字段契约（**原样透传，不得改名**）

`skill_cast` 事件必须包含（值直接取自 `gongfa_visual.json` 同一 `id` 的行）：

| 字段 | 来源 | 表现层用途 |
|------|------|-----------|
| `group` | `gongfa_visual.group` | 选**哪一组动作**（`dao`/`jian`/`quan`/`anqi`/`qimen`/`qiang`/`neigong`/`shenfa`） |
| `motion` | `gongfa_visual.motion` | 选**动作原型**（`idle`/`ready`/`atk_a`/`atk_b`/`sweep`/`cast`/`hit`/`dodge`/`down`/`meditate`/`aura`/`dash`/`leap`/`vanish`/`land`） |
| `vfx` | `gongfa_visual.vfx` | 选**特效模板**（16 选 1） |
| `timingScale` | `gongfa_visual.timingScale` | 动作播放倍速（`<1` 更慢更重，`>1` 更快更轻） |
| `hitStopMs` | `gongfa_visual.hitStopMs` | 命中停顿（0~120ms） |
| `shake` | `gongfa_visual.shake` | 屏幕震动（0/1/2） |
| `sfx` | `gongfa_visual.sfx` | 音效模板 |
| `quality` | `gongfa_visual.quality` | **特效配色**（见下） |

**品质配色表（表现层用，逻辑层不参与）**：

| quality | 主色 | 表现叠加 |
|---------|------|----------|
| `fan` 凡品 | 灰白 `#d8d8d8` | 基础粒子 |
| `liang` 良品 | 青碧 `#4fb3a5` | + 轻拖尾 |
| `shang` 上品 | 靛蓝 `#4a6fd4` | + 拖尾 + 光晕 |
| `ji` 极品 | 暗金 `#c79a3a` | + 拖尾 + 光晕 + 残影 |
| `jue` 绝世 | 赤金 `#e8b23c` | + 全屏闪 + 墨迹扩散 + 镜头轻推 |

### 6.3 连招叠加（"看得见的爽点"）

| 连招层级 | 数值效果 | **表现叠加** |
|:--------:|----------|--------------|
| 二连 | 威力 **+30%** | 拖尾增强 + 连招飘字 |
| 三连 | 威力 **+60%** + 吸血 **+10%** | 追加墨迹爆点 + 震屏加强 + 镜头轻推 |

### 6.4 挂点（anchor）约定（供后续动画接入，本任务不实现）

`weaponTip` / `palm` / `throwPoint` / `bodyCenter` / `footPoint` / `hitPoint`。
逻辑层只需在 `attack_hit` 事件里给出**目标 id 与槽位**，具体世界坐标由表现层算。

---

## 7. 提示语规范与优化后的完整表

### 7.1 三层提示语体系（**这是"优化提示语"的核心设计**）

| 层级 | 位置 | 长度上限 | 风格 | 目的 |
|------|------|:--------:|------|------|
| **float** 飘字 | 战斗中角色头顶 | **≤ 6 字** | 凝练、有江湖气 | 0.2 秒内被读懂 |
| **toast** 提示条 | 屏幕上/下方，短暂 | ≤ 20 字 | 说明发生了什么 | 让玩家理解机制 |
| **log** 战斗日志 | 侧栏可滚动 | ≤ 40 字 | 完整陈述 | 战后复盘 |
| **tooltip** 说明 | 悬浮/长按 | 不限 | 教机制 | 降低学习成本 |

**优化要点（相对直白表述）**：

1. 飘字**只保留结果**，不写数值（数值放 toast/log）——避免战斗中信息过载
2. 用**武侠语汇**替代系统词：`连招` 保留（已建立认知）、`内力不济` 替代「MP 不足」、`阵势未成` 替代「阵法失效」
3. **数值一律用中文数字+成**：`+30%` → 「增三成」；`+60%` → 「增六成」
4. toast **必须可行动化**：不只说"错了"，要说"怎么办"（如"站位不符 → 按阵法提示调整九宫格"）
5. **绝不出现**：英文、缩写、未定义术语（如 "buff"、"debuff"、"CD"）
6. 所有含变量的文案用 `{var}` 占位，**禁止字符串拼接**

### 7.2 提示语表（**照此落 `hint_text.json`**）

| key | 触发 | tier | 文案（含变量） |
|-----|------|:----:|----------------|
| `battle_start` | 战斗开始 | toast | 交手！{ally_count} 对 {enemy_count} |
| `formation_ok` | 阵法全额生效 | toast | 阵势已成 · {formation_name}（{bonus_text}） |
| `formation_partial` | 阵法部分符合 | toast | 阵势不稳 · 站位仅部分契合，加成减半 |
| `formation_partial_log` | 同上 | log | {formation_name} 要求「{requirement}」，当前站位仅部分契合，加成按五成计 |
| `formation_fail` | 阵法失效 | toast | 阵势未成 · 加成失效，请调整九宫格站位 |
| `formation_fail_log` | 同上 | log | {formation_name} 要求「{requirement}」，当前站位不符，本战无阵法加成 |
| `formation_hint` | 布阵界面悬浮 | tooltip | 阵法要求特定站位方能生效：完全契合给全额，部分契合给五成，不符则失效。点击阵法可查看要求。 |
| `round_start` | 回合开始 | float | 第 {round} 合 |
| `combo_2` | 二连成功 | float | 连招 · 成 |
| `combo_2_toast` | 同上 | toast | 顺势而为 · 第二式威力增三成 |
| `combo_3` | 三连成功 | float | 三连 · 破 |
| `combo_3_toast` | 同上 | toast | 三式贯通 · 威力增六成，兼有吸血 |
| `combo_fail` | 连招未接上 | log | {skill_name} 起势为 {start_mark}，与上一式收势不合，连招未成 |
| `combo_hint` | 功法面板 | tooltip | 每门外功皆有起势与收势。当上一式的收势与本式的起势相合，即为连招，威力大増。装备功法时留意起收之势的衔接。 |
| `hit_normal` | 命中 | float | {damage} |
| `hit_crit` | 暴击 | float | 破绽 {damage} |
| `hit_crit_log` | 同上 | log | {actor_name} 击中破绽，{skill_name} 造成 {damage} 伤害 |
| `attack_miss` | 落空 | float | 落空 |
| `attack_miss_log` | 同上 | log | {actor_name} 的 {skill_name} 被 {target_name} 避开 |
| `lifesteal` | 吸血 | float | 回气 {heal} |
| `inner_low` | 内力不足改用普攻 | float | 内力不济 |
| `inner_low_toast` | 同上 | toast | 内力不足（需 {need}，余 {have}），改以普攻应对 |
| `inner_hint` | 功法面板 | tooltip | 外功释放消耗内力，无冷却；内力足够即可连续施展。内力耗尽时自动改用普攻。内功决定内力上限与每回合回复。 |
| `status_stun` | 眩晕 | float | 目眩 |
| `status_stun_toast` | 同上 | toast | {target_name} 目眩神迷，一合之内无法行动 |
| `status_seal` | 封穴 | float | 封穴 |
| `status_seal_toast` | 同上 | toast | {target_name} 穴道受制，{duration} 合之内无法运使功法 |
| `status_root` | 定身 | float | 定身 |
| `status_root_toast` | 同上 | toast | {target_name} 身形受滞，闪避全失 |
| `status_knockback` | 击退 | float | 退！ |
| `status_knockback_toast` | 同上 | toast | {target_name} 被震退，出手顺位后移三格 |
| `status_poison` | 中毒 | float | 中毒 |
| `status_bleed` | 流血 | float | 流血 |
| `status_burn` | 灼烧 | float | 灼烧 |
| `status_dot_log` | 持续伤害结算 | log | {target_name} 受 {status_name} 所苦，损血 {damage}（剩 {remaining} 合） |
| `status_regen` | 回春 | float | 回春 {heal} |
| `status_shield` | 护体 | float | 护体 |
| `status_ironwall` | 铁壁免疫 | log | {target_name} 运起铁壁，{status_name} 未能奏效 |
| `status_immune_control` | 守境阵免疫首次控制 | toast | 守境之气护体，首次受制已免 |
| `status_stack_cap` | 层数已达上限 | log | {status_name} 已至 {max_stacks} 层，不再叠加 |
| `status_expired` | 状态到期 | log | {target_name} 的 {status_name} 已解 |
| `passive_trigger` | 功法被动触发 | float | {passive_name} |
| `passive_trigger_log` | 同上 | log | {actor_name} 触发「{passive_name}」 |
| `talent_trigger` | 天赋加成生效 | log | 天赋「{talent_name}」生效：{effect_text} |
| `unit_down` | 单位阵亡 | toast | {actor_name} 力竭倒地 |
| `ally_down_warn` | 我方阵亡（有存档提示） | toast | {actor_name} 已倒 · 全队覆灭即战败 |
| `round_limit_warn` | 接近回合上限（第 25 合） | toast | 已过二十五合，再过五合未分胜负即判负 |
| `round_limit_end` | 达回合上限判负 | toast | 久战不下，此战判负 |
| `victory` | 胜利 | toast | 此战告捷 |
| `victory_log` | 同上 | log | 历 {rounds} 合，我方 {survivors} 人尚存，共造成 {damage} 伤害 |
| `defeat` | 失败 | toast | 力有未逮，此战失利 |
| `defeat_log` | 同上 | log | 历 {rounds} 合，敌方 {survivors} 人尚存。可读档再战，或调整功法与站位。 |
| `battle_hint_first` | 首战引导 | tooltip | 战后胜负多在战前已定：布阵看站位，出战看功法起收之势，内力决定能连多久。 |
| `enemy_weakness` | 穿越者系统揭示弱点（Lv4） | toast | 系统提示：此敌「{weakness}」较弱，宜以 {counter_skill} 应对 |
| `enemy_scan_locked` | 系统等级不足 | toast | 系统等级不足，无法解析此敌 |

**落库格式示例**：

```json
[
  { "id": "HINT_combo_2", "key": "combo_2", "tier": "float",
    "text": "连招 · 成", "vars": [] },
  { "id": "HINT_formation_fail_log", "key": "formation_fail_log", "tier": "log",
    "text": "{formation_name} 要求「{requirement}」，当前站位不符，本战无阵法加成",
    "vars": ["formation_name", "requirement"] }
]
```

**校验要求**（写进测试）：

- 所有 `tier == "float"` 的静态文案（不含变量时）长度 ≤ 6 个汉字
- 文案中**不得出现** `%s` / `%d` / `{}` 之外的自定义占位（统一 `{var}`）
- `vars` 数组必须与实际占位符**完全一致**（多一个少一个都算失败）
- 不得出现英文单词（白名单：`HP` 不使用，改用"气血"）

---

## 8. 测试与验收

### 8.1 必须新增的测试

**单元测试**（追加到 `tests/run_tests.gd`，或新建 `tests/unit/battle_*.gd` 并在主运行器里聚合）：

| 分类 | 用例（至少） |
|------|--------------|
| L1→L2 派生 | 攻击力=臂力×3+装备；气血=根骨×20+…；暴击率钳制 0.75；闪避钳制 0.60；命中钳制 0.05~0.95 |
| 伤害管线 | 顺序不可变（命中→暴击→伤害→减伤→增伤→吸血）；减伤常数 150（防御 150 → 50% 减伤）；增伤上限 60%；减伤上限 90% |
| 修为差距 | 双差值相加；负值 ÷2；单项封顶 ±120；合计封顶 ±180；跨类型不结算 |
| 连招 | `end_mark == start_mark` 判为连招；二连 +30%；三连 +60% + 吸血 10%；同组链路存在（对 87 门功法断言每个 group 内至少存在 1 条 3 连链路） |
| 状态 | 同状态不叠加取最高；中毒 ≤3 层、流血 ≤5 层；持续伤害按 maxHp/currentHp 分别计算；`stun` 不可行动；`seal` 只能普攻；`root` 闪避归零；`ironWall` 免疫击退与破防；`immuneFirstControl` 只免一次 |
| 内力 | 消耗按品质；回复 = 内息/10；不足时改用普攻且产出 `inner_low` |
| 随机 | 同 seed 两次 simulate 的 **events 逐条完全一致**；不同 seed 结果不同 |
| 回合上限 | 30 回合未分胜负 → `ENEMY_WIN` 且产出 `round_limit_end` |
| 编队系数 | 3/4/5/6 人 → 0.75/1.0/1.25/1.5；敌方气血按系数缩放 |
| 阵法接入 | partial → 加成 ×0.5；fail → 无加成且产出 `formation_fail` 事件 |
| 事件契约 | 每个事件都有 `t` 与 `type`；`skill_cast` 必含 §6.2 的 8 个字段；所有字段名与 `gongfa_visual.json` 一致 |
| 提示语 | §7.2 的五条校验全部通过 |

**数值验证报告**（`tools/ci/sim_battle.gd` 或测试内）：跑 **100 场**同构战斗并输出：

| 指标 | 目标（GDD 3.1.5） |
|------|-------------------|
| 普通怪 TTK | **2~4 回合** |
| 精英 TTK | **5~8 回合** |
| BOSS TTK | **10~15 回合** |
| 任意场次回合数 | 不得 < 1 或 > 30 |
| TTK 与目标偏差 | **≤ 30%** |
| 4 种 AI 偏好/流派胜率差 | ≤ 15 个百分点 |

### 8.2 视觉验收

`scenes/battle/battle.tscn` 必须做到：

1. 九宫格布阵界面（可点选/拖拽换位），显示阵法要求与当前契合度（✅/🟡/❌）
2. 点击"开战" → 播放事件流：行动者高亮、技能名与飘字、伤害数字、状态图标、HitStop 与震屏
3. 支持 **1× / 2× / 4× / 跳过**（跳过 = 直接落到结果）
4. 战斗日志侧栏（用 `log` 层提示语）
5. 结算界面（胜负、回合数、伤害统计、掉落占位）

**渲染验证命令**：

```bash
GODOT_BIN=/Users/zq/Downloads/Godot.app/Contents/MacOS/Godot \
  ./tools/ci/render_frames.sh "res://scenes/battle/battle.tscn" 40 build/battle_frames 1280x720
```
→ 检查产出的 PNG 确认界面正确（**这是本工程唯一的画面验收手段**）。

### 8.3 通过标准（DoD）

```
□ 单元测试 ≥ 57 + 新增 ≥ 45 项，全绿（退出码 0）
□ 集成测试 33 项仍全绿（不得回归）
□ 100 场模拟报告产出，TTK 全部落在目标区间且偏差 ≤ 30%
□ 同 seed 逐事件一致（有测试断言）
□ battle 场景可渲染，截图确认界面与飘字正确
□ src/core/** 无任何场景树/autoload/Input 依赖（人工 review + 可选 lint 脚本）
□ 新增代码全部有类型标注；文件顶部有职责注释
□ 数据全部来自 JSON 表，逻辑层无硬编码数值/名称
□ docs/PROJECT_STRUCTURE.md 中的目录规范未被破坏
```

---

## 9. 已知坑（**必看，能省数小时**）

| # | 坑 | 现象 | 规避 |
|:-:|----|------|------|
| 1 | **`--script` 模式读不到 autoload 全局名** | `Compile Error: Identifier not found: DataRegistry` | 需要 autoload 的测试**必须用 `--scene` 方式**（见 `tests/integration/integration_runner.tscn`）；纯逻辑测试用 `--script` |
| 2 | **`--headless` 不出图** | `--write-movie` 产出 0 字节或报错 | 截图时**不要加 `--headless`** |
| 3 | **无类型 `Array` 不能赋给 `Array[Dictionary]`** | `Trying to assign an array of type "Array" to a variable of type "Array[Dictionary]"`；UI 静默空白 | 构造时就声明为 `Array[Dictionary]`；`DataRegistry.rows()` 已修，勿改回 |
| 4 | **Godot 内置字体不含 CJK** | 中文显示为方框 | 已用 `assets/fonts/ui_theme.tres` 的 `SystemFont` 解决；**新控件仍需显式设字色**，否则浅底浅字不可读 |
| 5 | **`user://` 在某些环境不可写** | 存档报错 | 已做四级兜底；测试用 `--saves-dir=<绝对路径>` |
| 6 | **中文字符紧邻 shell 变量** | `OUT_DIR： unbound variable` | shell 中变量一律用 `${VAR}` 界定 |
| 7 | **GL Compatibility 不支持 2D MSAA** | 启动警告 | 已移除 `anti_aliasing/quality/msaa_2d`，勿加回 |

---

## 10. 交付物清单

```
新增数据表（src/data/tables/）
├─ gongfa.json              87 行：功法战斗数据（含起势/收势/内力/被动）
├─ gongfa_realm.json        10 行：境界倍率（×8.0 版）
├─ enemy_template.json      ≥24 行：敌方模板
├─ tag_combo.json           三层词条（≥ 20 条）
└─ hint_text.json           §7.2 全部提示语

新增核心逻辑（src/core/battle/）
├─ battle_types.gd
├─ battle_rng.gd
├─ battle_stats.gd
├─ battle_actor.gd
├─ battle_formula.gd
├─ status_runtime.gd
├─ combo_resolver.gd
├─ battle_ai.gd
├─ battle_setup.gd
├─ battle_result.gd
├─ battle_simulator.gd
└─ combat_data_source.gd          （抽象接口）

新增数据层（src/data/registry/, src/core/data/）
├─ registry_combat_data_source.gd （从 DataRegistry 取，装配层用）
└─ table_combat_data_source.gd    （从字典取，测试用）

新增表现层（src/presentation/battle/）
├─ battle_scene.gd        九宫格布阵 + 事件回放 + 速度控制
├─ battle_hud.gd          血条/内力/状态图标/飘字
├─ battle_log_panel.gd    战斗日志
└─ hint_presenter.gd      提示语呈现（三层体系）

新增场景
├─ scenes/battle/battle.tscn      （替换现有占位）
└─ scenes/dev/battle_lab.tscn     （数值演练台：批量模拟 + TTK 报表）

新增测试
├─ tests/unit/battle_*.gd
└─ tools/ci/sim_battle.gd         （100 场模拟报告）

更新
└─ src/autoload/event_bus.gd      （如需补充战斗相关信号）
```

---

## 11. 明确不做（范围边界）

| 不做 | 原因 |
|------|------|
| 精灵图 / 骨骼 / 粒子 / 着色器 | 属动画系统，见 §6.1；本任务只发表现指令 |
| 装备掉落结算 | 属经济系统；本任务只产出 `battle_end` 事件供上层处理 |
| 存档写入战斗状态 | 属存档系统；本任务只提供 `final_state` |
| 自动寻路 / 场景移动 | 与战斗无关 |
| 联网 / PVP | 单机定位 |
| 通用招式冷却 | **已决策不引入**（`烟雨江湖战斗对齐.md` §3.4） |

---

## 12. 建议实施顺序（每一步都可独立验证）

| 步 | 内容 | 验证方式 |
|:--:|------|----------|
| 1 | 生成 5 张数据表（含 §7.2 提示语） | `DataRegistry` 启动无 error；提示语五条校验通过 |
| 2 | `battle_types` / `battle_rng` / `battle_stats` | 单元测试：派生公式与上限 |
| 3 | `battle_formula` | 单元测试：伤害管线 7 步与上限 |
| 4 | `status_runtime` | 单元测试：叠加/免疫/持续伤害 |
| 5 | `combo_resolver` + `battle_ai` | 单元测试：连招链路 + 目标选择 |
| 6 | `battle_simulator` | 单元测试：确定性、回合上限、编队系数 |
| 7 | 100 场模拟报告 | 命令输出，TTK 落区间 |
| 8 | `battle.tscn` 表现层 | 渲染 PNG 确认 |
| 9 | `battle_lab.tscn` 数值演练台 | 渲染 PNG 确认 |

**每完成一步就提交一次可运行状态**，不允许留半成品分支。

---

> **任务书结束。** 若有歧义，优先参考 `jianghu-design/GDD/` 的数值与 `jianghu-design/12_tech/动画复用方案_v1.0.md` 的表现约定；两者冲突时，**数值以 GDD 为准，表现字段以动画复用方案为准**。
