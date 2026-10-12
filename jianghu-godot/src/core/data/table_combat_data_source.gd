class_name TableCombatDataSource
extends CombatDataSource
## 从**已加载的字典**构造战斗数据源（测试 / 离线模拟用，**不依赖 autoload**）。
##
## 用途：
##   ① `tests/run_tests.gd` 这类 `--script` 模式（autoload 全局名不可用）里，
##      直接读 JSON 构造数据源，验证 core 逻辑；
##   ② `tools/ci/sim_battle.*` 的批量数值模拟；
##   ③ 换表 / 变体实验：改字典即可，不用碰引擎。
##
## 依赖方向：本文件位于 `src/core/data/`，只依赖 `CombatDataSource` 抽象类
##          与 Godot 的 `FileAccess`（不是场景树），仍然满足「core 不碰 autoload」。

var _gongfa: Dictionary = {}          ## id -> row
var _gongfa_rows: Array[Dictionary] = []
var _realms: Array[Dictionary] = []
var _realm_by_index: Dictionary = {}
var _visual: Dictionary = {}
var _status: Dictionary = {}
var _formation: Dictionary = {}
var _enemy: Dictionary = {}
var _constants: Dictionary = {}
var _hints: Dictionary = {}           ## key -> row
var _tags: Dictionary = {}            ## "a|b" -> row（双向都注册）


## 从字典构造。tables 的键是表名：
##   gongfa / gongfa_realm / gongfa_visual / status / formations /
##   enemy_template / battle_constants / hint_text / tag_combo
static func from_tables(tables: Dictionary) -> TableCombatDataSource:
	var ds := TableCombatDataSource.new()
	ds._ingest(tables)
	return ds


## 从工程内的 `src/data/tables/*.json` 直接读盘构造（无需 autoload）
static func from_project(tables_dir: String = "res://src/data/tables") -> TableCombatDataSource:
	var names := [
		"gongfa", "gongfa_realm", "gongfa_visual", "status", "formations",
		"enemy_template", "battle_constants", "hint_text", "tag_combo",
	]
	var tables: Dictionary = {}
	for name in names:
		tables[name] = _read_json("%s/%s.json" % [tables_dir, name])
	return from_tables(tables)


static func _read_json(path: String) -> Array:
	if not FileAccess.file_exists(path):
		return []
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_ARRAY:
		return []
	return parsed


func _ingest(tables: Dictionary) -> void:
	_gongfa_rows = _as_rows(tables.get("gongfa", []))
	for row in _gongfa_rows:
		_gongfa[str(row.get("id", ""))] = row

	_realms = _as_rows(tables.get("gongfa_realm", []))
	for row in _realms:
		_realm_by_index[int(row.get("index", 0))] = row

	for row in _as_rows(tables.get("gongfa_visual", [])):
		_visual[str(row.get("id", ""))] = row
	for row in _as_rows(tables.get("status", [])):
		_status[str(row.get("id", ""))] = row
	for row in _as_rows(tables.get("formations", [])):
		_formation[str(row.get("id", ""))] = row
	for row in _as_rows(tables.get("enemy_template", [])):
		_enemy[str(row.get("id", ""))] = row
	for row in _as_rows(tables.get("hint_text", [])):
		_hints[str(row.get("key", row.get("id", "")))] = row

	_constants = BattleTypes.constants_from_rows(_as_rows(tables.get("battle_constants", [])))

	for row in _as_rows(tables.get("tag_combo", [])):
		var a := str(row.get("a", ""))
		var b := str(row.get("b", ""))
		if a == "" or b == "":
			continue
		_tags[_tag_key(a, b)] = row
		_tags[_tag_key(b, a)] = row


static func _tag_key(a: String, b: String) -> String:
	return "%s|%s" % [a, b]


static func _as_rows(raw: Variant) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if typeof(raw) != TYPE_ARRAY:
		return out
	for item in raw:
		if typeof(item) == TYPE_DICTIONARY:
			out.append(item)
	return out


# ---------------------------------------------------------------- 接口实现

func gongfa(id: String) -> Dictionary:
	return _gongfa.get(id, {})


func gongfa_realms() -> Array[Dictionary]:
	return _realms


func gongfa_visual(id: String) -> Dictionary:
	return _visual.get(id, {})


func status(id: String) -> Dictionary:
	return _status.get(id, {})


func formation(id: String) -> Dictionary:
	return _formation.get(id, {})


func enemy(id: String) -> Dictionary:
	return _enemy.get(id, {})


func constants() -> Dictionary:
	return _constants


func hint(key: String) -> Dictionary:
	return _hints.get(key, {})


func tag_for(a_id: String, b_id: String) -> Dictionary:
	return _tags.get(_tag_key(a_id, b_id), {})


# ---------------------------------------------------------------- 便捷查询（测试友好）

func all_gongfa() -> Array[Dictionary]:
	return _gongfa_rows


func all_tags() -> Array[Dictionary]:
	var seen := {}
	var out: Array[Dictionary] = []
	for key in _tags:
		var row: Dictionary = _tags[key]
		var id := str(row.get("id", ""))
		if seen.has(id):
			continue
		seen[id] = true
		out.append(row)
	return out
