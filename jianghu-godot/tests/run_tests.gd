extends SceneTree
## 无依赖测试运行器（不需要 GUT / gdUnit）
##
## 运行方式：
##   Godot --headless --path . --script res://tests/run_tests.gd
##
## 退出码 = 失败用例数（0 = 全部通过），可直接接入 CI。
##
## 注意：实测 `--script` 模式下 autoload **仍会被实例化**（其 _ready 会执行），
##       但测试不应依赖它们 —— 只依赖纯逻辑类（class_name）与 FileAccess，
##       这样核心逻辑天然与引擎解耦，也能在 CI 中独立运行。

var _passed: int = 0
var _failed: int = 0
var _failures: Array[String] = []

const TABLES_DIR := "res://src/data/tables"


func _initialize() -> void:
	print("═══ 江湖从心 · 核心逻辑测试 ═══")
	var t0 := Time.get_ticks_msec()

	_run_battle_grid_tests()
	_run_formation_tests()
	_run_data_table_tests()
	_run_party_scale_tests()

	var dt := Time.get_ticks_msec() - t0
	print("───────────────────────────────")
	print("通过 %d ｜ 失败 %d ｜ 耗时 %d ms" % [_passed, _failed, dt])
	for f in _failures:
		print("  ✖ %s" % f)
	if _failed == 0:
		print("✅ 全部通过")
	else:
		print("❌ 存在失败用例")
	quit(_failed)


# ------------------------------------------------------------------ 断言

func _ok(condition: bool, name: String) -> void:
	if condition:
		_passed += 1
	else:
		_failed += 1
		_failures.append(name)
		print("  ✖ %s" % name)


func _eq(actual: Variant, expected: Variant, name: String) -> void:
	var same := false
	if typeof(actual) == TYPE_FLOAT or typeof(expected) == TYPE_FLOAT:
		same = absf(float(actual) - float(expected)) < 0.0001
	else:
		same = actual == expected
	if same:
		_passed += 1
	else:
		_failed += 1
		_failures.append("%s（期望 %s，实际 %s）" % [name, str(expected), str(actual)])
		print("  ✖ %s（期望 %s，实际 %s）" % [name, str(expected), str(actual)])


## 用 3×3 字符画构造站位：'#' 有人，'.' 空
func _grid(rows: PackedStringArray) -> Array:
	var flat: Array = []
	for r in rows:
		for i in r.length():
			flat.append(("u_%d_%d" % [rows.find(r), i]) if r[i] == "#" else null)
	assert(flat.size() == 9, "站位必须是 3×3")
	return flat


# ------------------------------------------------------------------ 测试

func _run_battle_grid_tests() -> void:
	print("\n[九宫格]")
	_eq(BattleGrid.row_of(0), "front", "slot0 属前排")
	_eq(BattleGrid.row_of(4), "mid", "slot4 属中排")
	_eq(BattleGrid.row_of(8), "back", "slot8 属后排")
	_eq(BattleGrid.col_of(0), "left", "slot0 属左列")
	_eq(BattleGrid.col_of(5), "right", "slot5 属右列")
	_eq(BattleGrid.same_column(1), [1, 4, 7] as Array[int], "中列 = 1,4,7")
	_eq(BattleGrid.count_occupied(_grid(["###", "...", "..."])), 3, "计数：前排 3 人")
	_eq(BattleGrid.is_valid_placement(_grid(["...", "...", "..."])), true, "3×3 站位合法")
	_eq(BattleGrid.is_valid_placement([1, 2, 3]), false, "非 9 格站位非法")

	# 等距投影：同列 row 越大 → y 越大、x 越小
	var o := Vector2(100, 100)
	var tile := Vector2(64, 32)
	var p_front := BattleGrid.to_screen(0, o, tile)
	var p_back := BattleGrid.to_screen(6, o, tile)
	_ok(p_back.y > p_front.y, "等距投影：后排 y 大于前排")
	_ok(p_back.x < p_front.x, "等距投影：后排 x 小于前排")
	_ok(BattleGrid.render_order(6) > BattleGrid.render_order(0), "渲染层级：后排先画")


func _run_formation_tests() -> void:
	print("\n[阵法]")
	var formations := _load_table("formations")
	_eq(formations.size(), 12, "阵法表共 12 个")

	var by_id := {}
	for f in formations:
		by_id[str(f["id"])] = f

	# 一字长蛇阵：前排满员 ok / 2 人 partial / 1 人 fail
	var changshe: Dictionary = by_id["FM_changshe"]
	_eq(FormationResolver.resolve(changshe, _grid(["###", "...", "..."]), 5)["result"], "ok", "长蛇阵前排满员→ok")
	_eq(FormationResolver.resolve(changshe, _grid(["##.", "...", "..."]), 5)["result"], "partial", "长蛇阵前排 2 人→partial")
	_eq(FormationResolver.resolve(changshe, _grid(["#..", "...", "..."]), 5)["result"], "fail", "长蛇阵前排 1 人→fail")

	# 折扣：partial 恰好是一半
	var full := FormationResolver.resolve(changshe, _grid(["###", "...", "..."]), 5)
	var part := FormationResolver.resolve(changshe, _grid(["##.", "...", "..."]), 5)
	_eq(full["effective"]["mods"]["def"], 0.24, "长蛇阵 5 级防御 +24%")
	_eq(part["effective"]["mods"]["def"], 0.12, "partial 折扣为 50%")
	_eq(FormationResolver.resolve(changshe, _grid(["#..", "...", "..."]), 5)["effective"], {}, "fail 时无任何加成")

	# 四象阵（四角）
	var sixiang: Dictionary = by_id["FM_sixiang"]
	_eq(FormationResolver.evaluate_requirement(sixiang["requirement"], _grid(["#.#", "...", "#.#"])), "ok", "四象阵四角→ok")
	_eq(FormationResolver.evaluate_requirement(sixiang["requirement"], _grid(["#.#", "...", "#.."])), "partial", "四象阵三角→partial")
	_eq(FormationResolver.evaluate_requirement(sixiang["requirement"], _grid(["#..", "#..", "..."])), "fail", "四象阵不足→fail")

	# 五行阵（满编 5）
	var wuxing: Dictionary = by_id["FM_wuxing"]
	_eq(FormationResolver.evaluate_requirement(wuxing["requirement"], _grid(["###", "##.", "..."])), "ok", "五行阵 5 人→ok")
	_eq(FormationResolver.evaluate_requirement(wuxing["requirement"], _grid(["###", "#..", "..."])), "partial", "五行阵 4 人→partial")
	_eq(FormationResolver.evaluate_requirement(wuxing["requirement"], _grid(["##.", "#..", "..."])), "fail", "五行阵 3 人→fail")

	# 锋矢阵（单列 3）与列连击协同
	var fengshi: Dictionary = by_id["FM_fengshi"]
	var r := FormationResolver.resolve(fengshi, _grid(["#..", "#..", "#.."]), 5)
	_eq(r["result"], "ok", "锋矢阵单列 3 人→ok")
	_eq(r["effective"]["special"]["columnDamage"], 0.45, "锋矢阵 5 级该列伤害 +45%")

	# 天罡北斗（前排 1 + 后排 3）
	var tiangang: Dictionary = by_id["FM_tiangang"]
	_eq(FormationResolver.evaluate_requirement(tiangang["requirement"], _grid(["#..", "...", "###"])), "ok", "天罡北斗→ok")
	_eq(FormationResolver.evaluate_requirement(tiangang["requirement"], _grid(["##.", "...", "###"])), "partial", "天罡北斗前置 2 人→partial")
	_eq(FormationResolver.evaluate_requirement(tiangang["requirement"], _grid(["##.", "...", "##."])), "fail", "天罡北斗后排不足→fail")

	# 任意站位型
	for id in ["FM_hunyuan", "FM_youyue", "FM_shoujing"]:
		_eq(FormationResolver.resolve(by_id[id], _grid(["#..", "...", "..."]), 1)["result"], "ok", "%s 任意站位→ok" % id)

	# 守境阵：仅 5 级解锁免疫首次控制
	var shoujing: Dictionary = by_id["FM_shoujing"]
	var p := _grid(["#..", "...", "..."])
	_eq(FormationResolver.resolve(shoujing, p, 4)["effective"]["special"].get("immuneFirstControl", false), false, "守境阵 4 级无免疫")
	_eq(FormationResolver.resolve(shoujing, p, 5)["effective"]["special"]["immuneFirstControl"], true, "守境阵 5 级有免疫")

	# 等级越界钳制
	_eq(FormationResolver.resolve(changshe, _grid(["###", "...", "..."]), 0)["level"], 1, "等级下界钳制到 1")
	_eq(FormationResolver.resolve(changshe, _grid(["###", "...", "..."]), 99)["level"], 5, "等级上界钳制到 5")

	# 文案渲染
	var text := FormationResolver.describe(full["effective"])
	_ok(text.contains("防御"), "加成文案含『防御』：%s" % text)

	# 品质分布
	var quality := {}
	for f in formations:
		var q := str(f["quality"])
		quality[q] = int(quality.get(q, 0)) + 1
	_eq(quality, {"fan": 3, "liang": 3, "shang": 3, "ji": 2, "jue": 1}, "阵法品质分布")


func _run_data_table_tests() -> void:
	print("\n[数据表]")
	var status := _load_table("status")
	_eq(status.size(), 22, "状态表共 22 种")

	var kinds := {"control": 0, "debuff": 0, "buff": 0}
	var stackable: Array[String] = []
	for s in status:
		kinds[str(s["kind"])] = int(kinds[str(s["kind"])]) + 1
		if int(s.get("maxStacks", 1)) > 1:
			stackable.append(str(s["id"]))
	_eq(kinds, {"control": 4, "debuff": 9, "buff": 9}, "状态分类 4/9/9")
	stackable.sort()
	_eq(stackable, ["bleed", "poison"] as Array[String], "仅中毒/流血可叠加")

	var gongfa := _load_table("gongfa_visual")
	_eq(gongfa.size(), 87, "功法表现映射共 87 门")
	var motions := {}
	var vfx := {}
	for g in gongfa:
		motions[str(g["motion"])] = true
		vfx[str(g["vfx"])] = true
	_ok(motions.size() <= 12, "动作原型种类 ≤12（实际 %d）→ 复用 %.1f×" % [motions.size(), 87.0 / float(motions.size())])
	_ok(vfx.size() <= 16, "特效模板种类 ≤16（实际 %d）" % vfx.size())

	var roster := _load_table("roster_tiers")
	_eq(roster.size(), 4, "上阵人数档位 4 档")

	var consts := _load_table("battle_constants")
	var cmap := {}
	for c in consts:
		cmap[str(c["id"])] = c["value"]
	_eq(cmap.get("max_rounds"), 30, "回合上限 30")
	_eq(cmap.get("dodge_cap"), 0.6, "闪避上限 0.6")
	_eq(cmap.get("defense_constant"), 150, "防御常数 150")


func _run_party_scale_tests() -> void:
	print("\n[编队系数]")
	_eq(_party_scale(3), 0.75, "3 人 → 0.75")
	_eq(_party_scale(4), 1.0, "4 人 → 1.00（基准）")
	_eq(_party_scale(5), 1.25, "5 人 → 1.25")
	_eq(_party_scale(6), 1.5, "6 人 → 1.50")

	# 上阵人数成长（与 GameState 规则一致，此处独立实现以便无 autoload 测试）
	_eq(_max_party_size(0, 0, false), 3, "初始上阵 3 人")
	_eq(_max_party_size(500, 0, false), 4, "声望 500 → 4 人")
	_eq(_max_party_size(5000, 3, false), 5, "门派 3 级 → 5 人")
	_eq(_max_party_size(5000, 3, true), 6, "门派战 → 6 人")


func _party_scale(members: int) -> float:
	return roundf(float(maxi(members, 1)) / 4.0 * 100.0) / 100.0


func _max_party_size(reputation: int, sect_level: int, is_sect_war: bool) -> int:
	if is_sect_war:
		return 6 if sect_level >= 3 else 4
	if sect_level >= 3:
		return 5
	if reputation >= 500:
		return 4
	return 3


# ------------------------------------------------------------------ 工具

func _load_table(name: String) -> Array:
	var path := "%s/%s.json" % [TABLES_DIR, name]
	if not FileAccess.file_exists(path):
		_failed += 1
		_failures.append("数据表缺失：%s" % path)
		print("  ✖ 数据表缺失：%s" % path)
		return []
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_ARRAY:
		_failed += 1
		_failures.append("数据表格式错误：%s" % path)
		return []
	return parsed
