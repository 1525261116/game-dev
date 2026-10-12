extends Node
## 集成测试：数据注册表 + 存档往返 + 存档迁移
##
## 运行（**用场景方式启动**）：
##   Godot --headless --path . --scene res://tests/integration/integration_runner.tscn \
##         -- --saves-dir=/绝对路径/到临时目录
##
## ⚠️ 为什么不用 `--script`：`--script` 模式下 autoload 的全局标识符在**编译期**不可解析
##    （Identifier not found: DataRegistry），只能通过节点路径访问。
##    用场景方式启动则与正式游戏同一条装配路径，能直接使用 autoload 全局名 —— 这才是
##    真正意义上的「集成」测试。
##
## 退出码 = 失败用例数（0 = 全部通过），可直接接入 CI。

var _passed: int = 0
var _failed: int = 0
var _failures: Array[String] = []


func _ready() -> void:
	print("═══ 江湖从心 · 集成测试 ═══")

	_run_data_registry()
	_run_save_roundtrip()
	_run_save_migration()

	print("───────────────────────────────")
	print("通过 %d ｜ 失败 %d" % [_passed, _failed])
	for f in _failures:
		print("  ✖ %s" % f)
	print("✅ 全部通过" if _failed == 0 else "❌ 存在失败用例")
	get_tree().quit(_failed)


func _ok(cond: bool, name: String) -> void:
	if cond:
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


# ------------------------------------------------------------------ 数据

func _run_data_registry() -> void:
	print("\n[数据注册表]")
	var report := DataRegistry.health_report()
	_ok(report["ok"], "数据表校验无问题：%s" % str(report["issues"]))
	_eq(report["tables"], 5, "已加载 5 张表")
	_ok(int(report["rows"]) >= 100, "总行数 ≥100（实际 %d）" % report["rows"])

	# 有类型数组可直接遍历（回归测试：曾因无类型 Array 导致列表渲染失败）
	var formations: Array[Dictionary] = DataRegistry.rows("formations")
	_eq(formations.size(), 12, "阵法表 12 行")
	_ok(formations[0].has("requirement"), "阵法行含 requirement 字段")

	var missing := DataRegistry.row("formations", "FM_不存在")
	_eq(missing, {} as Dictionary, "查询不存在的 id 返回空字典（不崩溃）")


# ------------------------------------------------------------------ 存档

func _run_save_roundtrip() -> void:
	print("\n[存档往返]")
	_ok(SaveManager.storage_available(), "存档目录可用：%s" % SaveManager.save_dir())
	if not SaveManager.storage_available():
		_ok(false, "存档目录不可用，跳过往返测试")
		return

	# 构造一个有特征的状态
	GameState.reset()
	GameState.player_name = "沈一凡"
	GameState.player_level = 27
	GameState.realm_index = 3
	GameState.reputation = 620
	GameState.morality = -35
	GameState.stage = 3
	GameState.game_hours = 412
	GameState.hidden_talent = 44
	GameState.attributes = {"arm": 62, "agility": 48, "bone": 55, "inner": 40}
	GameState.free_points = 12
	GameState.cultivation = {"dao": 160, "jian": 55, "neigong": 220}
	GameState.party = ["player", "xiejiu", "luqingya", "yuewuxia"]
	GameState.companions_owned = ["xiejiu", "luqingya", "yuewuxia", "zhoutieshan"]
	GameState.formation_id = "FM_fengshi"
	GameState.set_formation_level("FM_fengshi", 4)
	GameState.sect_name = "从心门"
	GameState.sect_level = 3

	_ok(SaveManager.save_game(1, false), "存档写入成功")
	_ok(SaveManager.has_save(1, false), "存档文件存在")

	# 破坏内存状态，确认读档真的从磁盘恢复
	GameState.reset()
	_eq(GameState.player_level, 1, "重置后等级回到 1")

	_ok(SaveManager.load_game(1, false), "读档成功")
	_eq(GameState.player_name, "沈一凡", "读档恢复：化名")
	_eq(GameState.player_level, 27, "读档恢复：等级")
	_eq(GameState.realm_index, 3, "读档恢复：境界")
	_eq(GameState.reputation, 620, "读档恢复：声望")
	_eq(GameState.morality, -35, "读档恢复：正邪值（可为负）")
	_eq(GameState.game_hours, 412, "读档恢复：游戏内时间")
	_eq(GameState.hidden_talent, 44, "读档恢复：隐藏悟性")
	_eq(GameState.attributes["arm"], 62, "读档恢复：四维")
	_eq(GameState.free_points, 12, "读档恢复：自由点")
	_eq(GameState.cultivation["neigong"], 220, "读档恢复：修为（按类累计）")
	_eq(GameState.party.size(), 4, "读档恢复：上阵 4 人")
	_eq(GameState.formation_id, "FM_fengshi", "读档恢复：阵法")
	_eq(GameState.sect_level, 3, "读档恢复：门派等级")

	# 上阵人数与编队系数由状态推导
	_eq(GameState.max_party_size(false), 5, "门派 3 级 → 上阵上限 5")
	_eq(GameState.party_scale(), 1.0, "4 人编队系数 = 1.0")

	# 存档列表
	var saves := SaveManager.list_saves()
	_ok(saves.size() >= 1, "存档列表可枚举（%d 条）" % saves.size())


func _run_save_migration() -> void:
	print("\n[存档迁移]")
	if not SaveManager.storage_available():
		return

	# 手工写入一个「无版本号」的 v0 存档，验证迁移链
	var legacy := {
		"saved_at_unix": 0,
		"game": {
			"player_name": "旧档侠客",
			"player_level": 9,
			"reputation": 120,
			# 故意缺 morality / game_hours / formation_id
		},
	}
	var path := SaveManager.slot_path(2, false)
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(JSON.stringify(legacy))
	f.close()

	_ok(SaveManager.load_game(2, false), "旧版存档可读取")
	_eq(GameState.player_name, "旧档侠客", "迁移后保留原有字段")
	_eq(GameState.player_level, 9, "迁移后保留等级")
	_eq(GameState.morality, 0, "迁移补齐：正邪值默认 0")
	_eq(GameState.game_hours, 0, "迁移补齐：游戏时间默认 0")
	_eq(GameState.formation_id, "", "迁移补齐：阵法默认空")
