extends SceneTree
## 临时冒烟测试（开发期用，非交付物）：
## 验证 core 战斗模块能编译、能跑通一场战斗、事件流结构正确。

func _initialize() -> void:
	print("=== 战斗内核冒烟测试 ===")
	var data := TableCombatDataSource.from_project()
	print("gongfa=%d realms=%d tags=%d" % [
		data.all_gongfa().size(), data.gongfa_realms().size(), data.all_tags().size()])
	print("constants.max_rounds=%s" % data.constants().get("max_rounds", "MISSING"))

	var setup := BattleSetup.new(20261011)
	setup.formation_id = "FM_fengshi"
	setup.formation_level = 5
	setup.allies = [
		_member("player", "沈一凡", 60, 50, 55, 45, ["GF_badao", "GF_kuanyu", "GF_jingang_buhuai"]),
		_member("luqingya", "陆青崖", 45, 70, 40, 60, ["GF_liuyun_jian", "GF_qingfeng_jian", "GF_xixing_dafa"]),
		_member("xiejiu", "谢九", 70, 40, 60, 35, ["GF_luohan_quan", "GF_taiji_quan", "GF_neigong_jichu"]),
		_member("yuewuxia", "岳无瑕", 40, 60, 45, 70, ["GF_baoyu_lihua", "GF_liuye_feidao", "GF_shenfa_jichu"]),
	]
	setup.enemies = [
		{"template_id": "EN_04_normal", "cultivation": {"neigong": 300}},
		{"template_id": "EN_04_normal", "cultivation": {"neigong": 300}},
		{"template_id": "EN_04_elite", "cultivation": {"neigong": 400}},
	]
	var t0 := Time.get_ticks_msec()
	var result := BattleSimulator.simulate(setup, data)
	var dt := Time.get_ticks_msec() - t0
	print("结果：%s（耗时 %d ms）" % [result.summary(), dt])
	print("stats=%s" % str(result.stats))
	var counts := result.event_counts()
	print("事件类型：%s" % str(counts))
	# 事件契约检查
	var missing_t := 0
	var missing_type := 0
	var bad_cast := 0
	for e in result.events:
		if not e.has("t"):
			missing_t += 1
		if not e.has("type"):
			missing_type += 1
		if str(e.get("type", "")) == "skill_cast":
			for f in ["group", "motion", "vfx", "timingScale", "hitStopMs", "shake", "sfx", "quality"]:
				if not e.has(f):
					bad_cast += 1
					print("  ✖ skill_cast 缺字段 %s" % f)
	print("缺 t=%d 缺 type=%d skill_cast 缺字段=%d" % [missing_t, missing_type, bad_cast])

	# 确定性
	var result2 := BattleSimulator.simulate(setup, data)
	print("同 seed 事件逐条一致：%s" % str(_same_events(result.events, result2.events)))

	var setup3 := BattleSetup.new(999)
	setup3.allies = setup.allies
	setup3.enemies = setup.enemies
	setup3.formation_id = setup.formation_id
	setup3.formation_level = setup.formation_level
	var result3 := BattleSimulator.simulate(setup3, data)
	print("不同 seed 结果：%s / %s" % [result.summary(), result3.summary()])

	print("--- 前 12 条事件 ---")
	for i in mini(12, result.events.size()):
		var e := result.events[i]
		print("  t=%6d %-14s %s" % [int(e.get("t", 0)), str(e.get("type", "")),
			_e_brief(e)])
	quit(0)


func _e_brief(e: Dictionary) -> String:
	match str(e.get("type", "")):
		"skill_cast":
			return "%s 用 %s（%s/%s/%s）" % [str(e.get("actor_name", "")), str(e.get("skill_name", "")),
				str(e.get("group", "")), str(e.get("motion", "")), str(e.get("vfx", ""))]
		"attack_hit":
			return "%s → %s  %s%s" % [str(e.get("actor_name", "")), str(e.get("target_name", "")),
				str(e.get("damage", 0)), "（暴击）" if e.get("crit", false) else ""]
		"attack_miss":
			return "%s → %s  落空" % [str(e.get("actor_id", "")), str(e.get("target_id", ""))]
		"hint":
			return "%s: %s %s" % [str(e.get("hint_key", "")), str(e.get("tier", "")), str(e.get("vars", {}))]
		"combo":
			return "%s 连招 %s 级" % [str(e.get("actor_id", "")), str(e.get("level", 0))]
		"status_applied":
			return "%s ← %s x%s" % [str(e.get("target_name", "")), str(e.get("status_name", "")),
				str(e.get("stacks", 1))]
		"status_tick":
			return "%s %s 伤%s" % [str(e.get("target_id", "")), str(e.get("status_id", "")),
				str(e.get("damage", 0))]
		"unit_down":
			return "%s 倒地" % str(e.get("actor_name", ""))
		"battle_end":
			return "outcome=%s rounds=%s" % [str(e.get("outcome", "")), str(e.get("rounds", ""))]
	return ""


func _same_events(a: Array[Dictionary], b: Array[Dictionary]) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if JSON.stringify(a[i]) != JSON.stringify(b[i]):
			print("  首个不一致事件 #%d：\n    A=%s\n    B=%s" % [i, JSON.stringify(a[i]), JSON.stringify(b[i])])
			return false
	return true


func _member(id: String, name: String, arm: int, agi: int, bone: int, inner: int,
		skills: Array) -> Dictionary:
	var realms: Dictionary = {}
	for s in skills:
		realms[str(s)] = 6
	return {
		"id": id, "name": name,
		"l1": {"arm": arm, "agility": agi, "bone": bone, "inner": inner},
		"equip": {"atk": 30, "def": 20, "hp": 200, "crit": 0.05},
		"skills": skills,
		"realm_levels": realms,
		"cultivation": {"dao": 400, "jian": 400, "quan": 400, "anqi": 350,
			"qimen": 300, "qiang": 300, "neigong": 600, "shenfa": 450},
	}
