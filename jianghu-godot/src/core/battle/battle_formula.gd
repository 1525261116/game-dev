class_name BattleFormula
extends RefCounted
## 伤害管线（纯逻辑，顺序**不可调整**，对齐 GDD 3.1.2）。
##
## 单次攻击结算：命中 → 暴击 → 基础伤害 → 防御减免 → 增伤/减伤 → 吸血 → 施加状态
##
##   ① 命中判定：命中率 = 攻击方命中率（0.90 + 加成）− 目标闪避，钳制 5%~95%
##   ② 暴击判定：暴击率（上限 75%）；触发时伤害 ×暴击倍率（上限 300%）
##   ③ 基础伤害 = 攻击力 + 修为差距 + 功法威力
##        攻击力   = 臂力 × 3 + 装备攻击（在 L2.atk 里已算好）
##        功法威力 = 品质基础威力 × 境界倍率 × 3
##        修为差距 = 内力修为差距 + 功法类型修为差距（合计为负 → ÷2；
##                   单项封顶 ±120，合计 ±180；跨类型不结算）
##   ④ 减伤修正 = 1 − 防御力 /（防御力 + 150），结果不为负
##   ⑤ 增伤修正 = 1 + 连招 + 词条 + 天赋 + 境界 + 阵法（总增伤 ≤ +60%；
##                总减伤 ≤ 90%——减伤由"受伤修正"承担）
##   ⑥ 吸血 = 最终伤害 × 吸血率（不超过气血上限，不溢出）
##   ⑦ 施加状态：按概率施加（眩晕/击退/封穴/中毒/流血/灼烧/破防…）
##
## 实际伤害 = 基础伤害 × 减伤修正 × 暴击修正 × 增伤修正
##
## 本模块**只产出事件与数值**，不做任何表现层动作，也不打印。

## 结算结果的结构（避免各处手写不一致）
static func empty_result() -> Dictionary:
	return {
		"hit": false,
		"crit": false,
		"damage": 0.0,
		"lifesteal": 0.0,
		"actor_id": "",
		"target_id": "",
		"skill_id": "",
		"events": [] as Array[Dictionary],
		"debug": {},
	}


## 单次攻击结算。
## context 可含：
##   combo_bonus / tag_bonus / talent_bonus / realm_bonus / formation_bonus（增伤项，
##   各自小数，例如 0.30 = +30%）
##   damage_taken_bonus（额外受伤修正，小数）
##   cultivation_gap（**由调用方算好的**修为差距；缺省则用双方 cultivation 现算）
##   ignore_def（0~1，无视防御比例）、true_strike（bool，必中）
##   aoe_index（第几个目标，1 起；用于群体递减，缺省 1）
##   same_group_bonus（词条层一/二/三的直接加成，已由 BattleAi/Simulator 聚合）
static func resolve_attack(attacker: BattleActor, defender: BattleActor, skill: Dictionary,
		realm: Dictionary, context: Dictionary, rng: BattleRng) -> Dictionary:
	var result := empty_result()
	result["actor_id"] = attacker.id
	result["target_id"] = defender.id
	result["skill_id"] = str(skill.get("id", BattleTypes.BASIC_ATTACK_ID))

	if attacker == null or defender == null or not attacker.is_alive() or not defender.is_alive():
		return result

	# ── ① 命中判定 ────────────────────────────────────────────────────
	var true_strike := bool(context.get("true_strike", false))
	var hit_chance := float(attacker.l2.get("hit_rate", BattleTypes.HIT_BASE)) \
		- float(defender.l2.get("dodge_rate", 0.0))
	hit_chance = clampf(hit_chance,
		float(context.get("hit_min", BattleTypes.HIT_MIN)),
		float(context.get("hit_max", BattleTypes.HIT_MAX)))
	var hit := true if true_strike else rng.chance(hit_chance)

	result["debug"] = {
		"hit_chance": hit_chance,
		"true_strike": true_strike,
		"combo_level": int(context.get("combo_level", 1)),
		"ignore_def": float(context.get("ignore_def", 0.0)),
	}
	if not hit:
		result["hit"] = false
		result["events"].append({
			"type": "attack_miss",
			"actor_id": attacker.id,
			"target_id": defender.id,
			"skill_id": str(skill.get("id", BattleTypes.BASIC_ATTACK_ID)),
			"skill_name": str(skill.get("name", "普攻")),
			"hint_key": "attack_miss",
		})
		if bool(context.get("emit_log", true)):
			result["events"].append({
				"type": "hint", "hint_key": "attack_miss_log",
				"vars": {
					"actor_name": attacker.display_name,
					"skill_name": str(skill.get("name", "普攻")),
					"target_name": defender.display_name,
				},
			})
		return result

	# ── ② 暴击判定 ────────────────────────────────────────────────────
	var crit_rate := clampf(float(attacker.l2.get("crit_rate", BattleTypes.CRIT_BASE)),
		0.0, float(context.get("crit_rate_cap", BattleTypes.CRIT_RATE_CAP)))
	var crit := rng.chance(crit_rate)
	var crit_mult := clampf(float(attacker.l2.get("crit_damage", BattleTypes.CRIT_DAMAGE_BASE)),
		1.0, float(context.get("crit_damage_cap", BattleTypes.CRIT_DAMAGE_CAP))) if crit else 1.0

	# ── ③ 基础伤害 = 攻击力 + 修为差距 + 功法威力 ─────────────────────
	var atk := float(attacker.l2.get("atk", 0.0))
	var power := skill_power(skill, realm)
	var gap: float = float(context.get("cultivation_gap", 0.0))
	if context.has("cultivation_gap"):
		gap = float(context["cultivation_gap"])
	var base_damage := atk + gap + power

	# ── ④ 减伤修正 = 1 − 防御 /(防御 + 150) ──────────────────────────
	var defense := float(defender.l2.get("def", 0.0))
	var ignore_def := clampf(float(context.get("ignore_def", 0.0)), 0.0, 1.0)
	defense *= (1.0 - ignore_def)
	var reduction := BattleStats.defense_reduction(
		defense, float(context.get("defense_constant", BattleTypes.DEFENSE_CONSTANT)))

	# ── ⑤ 增伤修正 + 受伤修正（各自的**总上限**单独钳制）─────────────
	var bonus_cap := float(context.get("damage_bonus_cap", BattleTypes.DAMAGE_BONUS_CAP))
	var incoming_cap := float(context.get("damage_reduction_cap", BattleTypes.DAMAGE_REDUCTION_CAP))

	var bonus := float(context.get("combo_bonus", 0.0)) \
		+ float(context.get("tag_bonus", 0.0)) \
		+ float(context.get("talent_bonus", 0.0)) \
		+ float(context.get("realm_bonus", 0.0)) \
		+ float(context.get("formation_bonus", 0.0)) \
		+ float(attacker.l2.get("damage_bonus", 0.0))
	bonus = clampf(bonus, -0.99, bonus_cap)

	# 受伤侧：状态 / 阵法的 damage_taken 修正（负值 = 减伤）
	var taken := float(defender.l2.get("damage_taken", 0.0)) \
		+ float(context.get("damage_taken_bonus", 0.0))
	taken = clampf(taken, -incoming_cap, 10.0)

	var damage := base_damage * reduction * crit_mult * (1.0 + bonus) * (1.0 + taken)

	# 群体递减（乘在最终伤害上，见 GDD 3.1.4a）
	var aoe_index := maxi(1, int(context.get("aoe_index", 1)))
	damage *= BattleTypes.aoe_decay(aoe_index)

	# 下限保护：命中至少造成 1 点伤害（避免高防低攻陷入 0 伤害死循环）
	damage = maxf(1.0, damage)
	damage = roundf(damage * 100.0) / 100.0

	var actual := defender.take_damage(damage)
	attacker.dealt_damage += actual

	# ── ⑥ 吸血 = 最终伤害 × 吸血率 ───────────────────────────────────
	var lifesteal_rate := maxf(0.0, float(attacker.l2.get("lifesteal", 0.0))
		+ float(context.get("lifesteal_bonus", 0.0)))
	var lifesteal := 0.0
	if lifesteal_rate > 0.0:
		lifesteal = attacker.heal(actual * lifesteal_rate)

	result["hit"] = true
	result["crit"] = crit
	result["damage"] = actual
	result["lifesteal"] = lifesteal
	result["debug"]["reduction"] = reduction
	result["debug"]["bonus"] = bonus
	result["debug"]["taken"] = taken
	result["debug"]["base_damage"] = base_damage
	result["debug"]["power"] = power
	result["debug"]["gap"] = gap

	# 命中事件（表现层唯一依赖：伤害飘字 / 受击 / HitStop）
	result["events"].append({
		"type": "attack_hit",
		"actor_id": attacker.id,
		"actor_name": attacker.display_name,
		"target_id": defender.id,
		"target_name": defender.display_name,
		"target_slot": defender.slot,
		"skill_id": str(skill.get("id", BattleTypes.BASIC_ATTACK_ID)),
		"skill_name": str(skill.get("name", "普攻")),
		"damage": actual,
		"crit": crit,
		"lifesteal": lifesteal,
		"hint_key": "hit_crit" if crit else "hit_normal",
		"vars": {"damage": int(round(actual))},
	})
	if crit:
		result["events"].append({
			"type": "hint", "hint_key": "hit_crit_log",
			"vars": {
				"actor_name": attacker.display_name,
				"skill_name": str(skill.get("name", "普攻")),
				"damage": int(round(actual)),
			},
		})
	if lifesteal > 0.0:
		result["events"].append({
			"type": "hint", "hint_key": "lifesteal",
			"vars": {"heal": int(round(lifesteal))},
		})

	# ── ⑦ 施加状态（由调用方在拿到结果后统一 apply，保持公式模块无副作用）──
	var status_plan := plan_statuses(attacker, defender, skill, context)
	if not status_plan.is_empty():
		result["status_plan"] = status_plan

	if not defender.is_alive():
		result["target_down"] = true
	return result


## 由调用方在结算完成后统一施加（把"掷骰"留在公式层，把"改状态"留给调用方，
## 便于测试与回放）。返回事件数组。
static func apply_status_plan(plan: Array, defender: BattleActor, data: CombatDataSource,
		formation: Dictionary, rng: BattleRng) -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	for item in plan:
		var status_id := str(item.get("status_id", ""))
		var chance := clampf(float(item.get("chance", 0.0)), 0.0, 1.0)
		if status_id == "" or not rng.chance(chance):
			continue
		var duration := int(item.get("duration", 0))
		if duration <= 0:
			duration = int(data.status(status_id).get("duration", 1))
		events.append_array(StatusRuntime.apply(
			defender, status_id, duration, int(item.get("stacks", 1)), data, formation))
	return events


## 状态施加计划：只掷"是否施加"的概率来源在这里，实际施加由 apply_status_plan 完成。
## 返回 [{status_id, chance, duration, stacks}]
static func plan_statuses(attacker: BattleActor, defender: BattleActor, skill: Dictionary,
		context: Dictionary) -> Array:
	var plan: Array = []
	if bool(context.get("no_status", false)):
		return plan
	var group := str(skill.get("group", ""))
	var bonus: Dictionary = context.get("status_bonus", {})

	# 状态 → 施加它的功法 group（数据驱动：这里只映射"哪类功法带哪种状态"）
	var candidates: Array = []
	match group:
		"quan":
			candidates = ["stun", "atkDown"]
		"qimen":
			candidates = ["seal", "defDown"]
		"qiang":
			candidates = ["knockback", "defDown"]
		"dao":
			candidates = ["bleed", "defDown"]
		"jian":
			candidates = ["bleed", "dodgeDown"]
		"anqi":
			candidates = ["poison", "hitDown"]
		"neigong":
			candidates = ["burn", "innerDown"]
		"shenfa":
			candidates = ["spdDown"]
		_:
			candidates = []

	for i in candidates.size():
		var status_id := str(candidates[i])
		var chance := float(BattleTypes.STATUS_CHANCE.get(status_id, 0.25))
		# 后续候选状态（第 2 个）概率减半，避免单次攻击挂满状态
		if i > 0:
			chance *= 0.5
		chance += float(bonus.get(status_id, 0.0))
		if chance <= 0.0:
			continue
		plan.append({"status_id": status_id, "chance": chance, "duration": 0, "stacks": 1})
	return plan


# ---------------------------------------------------------------- 功法威力 / 修为差距

## 功法威力 = 品质基础威力 × 境界倍率 × 3
static func skill_power(skill: Dictionary, realm: Dictionary) -> float:
	if skill.is_empty():
		return 0.0
	var base := float(skill.get("power", 0))
	var mult := float(realm.get("multiplier", 1.0))
	return base * mult * BattleTypes.POWER_MULTIPLIER


## 普攻威力：攻击力 × 0.5（GDD 3.1.8 的普攻兜底）
static func basic_attack_damage(atk: float) -> float:
	return atk * BattleTypes.BASIC_ATTACK_RATIO


## 修为差距入伤害（GDD 3.4.4）：
##   内力修为差距     = 我方内功修为 − 敌方内功修为
##   功法类型修为差距 = 我方所用功法类型修为 − 敌方同类型修为（**跨类型不结算**）
##   合计为负 → ÷2；单项封顶 ±120，合计封顶 ±180
static func cultivation_gap(attacker: BattleActor, defender: BattleActor,
		skill: Dictionary) -> float:
	var type_key := str(BattleTypes.GROUP_TO_CULTIVATION.get(str(skill.get("group", "")), ""))
	var inner_gap := float(attacker.cultivation.get("neigong", 0)) \
		- float(defender.cultivation.get("neigong", 0))
	var type_gap := 0.0
	if type_key != "":
		type_gap = float(attacker.cultivation.get(type_key, 0)) \
			- float(defender.cultivation.get(type_key, 0))

	# 跨类型不结算：对方没有该类型修为时也按 0 处理（已由上式的 get 默认值保证）
	return combine_gap(inner_gap, type_gap)


## 把两项修为差距合并（含封顶与负值折半规则）——独立出来便于单测。
static func combine_gap(inner_gap: float, type_gap: float,
		single_cap: float = BattleTypes.CULTIVATION_DIFF_CAP_SINGLE,
		total_cap: float = BattleTypes.CULTIVATION_DIFF_CAP_TOTAL) -> float:
	var a := clampf(inner_gap, -single_cap, single_cap)
	var b := clampf(type_gap, -single_cap, single_cap)
	var total := a + b
	if total < 0.0:
		total *= 0.5
	return clampf(total, -total_cap, total_cap)
