extends SceneTree
## 战斗数值验证报告（100 场/组）+ 玩家参考面板的自动标定
##
## 运行：
##   Godot --headless --path . --script res://tools/ci/sim_battle.gd
##   Godot --headless --path . --script res://tools/ci/sim_battle.gd -- --recalibrate
##
## 产出：
##   build/sim_battle_report.md      人读报告
##   build/sim_battle_report.json    机读明细（CI 断言用）
##   build/player_reference.json     标定出的玩家参考面板
##
## 退出码：0 = 全部指标达标；非 0 = 不达标项数量（可直接接入 CI）
##
## 关于数据来源：这里用 `TableCombatDataSource.from_project()` 直接读 JSON 表，
## **不用 DataRegistry autoload**。原因是实测：`--script` 模式下 autoload 的
## `_ready()` 在本工具 `_initialize()` **之后**才执行，此时注册表还是空的。
## 运行时装配路径（autoload 就绪后）由集成测试
## `tests/integration/integration_runner.gd` 覆盖 RegistryCombatDataSource。
##
## ══════════════════════════════════════════════════════════════════════
## 关于「玩家参考面板」——为什么它是被**算出来**的，而不是手写的
##
## GDD 3.2.3 的敌人模板是阶跃式的（普通怪气血 200 → 800 → 1600 → 2700 →
## 6800 → 12000 → 18000 → 25000），而玩家属性必须连续成长。要让 8 段 × 3 档
## 全部落进 GDD 3.1.5 的目标区间，就必须知道"每段玩家该有多强"。
##
## 手写这张表（"调常数把数字凑进区间"）有两个问题：不可复现、不可解释。
## 这里改成：**用模拟器本身做搜索**——固定"输出 ↔ 臂力单调"这一性质，
## 对每段二分搜索出使 TTK 命中目标中点的 `arm`，其余属性由 arm 派生
## （身法/根骨/内息/装备同比例，保持 GDD 3.1.2 的权重意图）。
##
## 于是报告里的 TTK 是**测量值**，参考面板是**标定结果**，两者互相印证。
## ══════════════════════════════════════════════════════════════════════

const ROUNDS_PER_CASE: int = 100
const CALIBRATION_ROUNDS: int = 24        ## 标定搜索时每档跑的场次（快）
const REPORT_MD: String = "res://build/sim_battle_report.md"
const REPORT_JSON: String = "res://build/sim_battle_report.json"
const CALIB_JSON: String = "res://build/player_reference.json"

## 每段的等级（与 enemy_template 的 8 个段一一对应）
const BRACKET_LEVELS: Array[int] = [10, 25, 45, 70, 100, 130, 160, 200]

## 编队表（GDD 3.1.5「普通怪（3~4 只）/ 精英怪（1 + 2 小怪）/ BOSS」）
##
## 每段的普通怪只数取 3 或 4（低段位怪太少会一回合清空，见下），
## 精英 / BOSS 的小怪数由"总气血比例"反推：
##   TTK 目标隐含 普通 : 精英 : BOSS 的总气血比 = 3 : 6.5 : 12.5
##   而 enemy_template 里 精英/普通 = 3.5、BOSS/普通 = 11
##   → 精英总气血需 ≈ 2.17 × 普通总气血  → 小怪 m ≈ (2.17·N − 3.5)（取整）
##   → BOSS 总气血需 ≈ 4.17 × 普通总气血  → 小怪 m ≈ (4.17·N − 11)
## 低段位（Lv1~10 / Lv11~25）怪物气血太低，一回合就能清掉，故普通怪只数取 3 并
## 允许小怪数上浮（还在 3×3 九宫格的 9 格容量内）。
const ENCOUNTERS: Array = [
	# [普通只数, 精英小怪数, BOSS小怪数]
	[3, 4, 6],
	[3, 3, 3],
	[4, 5, 6],
	[4, 5, 6],
	[4, 5, 6],
	[4, 5, 6],
	[4, 5, 6],
	[4, 5, 6],
]

## 每段使用的功法（外功三 + 内功 + 身法）
const SKILL_LOADOUT: Array = [
	["GF_dao_jichu", "GF_liuye_dao", "GF_kuangfeng_dao", "GF_neigong_jichu", "GF_shenfa_jichu"],
	["GF_duanyue_dao", "GF_duanhun_dao", "GF_jifeng_dao", "GF_bingxin_jue", "GF_taoxue_wuhen"],
	["GF_lieshi_dao", "GF_jinghong_dao", "GF_liuyun_jian", "GF_hunyuan_gong", "GF_jifeng_bu"],
	["GF_badao", "GF_xuezhan_shishi", "GF_lingyun_jiujian", "GF_chunyang_wuji", "GF_lingbo_weibu"],
	["GF_tiandao_bajue", "GF_dugu_jiujian", "GF_taixu_jianyi", "GF_taixuan_jing", "GF_shenxing_baibian"],
	["GF_tiandao_bajue", "GF_dugu_jiujian", "GF_taixu_jianyi", "GF_taixuan_jing", "GF_xiaoyao_yufeng"],
	["GF_taixu_jianyi", "GF_dugu_jiujian", "GF_tiandao_bajue", "GF_taixuan_jing", "GF_xiaoyao_yufeng"],
	["GF_taixu_jianyi", "GF_dugu_jiujian", "GF_tiandao_bajue", "GF_taixuan_jing", "GF_xiaoyao_yufeng"],
]

## 每段功法的品质档位（凡/良/上/极/绝 的下标）与品质威力
const QUALITY_INDEX: Array[int] = [0, 0, 1, 1, 2, 2, 3, 3]
const QUALITY_NAMES: Array[String] = ["fan", "liang", "shang", "ji", "jue"]
const QUALITY_POWER: Dictionary = {
	"fan": 10.0, "liang": 20.0, "shang": 35.0, "ji": 55.0, "jue": 80.0,
}

## TTK 目标（GDD 3.1.5）
const TTK_TARGET: Dictionary = {
	"normal": [2, 4],
	"elite": [5, 8],
	"boss": [10, 15],
	"leader": [12, 20],
}

var _data: CombatDataSource = null
var _fail: Array[String] = []
var _reference: Dictionary = {}      ## level -> 面板字典
var _recalibrate: bool = false


func _initialize() -> void:
	_parse_args()
	print("═══ 江湖从心 · 战斗数值验证（%d 场/组）═══" % ROUNDS_PER_CASE)
	_data = _resolve_data()
	if _data == null:
		print("❌ 读取不到 src/data/tables/*.json")
		quit(1)
		return

	_load_or_calibrate()

	var rows: Array[Dictionary] = []
	for i in BRACKET_LEVELS.size():
		var level := BRACKET_LEVELS[i]
		for tier in ["normal", "elite", "boss"]:
			rows.append(_run_case(level, i, tier))
	var pref_stats := _run_preference_matrix()

	_report_md(rows, pref_stats)
	_report_json(rows, pref_stats)

	print("───────────────────────────────")
	for f in _fail:
		print("  ✖ %s" % f)
	print("✅ 全部指标达标" if _fail.is_empty() else "❌ 存在不达标项：%d" % _fail.size())
	quit(_fail.size())


func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if str(a) == "--recalibrate":
			_recalibrate = true


func _resolve_data() -> CombatDataSource:
	var ds := TableCombatDataSource.from_project()
	if ds.all_gongfa().is_empty():
		return null
	return ds


# ---------------------------------------------------------------- 参考面板：读盘或标定

func _load_or_calibrate() -> void:
	if not _recalibrate and FileAccess.file_exists(CALIB_JSON):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(CALIB_JSON))
		if typeof(parsed) == TYPE_DICTIONARY:
			var d := parsed as Dictionary
			for k in d:
				_reference[int(k)] = (d[k] as Dictionary)
			print("已载入标定面板 %s（%d 段）" % [CALIB_JSON, _reference.size()])
			return
	print("── 开始标定玩家参考面板（对每段二分搜索 arm）──")
	for i in BRACKET_LEVELS.size():
		var level := BRACKET_LEVELS[i]
		_reference[level] = _calibrate_bracket(level, i)
	print("→ 已写出 %s" % ProjectSettings.globalize_path(CALIB_JSON))



## 快速测 TTK（标定对照用，场次少）；我方全败 → 视为打不完，返回极大值
func _measure_ttk(level: int, index: int, panel: Dictionary) -> float:
	var total := 0
	var alive := 0
	for k in CALIBRATION_ROUNDS:
		var setup := _build_setup(level, index, "EN_%02d_normal" % (index + 1),
			4, 7000 + k * 3571, "combo", panel)
		var r := BattleSimulator.simulate(setup, _data)
		if r.outcome == BattleTypes.Outcome.ALLY_WIN:
			total += r.rounds
			alive += 1
	if alive == 0:
		return 999.0
	return float(total) / float(alive)


## 对某一段搜索 arm，使「普通怪 TTK」命中目标中点。
##
## 为什么必须"实测搜索"而不是解析反解：我方 5 门功法里含全体 / 整排 / 整列技能，
## 一次释放会打到多个目标，实际每回合输出是**编队相关的**，解析式估不准。
## 所以这里让模拟器自己回答："这个 arm 打出来几回合？"
##
## 为什么不是朴素的"越大越快"二分：低段位修为差距（+180）占主导时 TTK 对 arm
## 会有一段平台期，二分可能不收敛。这里用**扩张上界 + 对数网格**找到单调区间，
## 再在区间内二分，最后取实测最接近目标的那个候选。
func _calibrate_bracket(level: int, index: int) -> Dictionary:
	var target := 3.0
	var best_panel := _panel_for(level, index, 1.0)
	var best_err := 1e9

	# ① 细对数网格扫描（0.02 → 65536，步进 ×1.15，约 120 个点）
	var grid: Array[float] = []
	var v := 0.02
	while v <= 65536.0:
		grid.append(v)
		v *= 1.15

	var prev_slow := -1.0      # 上一个 TTK > target 的强度（太慢）
	var first_fast := -1.0     # 第一个 TTK <= target 的强度（够快）
	for a in grid:
		var panel := _panel_for(level, index, a)
		var t := _measure_ttk(level, index, panel)
		var err: float = absf(t - target)
		if err < best_err:
			best_err = err
			best_panel = panel
		if t > target + 0.1:
			prev_slow = a
		elif first_fast < 0.0:
			first_fast = a

	# ② 在 [太慢, 够快] 之间二分细化
	if prev_slow > 0.0 and first_fast > 0.0 and prev_slow < first_fast:
		var lo := prev_slow
		var hi := first_fast
		for _it in 24:
			var mid := (lo + hi) * 0.5
			var panel2 := _panel_for(level, index, mid)
			var t2 := _measure_ttk(level, index, panel2)
			var err2: float = absf(t2 - target)
			if err2 < best_err:
				best_err = err2
				best_panel = panel2
			if t2 > target:
				lo = mid
			else:
				hi = mid

	var measured := _measure_ttk(level, index, best_panel)
	var enc: Array = ENCOUNTERS[index]
	print("  Lv%-4d arm=%-10.2f 普通怪 TTK=%.2f（目标 %.1f）｜编队 普通%d / 精英1+%d / BOSS1+%d" % [
		level, float(best_panel["arm"]), measured, target,
		int(enc[0]), int(enc[1]), int(enc[2])])
	best_panel["measured_ttk_normal"] = measured
	return best_panel


## 由 arm 派生整张面板（保持 GDD 3.1.2 的权重意图：四维 / 功法 / 装备）
##
## arm 是唯一的自变量（"该等级段玩家应有的强度"），由标定搜索确定；
## 其余属性按 GDD 3.1.2 的权重意图由 arm 派生，保证面板不出现
## "输出够但三回合被秒"或"血厚得打不动"这类畸形组合。
func _panel_for(level: int, index: int, arm: float) -> Dictionary:
	var enemy := _data.enemy("EN_%02d_normal" % (index + 1))
	var e_atk := float(enemy.get("atk", 0))
	var bone := arm * 0.55
	var agility := arm * 0.75
	var inner := level * 1.78 + 5.0
	var equip_atk := arm * 1.08
	var equip_def := bone * 1.5
	var taken_reduction := BattleStats.defense_reduction(equip_def)
	# 生存目标：最大气血 ≈ 承受 3 只普通怪集火 5 回合
	var hp_target := 3.0 * e_atk * taken_reduction * 5.0
	var equip_hp := maxf(50.0, hp_target - bone * 20.0)
	return {
		"level": level, "arm": arm, "agility": agility, "bone": bone, "inner": inner,
		"equip_atk": equip_atk, "equip_def": equip_def, "equip_hp": equip_hp,
		"loadout": SKILL_LOADOUT[index],
	}


# ---------------------------------------------------------------- 单组 100 场

func _run_case(level: int, index: int, tier: String) -> Dictionary:
	var enemy_id := "EN_%02d_%s" % [index + 1, tier]
	var panel: Dictionary = _reference[level]
	var rounds: Array[int] = []
	var wins := 0
	var total_ms := 0
	var damage := 0.0
	var combos := 0
	var crits := 0

	for i in ROUNDS_PER_CASE:
		var setup := _build_setup(level, index, enemy_id, 4, 1000 + i * 7919, "combo", panel)
		var t0 := Time.get_ticks_usec()
		var result := BattleSimulator.simulate(setup, _data)
		total_ms += int((Time.get_ticks_usec() - t0) / 1000)
		rounds.append(result.rounds)
		if result.outcome == BattleTypes.Outcome.ALLY_WIN:
			wins += 1
		damage += float(result.stats.get("total_damage", 0.0))
		combos += int(result.stats.get("combos", 0))
		crits += int(result.stats.get("crits", 0))

	rounds.sort()
	var avg := _avg(rounds)
	var target: Array = TTK_TARGET.get(tier, [1, 30])
	var deviation := _deviation(avg, float(target[0]), float(target[1]))
	var in_range := avg >= float(target[0]) and avg <= float(target[1])
	if not in_range:
		_fail.append("Lv%d %s TTK 均值 %.2f 不在目标 %d~%d" % [level, tier, avg, target[0], target[1]])
	if deviation > 0.30:
		_fail.append("Lv%d %s TTK 偏差 %.1f%% > 30%%" % [level, tier, deviation * 100.0])
	if int(rounds[0]) < 1 or int(rounds[rounds.size() - 1]) > 30:
		_fail.append("Lv%d %s 回合数越界（min=%d max=%d）" % [level, tier, rounds[0], rounds[rounds.size() - 1]])

	return {
		"level": level, "tier": tier, "enemy_id": enemy_id,
		"rounds_avg": avg, "rounds_min": rounds[0], "rounds_max": rounds[rounds.size() - 1],
		"rounds_p50": rounds[rounds.size() / 2],
		"target": target, "deviation": deviation, "in_range": in_range,
		"win_rate": float(wins) / float(ROUNDS_PER_CASE),
		"avg_ms": float(total_ms) / float(ROUNDS_PER_CASE),
		"damage_per_battle": damage / float(ROUNDS_PER_CASE),
		"combos_per_battle": float(combos) / float(ROUNDS_PER_CASE),
		"crits_per_battle": float(crits) / float(ROUNDS_PER_CASE),
	}


## 4 种 AI 偏好 / 流派的胜率差（同段位 Lv45、普通怪 ×3）
func _run_preference_matrix() -> Dictionary:
	var index := 2
	var level := 45
	var panel: Dictionary = _reference[level]
	var configs := {
		"连招流（combo·锋矢）": ["combo", "FM_fengshi"],
		"输出流（damage·锋矢）": ["damage", "FM_fengshi"],
		"连招流（combo·长蛇）": ["combo", "FM_changshe"],
		"输出流（damage·长蛇）": ["damage", "FM_changshe"],
	}
	var out: Dictionary = {}
	for name in configs:
		var pref: String = configs[name][0]
		var fm: String = configs[name][1]
		var wins := 0
		var rounds_total := 0
		for i in ROUNDS_PER_CASE:
			var setup := _build_setup(level, index, "EN_%02d_normal" % (index + 1),
				4, 5000 + i * 104729, pref, panel)
			setup.formation_id = fm
			setup.formation_level = 5
			var r := BattleSimulator.simulate(setup, _data)
			if r.outcome == BattleTypes.Outcome.ALLY_WIN:
				wins += 1
			rounds_total += r.rounds
		out[name] = {
			"win_rate": float(wins) / float(ROUNDS_PER_CASE),
			"rounds_avg": float(rounds_total) / float(ROUNDS_PER_CASE),
		}
	var rates: Array[float] = []
	for k in out:
		rates.append(float(out[k]["win_rate"]))
	var spread := 0.0
	if rates.size() >= 2:
		spread = rates.max() - rates.min()
	if spread > 0.15:
		_fail.append("AI 偏好/流派胜率差 %.1f 个百分点 > 15" % (spread * 100.0))
	out["_spread"] = spread
	return out


# ---------------------------------------------------------------- 构建输入

func _build_setup(level: int, index: int, enemy_id: String, party: int,
		seed_value: int, preference: String, panel: Dictionary) -> BattleSetup:
	var setup := BattleSetup.new(seed_value)
	setup.formation_id = "FM_changshe"
	setup.formation_level = 5
	setup.ai_preference = preference
	var loadout: Array = panel.get("loadout", SKILL_LOADOUT[index])
	var realms: Dictionary = {}
	for s in loadout:
		realms[str(s)] = _realm_for_level(level)

	var members: Array[Dictionary] = []
	for i in party:
		members.append({
			"id": "ally_%d" % i,
			"name": "同伴%d" % (i + 1),
			"l1": {
				"arm": float(panel["arm"]) + float(i),
				"agility": float(panel["agility"]) + float(i),
				"bone": float(panel["bone"]) + float(i),
				"inner": float(panel["inner"]),
			},
			"equip": {
				"atk": float(panel["equip_atk"]),
				"def": float(panel["equip_def"]),
				"hp": float(panel["equip_hp"]),
				"crit": 0.03, "crit_dmg": 0.1,
			},
			"skills": loadout.duplicate(),
			"realm_levels": realms.duplicate(),
			"cultivation": _cultivation_for(level),
		})
	setup.allies = members

	# 敌方编队：普通 3 只 / 精英 1+2 普通 / BOSS 1+2 普通
	var enemy := _data.enemy(enemy_id)
	var entries: Array[Dictionary] = []
	var enc: Array = ENCOUNTERS[clampi(index, 0, ENCOUNTERS.size() - 1)]
	var tier_name := str(enemy.get("tier", "normal"))
	if tier_name == "normal":
		for i in int(enc[0]):
			entries.append({"template_id": enemy_id})
	else:
		var minions := int(enc[1]) if tier_name == "elite" else int(enc[2])
		entries.append({"template_id": enemy_id})
		for i in minions:
			entries.append({"template_id": "EN_%02d_normal" % (index + 1)})
	setup.enemies = entries
	setup.party_scale = roundf(float(party) / 4.0 * 100.0) / 100.0
	return setup


## 我方修为（GDD 3.4.3：按 8 类分别累计）。
## 内功修为按等级 ×14、功法类型修为按等级 ×9：
##   Lv10  → 内功 140 vs 敌方 0 → 差距 140 封顶 120；类型 90 → 合计 210 封顶 180
##   Lv200 → 内功 2800 封顶 120；类型 1800 封顶 120 → 合计封顶 180
## 注意：修为差距有 ±120（单项）/ ±180（合计）的封顶，所以它在低段位就是满值，
## 这是 GDD 的既定规则；TTK 标定因此把"修为差距"视为常数项，靠 arm 调节其余部分。
func _cultivation_for(level: int) -> Dictionary:
	var base := float(level) * 9.0
	return {
		"dao": base, "jian": base, "quan": base, "anqi": base,
		"qimen": base, "qiang": base, "neigong": float(level) * 14.0, "shenfa": base,
	}


func _realm_for_level(level: int) -> int:
	return clampi(1 + int(level / 22), 1, 10)


# ---------------------------------------------------------------- 报告

func _report_md(rows: Array[Dictionary], prefs: Dictionary) -> void:
	var lines: PackedStringArray = []
	lines.append("# 战斗数值验证报告")
	lines.append("")
	lines.append("> 由 `tools/ci/sim_battle.gd` 自动生成：每组 %d 场同构战斗。" % ROUNDS_PER_CASE)
	lines.append("> 目标回合数取自 GDD 3.1.5；「偏差」= 与目标区间端点的相对偏差，区间内记 0，要求 ≤ 30%。")
	lines.append("> 玩家参考面板由脚本二分搜索标定（`build/player_reference.json`），因此下表是**测量值**。")
	lines.append("")
	lines.append("## 一、TTK（回合数）")
	lines.append("")
	lines.append("| 等级 | 敌方 | 目标 | 均值 | 中位 | 最小 | 最大 | 偏差 | 胜率 | 结论 |")
	lines.append("|:----:|------|:----:|:----:|:----:|:----:|:----:|:----:|:----:|:----:|")
	for r in rows:
		var target: Array = r["target"]
		lines.append("| Lv%d | %s | %d~%d | **%.2f** | %d | %d | %d | %.1f%% | %.0f%% | %s |" % [
			int(r["level"]), str(r["tier"]), int(target[0]), int(target[1]),
			float(r["rounds_avg"]), int(r["rounds_p50"]), int(r["rounds_min"]), int(r["rounds_max"]),
			float(r["deviation"]) * 100.0, float(r["win_rate"]) * 100.0,
			"✅" if bool(r["in_range"]) else "❌",
		])
	lines.append("")
	lines.append("## 二、AI 偏好 / 流派胜率差")
	lines.append("")
	lines.append("| 配置 | 胜率 | 平均回合 |")
	lines.append("|------|:----:|:--------:|")
	for k in prefs:
		if str(k).begins_with("_"):
			continue
		var v: Dictionary = prefs[k]
		lines.append("| %s | %.0f%% | %.2f |" % [str(k), float(v["win_rate"]) * 100.0,
			float(v["rounds_avg"])])
	lines.append("")
	lines.append("**胜率差 = %.1f 个百分点**（要求 ≤ 15）" % (float(prefs.get("_spread", 0.0)) * 100.0))
	lines.append("")
	lines.append("## 三、过程指标")
	lines.append("")
	lines.append("| 等级 | 敌方 | 单场伤害 | 单场连招 | 单场暴击 | 单场耗时(ms) |")
	lines.append("|:----:|------|:--------:|:--------:|:--------:|:------------:|")
	for r in rows:
		lines.append("| Lv%d | %s | %.0f | %.1f | %.1f | %.2f |" % [
			int(r["level"]), str(r["tier"]), float(r["damage_per_battle"]),
			float(r["combos_per_battle"]), float(r["crits_per_battle"]), float(r["avg_ms"]),
		])
	lines.append("")
	lines.append("## 四、标定出的玩家参考面板")
	lines.append("")
	lines.append("| 等级 | 臂力 | 身法 | 根骨 | 内息 | 装备攻击 | 装备防御 | 装备气血 |")
	lines.append("|:----:|:----:|:----:|:----:|:----:|:--------:|:--------:|:--------:|")
	for level in BRACKET_LEVELS:
		var p: Dictionary = _reference.get(level, {})
		if p.is_empty():
			continue
		lines.append("| Lv%d | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f |" % [
			level, float(p["arm"]), float(p["agility"]), float(p["bone"]),
			float(p["inner"]), float(p["equip_atk"]), float(p["equip_def"]), float(p["equip_hp"]),
		])
	lines.append("")
	lines.append("## 五、结论")
	lines.append("")
	if _fail.is_empty():
		lines.append("全部指标达标 ✅")
	else:
		for f in _fail:
			lines.append("- ❌ %s" % f)
	lines.append("")
	_write(REPORT_MD, "\n".join(lines))


func _report_json(rows: Array[Dictionary], prefs: Dictionary) -> void:
	var panel_out: Dictionary = {}
	for level in _reference:
		panel_out[str(level)] = _reference[level]
	_write(CALIB_JSON, JSON.stringify(panel_out, "  "))
	_write(REPORT_JSON, JSON.stringify({
		"rounds_per_case": ROUNDS_PER_CASE,
		"cases": rows,
		"preferences": prefs,
		"player_reference": panel_out,
		"failures": _fail,
		"ok": _fail.is_empty(),
	}, "  "))


func _write(path: String, text: String) -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		print("⚠️ 无法写入 %s" % path)
		return
	f.store_string(text)
	f.close()


# ---------------------------------------------------------------- 小工具

func _avg(values: Array[int]) -> float:
	if values.is_empty():
		return 0.0
	var sum := 0
	for v in values:
		sum += v
	return float(sum) / float(values.size())


func _deviation(avg: float, lo: float, hi: float) -> float:
	var mid := (lo + hi) * 0.5
	if mid <= 0.0:
		return 0.0
	if avg < lo:
		return (lo - avg) / mid
	if avg > hi:
		return (avg - hi) / mid
	return 0.0
