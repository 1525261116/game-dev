class_name BattleStats
extends RefCounted
## L1（四维）→ L2（战斗属性）派生（纯逻辑，对齐 GDD 3.1.1）。
##
## L1 输入：{arm 臂力, agility 身法, bone 根骨, inner 内息}
## 装备注入：{atk, def, hp, inner, crit, crit_dmg, hit, dodge, lifesteal, dmg_bonus,
##            speed, inner_regen, hp_max}
## 功法修正：{hp_max, inner_max, inner_regen, speed, atk_pct, def_pct, all_pct,
##            damage_bonus, lifesteal, crit, dodge, hit, damage_taken}
##
## **公式逐条照抄 GDD 3.1.1，不得改动**（见下表）。所有上限在此处钳制一次，
## 结算阶段（BattleFormula）再按需钳制，两处口径一致。

## 数值上限（与 BattleTypes / battle_constants.json 一致）
const CRIT_RATE_CAP: float = BattleTypes.CRIT_RATE_CAP
const CRIT_DAMAGE_CAP: float = BattleTypes.CRIT_DAMAGE_CAP
const DODGE_CAP: float = BattleTypes.DODGE_CAP
const HIT_MIN: float = BattleTypes.HIT_MIN
const HIT_MAX: float = BattleTypes.HIT_MAX


## L1 → L2 派生。
## 返回 {atk, def, hp_max, inner_max, inner_regen, crit_rate, crit_damage,
##       hit_rate, dodge_rate, speed, lifesteal, damage_bonus, damage_taken}
static func derive(l1: Dictionary, equip: Dictionary = {}, mods: Dictionary = {}) -> Dictionary:
	var arm := float(l1.get("arm", 0))
	var agility := float(l1.get("agility", 0))
	var bone := float(l1.get("bone", 0))
	var inner := float(l1.get("inner", 0))

	# 百分比修正（功法被动 / 状态 / 阵法）—— 先算总量，再乘到基础值上
	var all_pct := float(mods.get("all_pct", 0.0))
	var atk_pct := float(mods.get("atk_pct", 0.0)) + all_pct
	var def_pct := float(mods.get("def_pct", 0.0)) + all_pct

	# ① 攻击力 = 臂力 × 3 + 装备攻击
	var atk := arm * BattleTypes.ATK_PER_ARM + float(equip.get("atk", 0))
	atk *= 1.0 + atk_pct

	# ② 防御力 = 根骨 × 1.5 + 装备防御（减伤边际递减，常数 150 在结算处体现）
	var def := bone * BattleTypes.DEF_PER_BONE + float(equip.get("def", 0))
	def *= 1.0 + def_pct

	var hp_pct := float(mods.get("hp_max_pct", 0.0)) + all_pct
	var inner_pct := float(mods.get("inner_max_pct", 0.0)) + all_pct
	var regen_pct := float(mods.get("inner_regen_pct", 0.0)) + all_pct

	# ③ 气血 = 根骨 × 20 + 装备气血 + 内功气血
	var hp_max := bone * BattleTypes.HP_PER_BONE + float(equip.get("hp", 0)) + float(mods.get("hp_max", 0))
	hp_max *= 1.0 + hp_pct

	# ④ 内力 = 内息 × 10 + 内功内力
	var inner_max := inner * BattleTypes.INNER_PER_INNER + float(equip.get("inner", 0)) + float(mods.get("inner_max", 0))
	inner_max *= 1.0 + inner_pct

	# ⑤ 内力回复 = 内息 / 10 + 内功加成（每回合）
	var inner_regen := inner / BattleTypes.INNER_REGEN_DIVISOR \
		+ float(equip.get("inner_regen", 0)) + float(mods.get("inner_regen", 0))
	inner_regen *= 1.0 + regen_pct

	# ⑥ 暴击率 = 0.05 + 臂力/1000 + 装备（上限 0.75）
	var crit_rate := BattleTypes.CRIT_BASE + arm * BattleTypes.CRIT_PER_ARM \
		+ float(equip.get("crit", 0)) + float(mods.get("crit", 0))
	crit_rate = clampf(crit_rate, 0.0, CRIT_RATE_CAP)

	# ⑦ 暴击伤害 = 1.5 + 装备（上限 3.0）
	var crit_damage := BattleTypes.CRIT_DAMAGE_BASE + float(equip.get("crit_dmg", 0)) \
		+ float(mods.get("crit_dmg", 0))
	crit_damage = clampf(crit_damage, 0.0, CRIT_DAMAGE_CAP)

	# ⑧ 命中率 = 0.90 + 命中加成（结算时再钳制 0.05~0.95）
	var hit_rate := BattleTypes.HIT_BASE + float(equip.get("hit", 0)) + float(mods.get("hit", 0))
	hit_rate = clampf(hit_rate, HIT_MIN, HIT_MAX)

	# ⑨ 闪避率 = 身法/1000 + 装备（上限 0.60）
	var dodge_rate := agility * BattleTypes.DODGE_PER_AGILITY \
		+ float(equip.get("dodge", 0)) + float(mods.get("dodge", 0))
	dodge_rate = clampf(dodge_rate, 0.0, DODGE_CAP)

	# ⑩ 出手速度 = 身法 + 轻功 / 词条先手加成
	var speed := agility + float(equip.get("speed", 0)) + float(mods.get("speed", 0))
	speed *= 1.0 + float(mods.get("speed_pct", 0.0))

	# ⑪ 吸血 / 增伤 / 受伤修正
	var lifesteal := float(equip.get("lifesteal", 0)) + float(mods.get("lifesteal", 0))
	var damage_bonus := float(equip.get("dmg_bonus", 0)) + float(mods.get("damage_bonus", 0))
	var damage_taken := float(mods.get("damage_taken", 0))

	return {
		"atk": atk,
		"def": def,
		"hp_max": hp_max,
		"inner_max": inner_max,
		"inner_regen": inner_regen,
		"crit_rate": crit_rate,
		"crit_damage": crit_damage,
		"hit_rate": hit_rate,
		"dodge_rate": dodge_rate,
		"speed": speed,
		"lifesteal": lifesteal,
		"damage_bonus": damage_bonus,
		"damage_taken": damage_taken,
	}


## 把 L1 缺省值补全（缺字段一律按 0 处理，绝不崩）
static func normalize_l1(l1: Dictionary) -> Dictionary:
	return {
		"arm": float(l1.get("arm", 0)),
		"agility": float(l1.get("agility", 0)),
		"bone": float(l1.get("bone", 0)),
		"inner": float(l1.get("inner", 0)),
	}


## 防御减伤修正 = 1 − 防御 /(防御 + 常数)，结果不为负。
## 防御 150 → 50% 减伤（GDD 3.1.3 对照表）。
static func defense_reduction(defense: float, constant: float = BattleTypes.DEFENSE_CONSTANT) -> float:
	if defense <= 0.0:
		return 1.0
	var denom := defense + constant
	if denom <= 0.0:
		return 1.0
	return maxf(0.0, 1.0 - defense / denom)


## 单次减伤比例（供 UI / 测试显示）
static func damage_reduction_pct(defense: float, constant: float = BattleTypes.DEFENSE_CONSTANT) -> float:
	return 1.0 - defense_reduction(defense, constant)
