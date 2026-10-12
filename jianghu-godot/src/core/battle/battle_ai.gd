class_name BattleAi
extends RefCounted
## 出战决策（纯逻辑，无引擎依赖）。
##
## 职责：在给定"当前存活敌人 + 自身内力 + 上一式收势"下，挑出本回合要释放的功法与目标。
## 决策规则（按优先级，对齐任务书 §4.7）：
##   ① 内力不足的技能**不可选**
##   ② preference == "combo"：优先选 `start_mark == last_end_mark` 且内力足够的技能
##   ③ 否则退化为选**期望伤害最高**的技能
##   ④ 全部不可用（含内力不足）→ **普攻**（攻击力 × 0.5，无消耗）
##   ⑤ 目标选择：single → 同列优先；column → 该列全体；row → 该行全体；all → 全体
##
## 本模块**是纯函数**：不修改 actor，不消耗内力（消耗由模拟器执行）。

const BASIC_SKILL_ID: String = BattleTypes.BASIC_ATTACK_ID


## 选技能。返回 {skill_id, skill(行字典), reason, combo_preview, is_basic, cost}
## `last_end_mark`：本方该列上一式的收势（0 = 无链）。
static func choose_skill(actor: BattleActor, enemies: Array[BattleActor], preference: String,
		data: CombatDataSource, last_end_mark: int, rng: BattleRng) -> Dictionary:
	var usable: Array[Dictionary] = []
	for skill_id in actor.skills:
		var skill := data.gongfa(skill_id)
		if skill.is_empty():
			continue
		# 内功 / 身法是被动类，不作为主动输出（其价值已计入 L2 / 被动）
		if str(skill.get("type", "external")) != "external":
			continue
		var cost := float(skill.get("inner_cost", 0))
		if actor.inner < cost:
			continue
		usable.append(skill)

	if usable.is_empty():
		return basic_attack(actor, data)

	# ② 连招优先
	if preference == "combo" and last_end_mark != 0:
		var chained: Array[Dictionary] = []
		for skill in usable:
			if int(skill.get("start_mark", 0)) == last_end_mark:
				chained.append(skill)
		if not chained.is_empty():
			var pick: Dictionary = _pick_best(actor, enemies, chained, data, rng)
			var preview := _preview_level(chain_len_from_mark(last_end_mark), pick)
			return {
				"skill_id": str(pick.get("id", "")),
				"skill": pick,
				"reason": "combo",
				"combo_preview": preview,
				"is_basic": false,
				"cost": float(pick.get("inner_cost", 0)),
			}

	# ③ 期望伤害最高
	var best: Dictionary = _pick_best(actor, enemies, usable, data, rng)
	return {
		"skill_id": str(best.get("id", "")),
		"skill": best,
		"reason": "damage" if preference != "combo" else "fallback_damage",
		"combo_preview": 1,
		"is_basic": false,
		"cost": float(best.get("inner_cost", 0)),
	}


## 普攻兜底（攻击力 × 0.5，无消耗）
static func basic_attack(_actor: BattleActor, _data: CombatDataSource) -> Dictionary:
	return {
		"skill_id": BASIC_SKILL_ID,
		"skill": {
			"id": BASIC_SKILL_ID,
			"name": "普攻",
			"group": "",
			"type": "external",
			"quality": "fan",
			"power": 0,
			"inner_cost": 0,
			"start_mark": 0,
			"end_mark": 0,
			"targets": "single",
		},
		"reason": "basic",
		"combo_preview": 0,
		"is_basic": true,
		"cost": 0.0,
	}


## 目标选择。返回按"结算序位"排好序的目标数组（第 1 个 = 主目标，吃全额伤害）。
static func choose_target(actor: BattleActor, enemies: Array[BattleActor], targets: String,
		rng: BattleRng) -> Array[BattleActor]:
	var alive: Array[BattleActor] = []
	for e in enemies:
		if e.is_alive():
			alive.append(e)
	if alive.is_empty():
		return [] as Array[BattleActor]

	match targets:
		"all":
			alive.sort_custom(func(a: BattleActor, b: BattleActor) -> bool: return a.slot < b.slot)
			return alive
		"column":
			var col := BattleGrid.same_column(actor.slot)
			return _filter_slots(alive, col)
		"row":
			var row: Array = BattleGrid.ROWS[BattleGrid.row_of(actor.slot)]
			return _filter_slots(alive, row)
		_:
			# single：同列优先（敌方 AI 亦如此），同列多个取血最少者；无同列则取最近
			var same := _filter_slots(alive, BattleGrid.same_column(actor.slot))
			if not same.is_empty():
				same.sort_custom(func(a: BattleActor, b: BattleActor) -> bool: return a.hp < b.hp)
				return [same[0]] as Array[BattleActor]
			alive.sort_custom(func(a: BattleActor, b: BattleActor) -> bool:
				var da := absi(a.slot - actor.slot)
				var db := absi(b.slot - actor.slot)
				if da == db:
					return a.hp < b.hp
				return da < db)
			return [alive[0]] as Array[BattleActor]


## 敌方 AI 的模板偏好（模板自带 ai_preference 时优先用模板的）
static func preference_for(enemy: BattleActor, fallback: String) -> String:
	if enemy.ai_preference != "":
		return enemy.ai_preference
	return fallback


## 由「期待的起势」推出当前链长（1 表示已出第一式，2 表示已出第二式）
static func chain_len_from_mark(last_end_mark: int) -> int:
	return 1 if last_end_mark != 0 else 0


# ---------------------------------------------------------------- 私有

static func _filter_slots(pool: Array[BattleActor], slots: Array) -> Array[BattleActor]:
	var out: Array[BattleActor] = []
	for slot in slots:
		for e in pool:
			if e.slot == int(slot):
				out.append(e)
	return out


static func _preview_level(chain_len: int, skill: Dictionary) -> int:
	if ComboResolver.is_support(skill):
		return 0
	return clampi(chain_len + 1, 1, 3)


## 期望伤害评估：对每个候选技能算"该技能在最优目标下的期望伤害"，取最大者。
## 期望伤害 = 命中率 × (1 + 暴击率 ×(暴伤−1)) ×（基础伤害 × 减伤 × 增伤）× 目标数系数
static func _pick_best(actor: BattleActor, enemies: Array[BattleActor], candidates: Array[Dictionary],
		_data: CombatDataSource, _rng: BattleRng) -> Dictionary:
	var best: Dictionary = candidates[0]
	var best_score := -1.0
	for skill in candidates:
		var score := expected_damage(actor, enemies, skill)
		# 同分时倾向低消耗（更省内力），再倾向高威力
		if score > best_score or (is_equal_approx(score, best_score)
				and float(skill.get("inner_cost", 0)) < float(best.get("inner_cost", 0))):
			best = skill
			best_score = score
	return best


## 单门功法对当前敌人集合的期望伤害（供 AI 与数值报告共用，故公开）
static func expected_damage(actor: BattleActor, enemies: Array[BattleActor],
		skill: Dictionary) -> float:
	var alive: Array[BattleActor] = []
	for e in enemies:
		if e.is_alive():
			alive.append(e)
	if alive.is_empty():
		return 0.0

	var targets := choose_target(actor, enemies, str(skill.get("targets", "single")), null)
	if targets.is_empty():
		return 0.0

	var atk := float(actor.l2.get("atk", 0.0))
	var power := float(skill.get("power", 0.0))
	var total := 0.0
	for i in targets.size():
		var target := targets[i]
		var base := atk + power
		var reduction := BattleStats.defense_reduction(float(target.l2.get("def", 0.0)))
		var hit := clampf(float(actor.l2.get("hit_rate", BattleTypes.HIT_BASE))
			- float(target.l2.get("dodge_rate", 0.0)), BattleTypes.HIT_MIN, BattleTypes.HIT_MAX)
		var crit_rate := float(actor.l2.get("crit_rate", 0.0))
		var crit_mult := 1.0 + crit_rate * (float(actor.l2.get("crit_damage", 1.5)) - 1.0)
		total += base * reduction * crit_mult * hit * BattleTypes.aoe_decay(i + 1)
	return total
