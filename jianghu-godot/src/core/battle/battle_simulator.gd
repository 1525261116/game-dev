class_name BattleSimulator
extends RefCounted
## 战斗预结算内核（纯逻辑，无引擎依赖）。
##
## 入口：`simulate(setup: BattleSetup, data: CombatDataSource) -> BattleResult`
##
## 主循环（对齐任务书 §4.8）：
##   1. 构建双方 BattleActor（L2 派生 + 装备 + 内功加成）
##   2. 施加阵法加成（我方）：FormationResolver.resolve → partial ×0.5 / fail 不加成
##   3. 先手判定：比较双方「最高身法 + 先手加成」，高者先手
##   4. 回合循环（最多 MAX_ROUNDS 轮）
##      a. 按身法从高到低排出行动顺序（同身法：先手方优先 → 站位 1→9）
##      b. 每个存活单位行动一次（眩晕跳过 / 封穴强制普攻 / AI 选技能与目标）
##      c. 回合末：状态 tick（持续伤害 / 治疗 / 时长递减 / 到期移除）
##      d. 判定胜负：任一方全灭 → 结束
##   5. 达到 MAX_ROUNDS 仍未分出 → outcome = ENEMY_WIN（久战判负）
##
## 本模块是**唯一**把各子模块串起来的地方，也是唯一负责"事件流"装配的地方。
## 表现层只读 `BattleResult.events`，绝不参与数值计算。

## 事件时间轴的推进量（毫秒，缺省值；实际会按 timingScale / hitStopMs 调整）
const MS_TURN: int = 260
const MS_CAST: int = 420
const MS_HIT: int = 200
const MS_STATUS: int = 120
const MS_ROUND: int = 180
const MS_END: int = 500


## 主入口
static func simulate(setup: BattleSetup, data: CombatDataSource) -> BattleResult:
	var sim := _Sim.new()
	return sim.run(setup, data)


# ══════════════════════════════════════════════════════════════════
# 内部实现（独立类，避免污染静态接口）
# ══════════════════════════════════════════════════════════════════
class _Sim:
	var result: BattleResult
	var data: CombatDataSource
	var rng: BattleRng
	var allies: Array[BattleActor] = []
	var enemies: Array[BattleActor] = []
	var all: Array[BattleActor] = []
	var combo_chains: Dictionary = {}      ## "side:col" -> {chain_len, expected_start}
	var formation_effective: Dictionary = {}
	var formation_special: Dictionary = {}
	var formation_result: String = "fail"
	var first_side: int = BattleTypes.Side.ALLY
	var t_ms: int = 0
	var max_rounds: int = BattleTypes.MAX_ROUNDS
	var consts: Dictionary = {}
	var ally_skill_rows: Array[Dictionary] = []   ## 我方装备功法行（同列连招的候选池）
	var warned_round_limit: bool = false
	var turn_order: Array[BattleActor] = []
	var _acted_this_round: Dictionary = {}

	func run(setup: BattleSetup, source: CombatDataSource) -> BattleResult:
		data = source
		rng = BattleRng.new(setup.seed)
		result = BattleResult.new()
		result.seed = setup.seed
		consts = data.constants()
		max_rounds = setup.max_rounds if setup.max_rounds > 0 \
			else int(consts.get("max_rounds", BattleTypes.MAX_ROUNDS))

		_build_actors(setup)
		var start_events := _emit_battle_start(setup)
		_apply_formation(setup)
		if not start_events.is_empty():
			_emit_battle_start_hints(setup)
		first_side = _decide_first_side()

		var round_no := 0
		while round_no < max_rounds:
			round_no += 1
			_advance(MS_ROUND)
			emit({"type": "round_start", "round": round_no,
				"hint_key": "round_start", "vars": {"round": round_no},
				"tier": "float"})
			if round_no == maxi(1, max_rounds - 5) and not warned_round_limit:
				warned_round_limit = true
				emit_hint("round_limit_warn", {})
			_build_turn_order()
			_acted_this_round.clear()

			var i := 0
			while i < turn_order.size():
				var actor := turn_order[i]
				if actor != null and actor.is_alive():
					_take_turn(actor, round_no)
					# 击退：状态生效后立刻把出手顺位后移 3 位（若尚未行动）
					i = _apply_knockback_shift(i)
				i += 1
				if _side_wiped():
					break

			_round_end(round_no)
			if _side_wiped():
				break

		return _finalize(round_no)

	# ---------------------------------------------------------------- 构建

	func _build_actors(setup: BattleSetup) -> void:
		var ally_placement := setup.auto_placement()
		var by_id: Dictionary = {}
		for member in setup.allies:
			by_id[str(member.get("id", ""))] = member

		for slot in BattleGrid.SLOT_COUNT:
			var pid: Variant = ally_placement[slot]
			if pid == null or str(pid) == "":
				continue
			var member: Dictionary = by_id.get(str(pid), {})
			if member.is_empty():
				continue
			var mods := _member_mods(member)
			var actor := BattleActor.from_member(member, BattleTypes.Side.ALLY, slot, mods)
			allies.append(actor)

		var enemy_placement := setup.auto_enemy_placement()
		var scale := setup.effective_party_scale()
		var entries := setup.enemies
		var used := {}
		for slot in BattleGrid.SLOT_COUNT:
			var tid: Variant = enemy_placement[slot]
			if tid == null or str(tid) == "":
				continue
			var entry := _find_enemy_entry(entries, str(tid), used)
			if entry.is_empty():
				# 站位里出现了 enemies 数组里没有的模板 → 直接按 id 当模板构造，
				# 避免「静默空场」（曾经因此出现 1 回合秒胜的错误报告）
				entry = {"template_id": str(tid)}
			var template_id := str(entry.get("template_id", entry.get("id", "")))
			var template := data.enemy(template_id)
			if template.is_empty():
				continue
			var overrides := entry.duplicate(true)
			if not entry.has("id"):
				overrides["id"] = "%s@%d" % [template_id, slot]
			if setup.enemy_ai_preference != "":
				overrides["ai_preference"] = setup.enemy_ai_preference
			var actor := BattleActor.from_enemy_template(template, BattleTypes.Side.ENEMY, slot, scale, overrides)
			if overrides.has("ai_preference"):
				actor.ai_preference = str(overrides["ai_preference"])
			enemies.append(actor)

		all = []
		all.append_array(allies)
		all.append_array(enemies)
		for a in all:
			combo_chains[_chain_key(a)] = {"chain_len": 0, "expected_start": 0}

	## 我方成员的功法修正（内功气血 / 内力、被动、三层词条的静态部分）
	func _member_mods(member: Dictionary) -> Dictionary:
		var mods: Dictionary = {}
		var realms: Dictionary = member.get("realm_levels", {})
		var ids: Array = member.get("skills", [])
		for skill_id in ids:
			var row: Dictionary = data.gongfa(str(skill_id))
			if row.is_empty():
				continue
			ally_skill_rows.append(row)
			if str(row.get("type", "")) == "neigong":
				mods["hp_max"] = float(mods.get("hp_max", 0.0)) + float(row.get("hp_bonus", 0))
				mods["inner_max"] = float(mods.get("inner_max", 0.0)) + float(row.get("inner_bonus", 0))
			elif str(row.get("type", "")) == "shenfa":
				mods["speed"] = float(mods.get("speed", 0.0)) + float(row.get("speed_bonus", 0))
			# 功法被动的静态部分（解锁境界检查在 _collect_mods 里按等级做，这里只放常量项）
			var passive: Dictionary = row.get("passive", {})
			if passive.is_empty():
				continue
			if int(realms.get(str(skill_id), 1)) < int(passive.get("realm", 99)):
				continue
			_absorb_passive_static(mods, str(passive.get("kind", "")), float(passive.get("value", 0.0)))
		return mods

	## 把"静态型"被动折进 L2 mods（其余效果在战斗过程中特判）
	func _absorb_passive_static(mods: Dictionary, kind: String, value: float) -> void:
		match kind:
			"atkPct":
				mods["atk_pct"] = float(mods.get("atk_pct", 0.0)) + value
			"defPct":
				mods["def_pct"] = float(mods.get("def_pct", 0.0)) + value
			"allRound":
				mods["all_pct"] = float(mods.get("all_pct", 0.0)) + value
			"innerMax":
				mods["inner_max_pct"] = float(mods.get("inner_max_pct", 0.0)) + value
			"innerRegen":
				mods["inner_regen_pct"] = float(mods.get("inner_regen_pct", 0.0)) + value
			"crit":
				mods["crit"] = float(mods.get("crit", 0.0)) + value
			"dodge":
				mods["dodge"] = float(mods.get("dodge", 0.0)) + value
			"hit":
				mods["hit"] = float(mods.get("hit", 0.0)) + value
			"speed":
				mods["speed_pct"] = float(mods.get("speed_pct", 0.0)) + value
			"firstStrike":
				mods["speed_pct"] = float(mods.get("speed_pct", 0.0)) + value
			"damageBonus":
				mods["damage_bonus"] = float(mods.get("damage_bonus", 0.0)) + value
			"lifesteal":
				mods["lifesteal"] = float(mods.get("lifesteal", 0.0)) + value

	func _find_enemy_entry(entries: Array, template_id: String, used: Dictionary) -> Dictionary:
		for i in entries.size():
			var e: Dictionary = entries[i]
			var key := str(e.get("template_id", e.get("id", "")))
			if key == template_id and not used.has(i):
				used[i] = true
				return e
		# 模板比站位多时允许复用最后一个
		for e in entries:
			var key2 := str(e.get("template_id", e.get("id", "")))
			if key2 == template_id:
				return e
		return {}

	# ---------------------------------------------------------------- 开局

	func _emit_battle_start(setup: BattleSetup) -> Array[Dictionary]:
		var ally_brief: Array[Dictionary] = []
		for a in allies:
			ally_brief.append(_actor_brief(a))
		var enemy_brief: Array[Dictionary] = []
		for e in enemies:
			enemy_brief.append(_actor_brief(e))
		var ev := {
			"type": "battle_start",
			"allies": ally_brief,
			"enemies": enemy_brief,
			"formation_id": setup.formation_id,
			"formation_result": formation_result,
			"seed": setup.seed,
			"hint_key": "battle_start",
			"vars": {"ally_count": allies.size(), "enemy_count": enemies.size()},
			"tier": "toast",
		}
		result.events.append(_stamp(ev))
		return [ev] as Array[Dictionary]

	func _actor_brief(a: BattleActor) -> Dictionary:
		return {
			"id": a.id,
			"name": a.display_name,
			"side": a.side,
			"slot": a.slot,
			"tier": a.tier,
			"hp_max": float(a.l2.get("hp_max", 0.0)),
			"atk": float(a.l2.get("atk", 0.0)),
			"def": float(a.l2.get("def", 0.0)),
			"spd": float(a.l2.get("speed", 0.0)),
			"inner_max": float(a.l2.get("inner_max", 0.0)),
			"skills": a.skills.duplicate(),
		}

	func _apply_formation(setup: BattleSetup) -> void:
		if setup.formation_id == "":
			formation_result = "fail"
			return
		var formation := data.formation(setup.formation_id)
		if formation.is_empty():
			formation_result = "fail"
			return
		var placement := setup.auto_placement()
		var resolved := FormationResolver.resolve(formation, placement, setup.formation_level)
		formation_result = str(resolved.get("result", "fail"))
		formation_effective = resolved.get("effective", {})
		formation_special = formation_effective.get("special", {})

		var mods: Dictionary = formation_effective.get("mods", {})
		if formation_result != "fail":
			for a in allies:
				a.l2["atk"] = float(a.l2.get("atk", 0.0)) * (1.0 + float(mods.get("atk", 0.0)))
				a.l2["def"] = float(a.l2.get("def", 0.0)) * (1.0 + float(mods.get("def", 0.0)))
				a.l2["speed"] = float(a.l2.get("speed", 0.0)) * (1.0 + float(mods.get("spd", 0.0)))
				a.l2["crit_rate"] = clampf(float(a.l2.get("crit_rate", 0.0)) + float(mods.get("crit", 0.0)),
					0.0, BattleTypes.CRIT_RATE_CAP)
				a.l2["dodge_rate"] = clampf(float(a.l2.get("dodge_rate", 0.0)) + float(mods.get("dodge", 0.0)),
					0.0, BattleTypes.DODGE_CAP)
				a.l2["hit_rate"] = clampf(float(a.l2.get("hit_rate", 0.0)) + float(mods.get("hit", 0.0)),
					BattleTypes.HIT_MIN, BattleTypes.HIT_MAX)
				a.l2["inner_regen"] = float(a.l2.get("inner_regen", 0.0)) * (1.0 + float(mods.get("innerRegen", 0.0)))
				a.l2["lifesteal"] = float(a.l2.get("lifesteal", 0.0)) + float(mods.get("lifesteal", 0.0))
				a.l2["damage_bonus"] = float(a.l2.get("damage_bonus", 0.0)) + float(mods.get("damageDealt", 0.0))
				a.l2["damage_taken"] = float(a.l2.get("damage_taken", 0.0)) + float(mods.get("damageTaken", 0.0))
				var hp_bonus := float(mods.get("hpMax", 0.0))
				if hp_bonus != 0.0:
					var old_max := float(a.l2.get("hp_max", 0.0))
					a.l2["hp_max"] = old_max * (1.0 + hp_bonus)
					a.hp = minf(a.hp + old_max * hp_bonus, float(a.l2["hp_max"]))
				if bool(formation_special.get("immuneFirstControl", false)):
					a.set_flag("immuneFirstControl", true)

	func _emit_battle_start_hints(_setup: BattleSetup) -> void:
		if formation_result == "ok":
			emit_hint("formation_ok", {
				"formation_name": str(data.formation(_setup.formation_id).get("name", "")),
				"bonus_text": FormationResolver.describe(formation_effective),
			})
		elif formation_result == "partial":
			emit_hint("formation_partial", {})
			emit_hint_log("formation_partial_log", {
				"formation_name": str(data.formation(_setup.formation_id).get("name", "")),
				"requirement": _requirement_text(_setup.formation_id),
			})
		else:
			emit_hint("formation_fail", {})
			emit_hint_log("formation_fail_log", {
				"formation_name": str(data.formation(_setup.formation_id).get("name", "")),
				"requirement": _requirement_text(_setup.formation_id),
			})

	func _requirement_text(formation_id: String) -> String:
		var f := data.formation(formation_id)
		var req: Dictionary = f.get("requirement", {})
		match str(req.get("kind", "any")):
			"any":
				return "任意站位"
			"minMembers":
				return "至少 %d 人" % int(req.get("count", 0))
			"frontFull":
				return "前排 3 格满员"
			"rowFull":
				return "%s排 3 格满员" % _row_name(str(req.get("row", "front")))
			"corners":
				return "占据四角"
			"allThreeRows":
				return "前中后各一人"
			"singleColumn":
				return "单列 %d 人" % int(req.get("count", 0))
			"frontOneBackThree":
				return "前排 1 人 + 后排 3 人"
		return str(req.get("kind", "?"))

	func _row_name(row: String) -> String:
		match row:
			"front":
				return "前"
			"mid":
				return "中"
			"back":
				return "后"
		return row

	func _decide_first_side() -> int:
		var ally_best := _best_initiative(BattleTypes.Side.ALLY)
		var enemy_best := _best_initiative(BattleTypes.Side.ENEMY)
		# 同值时我方先手（防守方给玩家的默认便利）
		return BattleTypes.Side.ALLY if ally_best >= enemy_best else BattleTypes.Side.ENEMY

	func _best_initiative(side: int) -> float:
		var best := -1.0
		for a in all:
			if a.side != side or not a.is_alive():
				continue
			best = maxf(best, _initiative(a))
		return best

	func _initiative(a: BattleActor) -> float:
		var v := float(a.l2.get("speed", 0.0))
		for p in _active_passives(a):
			var kind := str(p.get("kind", ""))
			if kind == "firstStrike" or kind == "speed" or kind == "allRound":
				v *= 1.0 + float(p.get("value", 0.0))
		return v

	# ---------------------------------------------------------------- 行动顺序

	func _build_turn_order() -> void:
		turn_order = []
		for a in all:
			if a.is_alive():
				turn_order.append(a)
		var primary := first_side
		turn_order.sort_custom(func(x: BattleActor, y: BattleActor) -> bool:
			var sx := _initiative(x)
			var sy := _initiative(y)
			if not is_equal_approx(sx, sy):
				return sx > sy
			if x.side != y.side:
				return x.side == primary
			return x.slot < y.slot)
		turn_order = turn_order.duplicate()

	## 击退：把刚被击退的单位在**本轮剩余顺序**里后移 3 位（已行动过则忽略）
	func _apply_knockback_shift(current_index: int) -> int:
		var actor := turn_order[current_index]
		if actor == null or not actor.has_status("knockback"):
			return current_index
		if _acted_this_round.has(actor.id):
			return current_index
		var target := mini(turn_order.size() - 1, current_index + 3)
		if target <= current_index:
			return current_index
		var moved := turn_order[current_index]
		turn_order.remove_at(current_index)
		turn_order.insert(target - 1, moved)
		return current_index

	# ---------------------------------------------------------------- 回合

	func _take_turn(actor: BattleActor, round_no: int) -> void:
		_acted_this_round[actor.id] = true
		_advance(MS_TURN)
		emit({
			"type": "turn_start", "actor_id": actor.id, "actor_name": actor.display_name,
			"slot": actor.slot, "side": actor.side, "round": round_no,
		})

		# 眩晕 → 跳过
		if not StatusRuntime.can_act(actor, data):
			emit({"type": "hint", "hint_key": "status_stun_toast",
				"vars": {"target_name": actor.display_name}})
			return

		var foes := _living(BattleTypes.Side.ENEMY if actor.side == BattleTypes.Side.ALLY
			else BattleTypes.Side.ALLY)
		if foes.is_empty():
			return

		var key := _chain_key(actor)
		var chain: Dictionary = combo_chains.get(key, {"chain_len": 0, "expected_start": 0})
		var can_cast := StatusRuntime.can_cast(actor, data)
		var preference := actor.ai_preference if actor.ai_preference != "" else "combo"
		var choice: Dictionary = BattleAi.basic_attack(actor, data)
		if can_cast:
			choice = BattleAi.choose_skill(actor, foes, preference, data,
				int(chain.get("expected_start", 0)), rng)
			# 内力不足兜底：AI 已过滤，这里再做一次防御性检查并产出 inner_low
			if not bool(choice.get("is_basic", false)):
				var cost := float(choice.get("cost", 0.0))
				if actor.inner < cost:
					emit({
						"type": "inner_low", "actor_id": actor.id,
						"skill_id": str(choice.get("skill_id", "")),
						"need": cost, "have": actor.inner,
						"hint_key": "inner_low",
					})
					emit_hint("inner_low_toast", {
						"need": int(cost), "have": int(actor.inner)})
					choice = BattleAi.basic_attack(actor, data)
		else:
			choice = BattleAi.basic_attack(actor, data)

		var skill: Dictionary = choice.get("skill", {})
		_cast_skill(actor, foes, skill, choice, chain, key, round_no)

	## 释放一门功法（含连招、被动、范围结算、击退与状态）
	func _cast_skill(actor: BattleActor, foes: Array[BattleActor], skill: Dictionary,
			choice: Dictionary, chain: Dictionary, key: String, _round_no: int) -> void:
		var is_basic := bool(choice.get("is_basic", false))
		var cost := float(choice.get("cost", 0.0))
		if not is_basic:
			actor.spend_inner(cost)

		# ── 连招推进 ─────────────────────────────────────────────────
		var advanced := ComboResolver.advance(
			int(chain.get("chain_len", 0)), int(chain.get("expected_start", 0)), skill)
		combo_chains[key] = {
			"chain_len": int(advanced.get("chain_len", 0)),
			"expected_start": int(advanced.get("expected_start", 0)),
		}
		var combo: Dictionary = advanced.get("combo", ComboResolver.no_combo())
		var combo_level := int(combo.get("level", 1))

		# 连招未成（有链但接不上）→ 产出 log
		if combo_level == 1 and int(chain.get("chain_len", 0)) > 0 and not is_basic:
			emit_hint_log("combo_fail", {
				"skill_name": str(skill.get("name", "")),
				"start_mark": int(skill.get("start_mark", 0)),
			})
		if combo_level == 2:
			emit({"type": "combo", "actor_id": actor.id, "level": 2,
				"damage_bonus": BattleTypes.COMBO_2_BONUS, "hint_key": "combo_2"})
			emit_hint("combo_2_toast", {})
		elif combo_level == 3:
			emit({"type": "combo", "actor_id": actor.id, "level": 3,
				"damage_bonus": BattleTypes.COMBO_3_BONUS, "lifesteal_bonus": BattleTypes.COMBO_3_LIFESTEAL,
				"hint_key": "combo_3"})
			emit_hint("combo_3_toast", {})

		# ── skill_cast 事件（§6.2 的 8 个表现字段原样透传）───────────
		var visual := data.gongfa_visual(str(skill.get("id", "")))
		if visual.is_empty():
			visual = skill
		var realm_row := data.realm_row(int(_realm_of(actor, str(skill.get("id", "")))))
		_advance(int(MS_CAST * float(visual.get("timingScale", 1.0))))
		var cast_event := {
			"type": "skill_cast",
			"actor_id": actor.id,
			"actor_name": actor.display_name,
			"slot": actor.slot,
			"skill_id": str(skill.get("id", "")),
			"skill_name": str(skill.get("name", "普攻")),
			"is_basic": is_basic,
			"cost": cost,
			"combo_level": combo_level,
			"targets": str(skill.get("targets", "single")),
			"group": str(visual.get("group", "")),
			"motion": str(visual.get("motion", "")),
			"vfx": str(visual.get("vfx", "")),
			"timingScale": float(visual.get("timingScale", 1.0)),
			"hitStopMs": int(visual.get("hitStopMs", 0)),
			"shake": int(visual.get("shake", 0)),
			"sfx": str(visual.get("sfx", "")),
			"quality": str(visual.get("quality", skill.get("quality", "fan"))),
		}
		emit(cast_event)

		# ── 目标 → 逐目标结算 ────────────────────────────────────────
		var target_ids: Array[String] = []
		for t in BattleAi.choose_target(actor, foes, str(skill.get("targets", "single")), rng):
			target_ids.append(t.id)
		cast_event["target_ids"] = target_ids

		var row_mods := _collect_mods(actor, skill)
		var targets := BattleAi.choose_target(actor, foes, str(skill.get("targets", "single")), rng)
		var gap := BattleFormula.cultivation_gap(actor, targets[0], skill) if not targets.is_empty() else 0.0
		var extra_attack := false
		var passives := _active_passives(actor)
		for p in passives:
			var kind := str(p.get("kind", ""))
			var value := float(p.get("value", 0.0))
			if kind == "extraAttack" and rng.chance(value):
				extra_attack = true
				emit_passive(actor, p)
			elif kind == "vsHighHp" and not targets.is_empty() and targets[0].hp_ratio() > 0.5:
				row_mods["damage_bonus"] = float(row_mods.get("damage_bonus", 0.0)) + value
				emit_passive(actor, p)
			elif kind == "trueStrike":
				row_mods["true_strike"] = 1.0
			elif kind == "stunChance":
				var sb: Dictionary = row_mods.get("status_bonus", {})
				sb["stun"] = float(sb.get("stun", 0.0)) + value
				row_mods["status_bonus"] = sb

		# 「追加一次」（狂风不息等）→ 整套攻击再走一遍
		var repeat := 0
		while repeat < (2 if extra_attack else 1):
			repeat += 1
			for i in targets.size():
				if not actor.is_alive():
					break
				var target := targets[i]
				if not target.is_alive():
					continue
				var ctx := {
					"combo_level": combo_level,
					"combo_bonus": float(combo.get("damage_bonus", 0.0)),
					"lifesteal_bonus": float(combo.get("lifesteal_bonus", 0.0)),
					"tag_bonus": float(row_mods.get("tag_damage_bonus", 0.0)),
					"talent_bonus": 0.0,
					"realm_bonus": float(row_mods.get("realm_bonus", 0.0)),
					"formation_bonus": _formation_damage_bonus(actor, target),
					"damage_taken_bonus": float(row_mods.get("damage_taken_bonus", 0.0)),
					"cultivation_gap": gap,
					"ignore_def": clampf(float(row_mods.get("ignore_def", 0.0)), 0.0, 1.0),
					"true_strike": bool(row_mods.get("true_strike", false)),
					"status_bonus": row_mods.get("status_bonus", {}),
					"aoe_index": i + 1,
					"crit_rate_cap": data.const_num("crit_rate_cap", BattleTypes.CRIT_RATE_CAP),
					"crit_damage_cap": data.const_num("crit_damage_cap", BattleTypes.CRIT_DAMAGE_CAP),
					"damage_bonus_cap": data.const_num("damage_bonus_cap", BattleTypes.DAMAGE_BONUS_CAP),
					"damage_reduction_cap": data.const_num("damage_reduction_cap", BattleTypes.DAMAGE_REDUCTION_CAP),
					"defense_constant": data.const_num("defense_constant", BattleTypes.DEFENSE_CONSTANT),
					"hit_min": data.const_num("hit_min", BattleTypes.HIT_MIN),
					"hit_max": data.const_num("hit_max", BattleTypes.HIT_MAX),
				}
				var r := BattleFormula.resolve_attack(actor, target, skill, realm_row, ctx, rng)
				_advance(int(MS_HIT + float(visual.get("hitStopMs", 0))))
				_absorb_events(r.get("events", []))
				if r.has("status_plan") and target.is_alive():
					_absorb_events(BattleFormula.apply_status_plan(
						r["status_plan"], target, data, formation_special, rng))
				if not target.is_alive():
					_emit_down(target)
				if _side_wiped():
					break

		# 极少数情况下能量消耗后仍需回写（普攻已被 inner_low 事件覆盖）
		if not is_basic and actor.inner < 0.0:
			actor.inner = 0.0

	## 由三点一线产生"是否额外一次"（狂风不息等）——已在 _cast_skill 内联处理

	# ---------------------------------------------------------------- 回合末

	func _round_end(round_no: int) -> void:
		for a in all:
			if not a.is_alive():
				continue
			var evs := StatusRuntime.tick(a, data)
			if not evs.is_empty():
				_advance(MS_STATUS)
				_absorb_events(evs)
				if not a.is_alive():
					_emit_down(a)
			a.regen_inner()
		emit({"type": "round_end", "round": round_no})
		_check_result(round_no)

	# ---------------------------------------------------------------- 胜负

	func _side_wiped() -> bool:
		return _living(BattleTypes.Side.ALLY).is_empty() or _living(BattleTypes.Side.ENEMY).is_empty()

	func _check_result(_round_no: int) -> void:
		if not _living(BattleTypes.Side.ALLY).is_empty() and not _living(BattleTypes.Side.ENEMY).is_empty():
			return

	func _living(side: int) -> Array[BattleActor]:
		var out: Array[BattleActor] = []
		for a in all:
			if a.side == side and a.is_alive():
				out.append(a)
		return out

	func _emit_down(actor: BattleActor) -> void:
		emit({"type": "unit_down", "actor_id": actor.id, "actor_name": actor.display_name,
			"slot": actor.slot, "side": actor.side, "hint_key": "unit_down",
			"vars": {"actor_name": actor.display_name}, "tier": "toast"})
		if actor.side == BattleTypes.Side.ALLY:
			if not _living(BattleTypes.Side.ALLY).is_empty():
				emit_hint("ally_down_warn", {"actor_name": actor.display_name})

	func _finalize(round_no: int) -> BattleResult:
		var alive_ally := _living(BattleTypes.Side.ALLY)
		var alive_enemy := _living(BattleTypes.Side.ENEMY)
		var outcome := BattleTypes.Outcome.DRAW
		if alive_enemy.is_empty() and not alive_ally.is_empty():
			outcome = BattleTypes.Outcome.ALLY_WIN
		elif alive_ally.is_empty() and not alive_enemy.is_empty():
			outcome = BattleTypes.Outcome.ENEMY_WIN
		else:
			# 双方皆灭 → 平局；仍有存活 → 回合上限未分胜负，久战判负
			outcome = BattleTypes.Outcome.DRAW if alive_ally.is_empty() \
				else BattleTypes.Outcome.ENEMY_WIN

		result.outcome = outcome
		result.rounds = round_no

		var total_damage := 0.0
		for a in allies:
			total_damage += a.dealt_damage
		# 先落 stats（事件计数需早于结算事件产出），再产出结算事件
		result.stats = {
			"total_damage": total_damage,
			"total_heal": _sum_heal(),
			"combos": _count_events("combo"),
			"crits": _count_event_flag("attack_hit", "crit", true),
			"misses": _count_events("attack_miss"),
			"turns": _count_events("turn_start"),
			"ally_survivors": alive_ally.size(),
			"enemy_survivors": alive_enemy.size(),
			"ttk_rounds": round_no,
			"casts": _count_events("skill_cast"),
			"statuses_applied": _count_events("status_applied"),
			"downs": _count_events("unit_down"),
			"seed": result.seed,
		}

		if outcome == BattleTypes.Outcome.ENEMY_WIN and not alive_ally.is_empty():
			emit_hint("round_limit_end", {})
		elif outcome == BattleTypes.Outcome.ALLY_WIN:
			emit_hint("victory", {})
			emit_hint_log("victory_log", {
				"rounds": round_no,
				"survivors": alive_ally.size(),
				"damage": int(round(total_damage)),
			})
		elif outcome == BattleTypes.Outcome.ENEMY_WIN:
			emit_hint("defeat", {})
			emit_hint_log("defeat_log", {
				"rounds": round_no,
				"survivors": alive_enemy.size(),
			})

		result.final_state = _final_state()

		_advance(MS_END)
		emit({
			"type": "battle_end",
			"outcome": outcome,
			"rounds": round_no,
			"stats": result.stats.duplicate(true),
			"event_count": result.events.size(),
		})
		return result

	func _sum_heal() -> float:
		var total := 0.0
		for a in all:
			total += a.healed
		return total

	func _final_state() -> Dictionary:
		var units: Array[Dictionary] = []
		for a in all:
			units.append({
				"id": a.id,
				"name": a.display_name,
				"side": a.side,
				"slot": a.slot,
				"alive": a.is_alive(),
				"hp": maxf(0.0, a.hp),
				"hp_max": float(a.l2.get("hp_max", 0.0)),
				"inner": maxf(0.0, a.inner),
				"inner_max": float(a.l2.get("inner_max", 0.0)),
				"statuses": a.status_snapshot(),
				"dealt_damage": a.dealt_damage,
				"taken_damage": a.taken_damage,
			})
		return {
			"outcome": result.outcome,
			"rounds": result.rounds,
			"units": units,
			"stats": result.stats.duplicate(true),
		}

	# ---------------------------------------------------------------- 修正收集

	## 收集本回合该单位的全部数值修正（词条 + 被动动态项 + 阵法特殊项）
	func _collect_mods(actor: BattleActor, skill: Dictionary) -> Dictionary:
		var mods: Dictionary = {}
		# 三层词条
		var tag_mods := _tag_mods(actor)
		for k in tag_mods:
			match k:
				"damageBonus":
					mods["tag_damage_bonus"] = float(mods.get("tag_damage_bonus", 0.0)) + float(tag_mods[k])
				"crit":
					actor.l2["crit_rate"] = clampf(float(actor.l2.get("crit_rate", 0.0)) + float(tag_mods[k]),
						0.0, BattleTypes.CRIT_RATE_CAP)
				"dodge":
					actor.l2["dodge_rate"] = clampf(float(actor.l2.get("dodge_rate", 0.0)) + float(tag_mods[k]),
						0.0, BattleTypes.DODGE_CAP)
				"lifesteal":
					mods["lifesteal"] = float(mods.get("lifesteal", 0.0)) + float(tag_mods[k])
				"ignoreDef":
					mods["ignore_def"] = float(mods.get("ignore_def", 0.0)) + float(tag_mods[k])
				"innerRegen":
					actor.l2["inner_regen"] = float(actor.l2.get("inner_regen", 0.0)) * (1.0 + float(tag_mods[k]))
				"defPct":
					actor.l2["def"] = float(actor.l2.get("def", 0.0)) * (1.0 + float(tag_mods[k]))
				"speed":
					actor.l2["speed"] = float(actor.l2.get("speed", 0.0)) * (1.0 + float(tag_mods[k]))
				_:
					pass
		# 被动中的"无视防御"类
		for p in _active_passives(actor):
			var kind := str(p.get("kind", ""))
			if kind == "ignoreDef":
				mods["ignore_def"] = float(mods.get("ignore_def", 0.0)) + float(p.get("value", 0.0))
			elif kind == "critDamage":
				actor.l2["crit_damage"] = minf(
					float(actor.l2.get("crit_damage", 1.5)) + float(p.get("value", 0.0)),
					BattleTypes.CRIT_DAMAGE_CAP)
			elif kind == "aoeDamage" and str(skill.get("targets", "single")) != "single":
				mods["tag_damage_bonus"] = float(mods.get("tag_damage_bonus", 0.0)) + float(p.get("value", 0.0))
			elif kind == "aoeLifesteal":
				mods["lifesteal"] = float(mods.get("lifesteal", 0.0)) + float(p.get("value", 0.0))
		for k in mods:
			if k == "lifesteal":
				actor.l2["lifesteal"] = float(actor.l2.get("lifesteal", 0.0)) + float(mods[k])
		return mods

	## 三层词条加成（数据驱动：查 tag_combo.json，逻辑层不含任何词条名/数值）
	func _tag_mods(actor: BattleActor) -> Dictionary:
		var out: Dictionary = {}
		var ids: Array = actor.skills
		for i in ids.size():
			for j in range(i + 1, ids.size()):
				var row: Dictionary = data.tag_for(str(ids[i]), str(ids[j]))
				if row.is_empty():
					continue
				for k in (row.get("mods", {}) as Dictionary):
					out[k] = float(out.get(k, 0.0)) + float(row["mods"][k])
		return out

	## 阵法对该次攻击的增伤（特殊效果：columnDamage / backRowDamage / comboPower）
	func _formation_damage_bonus(attacker: BattleActor, target: BattleActor) -> float:
		var bonus := 0.0
		if attacker.side != BattleTypes.Side.ALLY:
			return bonus
		if formation_special.has("columnDamage") \
				and BattleGrid.col_of(attacker.slot) == BattleGrid.col_of(target.slot):
			bonus += float(formation_special["columnDamage"])
		if formation_special.has("backRowDamage") and BattleGrid.row_of(attacker.slot) == "back":
			bonus += float(formation_special["backRowDamage"])
		return bonus

	## 该单位当前"已解锁被动"列表
	func _active_passives(actor: BattleActor) -> Array[Dictionary]:
		var out: Array[Dictionary] = []
		for skill_id in actor.skills:
			var row: Dictionary = data.gongfa(str(skill_id))
			if row.is_empty():
				continue
			var p: Dictionary = row.get("passive", {})
			if p.is_empty():
				continue
			if _realm_of(actor, str(skill_id)) >= int(p.get("realm", 99)):
				out.append(p)
		return out

	func _realm_of(actor: BattleActor, skill_id: String) -> int:
		if skill_id == "" or skill_id == BattleTypes.BASIC_ATTACK_ID:
			return 1
		return clampi(int(actor.realm_levels.get(skill_id, 1)), 1, 10)

	func _chain_key(actor: BattleActor) -> String:
		return "%d:%s" % [actor.side, BattleGrid.col_of(actor.slot)]

	# ---------------------------------------------------------------- 事件装配

	func emit(ev: Dictionary) -> void:
		result.events.append(_stamp(ev))

	func emit_hint(key: String, vars: Dictionary) -> void:
		var row: Dictionary = data.hint(key)
		emit({
			"type": "hint", "hint_key": key, "vars": vars,
			"tier": str(row.get("tier", "toast")),
			"text": str(row.get("text", "")),
		})

	func emit_hint_log(key: String, vars: Dictionary) -> void:
		var row: Dictionary = data.hint(key)
		emit({
			"type": "hint", "hint_key": key, "vars": vars,
			"tier": str(row.get("tier", "log")),
			"text": str(row.get("text", "")),
		})

	func emit_passive(actor: BattleActor, passive: Dictionary) -> void:
		emit({
			"type": "skill_passive", "actor_id": actor.id,
			"passive_name": str(passive.get("name", "")),
			"kind": str(passive.get("kind", "")),
			"hint_key": "passive_trigger",
			"vars": {"passive_name": str(passive.get("name", ""))},
		})
		emit_hint_log("passive_trigger_log", {
			"actor_name": actor.display_name,
			"passive_name": str(passive.get("name", "")),
		})

	func _absorb_events(events: Array) -> void:
		for ev in events:
			if typeof(ev) == TYPE_DICTIONARY:
				emit(ev)

	func _stamp(ev: Dictionary) -> Dictionary:
		var out := ev.duplicate(true)
		out["t"] = t_ms
		return out

	func _advance(ms: int) -> void:
		t_ms += maxi(0, ms)

	func _count_events(type_name: String) -> int:
		var n := 0
		for e in result.events:
			if str(e.get("type", "")) == type_name:
				n += 1
		return n

	func _count_event_flag(type_name: String, field: String, value: Variant) -> int:
		var n := 0
		for e in result.events:
			if str(e.get("type", "")) == type_name and e.get(field, null) == value:
				n += 1
		return n
