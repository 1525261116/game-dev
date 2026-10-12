class_name BattleTypes
extends RefCounted
## 战斗枚举与全局常量（纯逻辑，无引擎依赖）。
##
## 职责：集中定义阵营 / 结果枚举与所有战斗上限常数。
## 约束：`src/data/tables/battle_constants.json` 是这些数值的**唯一真相**，
##       本文件的 const 是其缺省镜像（供无数据源的纯逻辑测试使用）。
##       运行时以 `CombatDataSource.constants()` 的值为准，两者不一致时以表为准。

enum Side { ALLY, ENEMY }
enum Outcome { ALLY_WIN, ENEMY_WIN, DRAW }

# ── 战斗上限 / 常数（镜像 battle_constants.json）────────────────────
const MAX_ROUNDS: int = 30
const CRIT_RATE_CAP: float = 0.75
const CRIT_DAMAGE_CAP: float = 3.0
const DODGE_CAP: float = 0.6
const HIT_MIN: float = 0.05
const HIT_MAX: float = 0.95
const DEFENSE_CONSTANT: float = 150.0
const DAMAGE_BONUS_CAP: float = 0.6      ## 增伤总上限
const DAMAGE_REDUCTION_CAP: float = 0.9  ## 减伤总上限
const CULTIVATION_DIFF_CAP_SINGLE: float = 120.0
const CULTIVATION_DIFF_CAP_TOTAL: float = 180.0

# ── 派生公式常数（GDD 3.1.1，不得自行发明）──────────────────────────
const ATK_PER_ARM: float = 3.0
const DEF_PER_BONE: float = 1.5
const HP_PER_BONE: float = 20.0
const INNER_PER_INNER: float = 10.0
const INNER_REGEN_DIVISOR: float = 10.0
const CRIT_BASE: float = 0.05
const CRIT_PER_ARM: float = 0.001      ## 臂力/1000
const CRIT_DAMAGE_BASE: float = 1.5
const HIT_BASE: float = 0.90
const DODGE_PER_AGILITY: float = 0.001  ## 身法/1000
const POWER_MULTIPLIER: float = 3.0     ## 功法威力入公式前的 ×3

# ── 连招（GDD 3.4.5）────────────────────────────────────────────────
const COMBO_2_BONUS: float = 0.30
const COMBO_3_BONUS: float = 0.60
const COMBO_3_LIFESTEAL: float = 0.10

# ── 普攻兜底（GDD 3.1.8）────────────────────────────────────────────
const BASIC_ATTACK_RATIO: float = 0.5
const BASIC_ATTACK_ID: String = "__basic__"

# ── 群体伤害递减（GDD 3.1.4a）───────────────────────────────────────
## 第 i 个目标（1 起）的伤害系数 = max(0.40, 1 − 0.15 × (i − 1))
const AOE_DECAY_STEP: float = 0.15
const AOE_DECAY_FLOOR: float = 0.40

# ── 状态施加基础概率（GDD 3.1.9 状态数值表）─────────────────────────
const STATUS_CHANCE: Dictionary = {
	"stun": 0.20,
	"knockback": 0.45,
	"seal": 0.30,
	"poison": 0.35,
	"bleed": 0.35,
	"burn": 0.30,
	"defDown": 0.30,
	"atkDown": 0.30,
	"spdDown": 0.25,
	"innerDown": 0.25,
	"root": 0.25,
	"dodgeDown": 0.30,
	"hitDown": 0.30,
}

## 功法 group → 修为类别（GDD 3.4.3）。跨类型不结算修为差距。
const GROUP_TO_CULTIVATION: Dictionary = {
	"dao": "dao", "jian": "jian", "quan": "quan",
	"anqi": "anqi", "qimen": "qimen", "qiang": "qiang",
	"neigong": "neigong", "shenfa": "shenfa",
}

## 品质顺序（比较用）
const QUALITY_ORDER: PackedStringArray = ["fan", "liang", "shang", "ji", "jue"]


## 从战斗常量表构造一份"以数据为准"的常数覆盖字典。
## 逻辑层统一用 `_const(ctx, "max_rounds", BattleTypes.MAX_ROUNDS)` 取值。
static func constants_from_rows(rows: Array[Dictionary]) -> Dictionary:
	var out: Dictionary = {}
	for row in rows:
		var id := str(row.get("id", ""))
		if id == "":
			continue
		out[id] = row.get("value", null)
	return out


## 取群攻递减系数（第 index 个目标，index 从 1 起）
static func aoe_decay(index: int) -> float:
	if index <= 1:
		return 1.0
	return maxf(AOE_DECAY_FLOOR, 1.0 - AOE_DECAY_STEP * float(index - 1))
