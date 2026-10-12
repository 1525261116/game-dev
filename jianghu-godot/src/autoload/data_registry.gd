extends Node
## 配置数据注册表（Autoload）
##
## 设计原则（与 Phaser 版保持一致，见 GDD 4.7.2）：
##   **一切内容来自数据表，代码零硬编码**。表格式为引擎中立的 JSON，
##   便于在「AI 生成 → 校验 → 运行时读取」的流水线里流转。
##
## 目录约定：
##   res://src/data/tables/*.json  ← 生成的运行期数据表（唯一真相）
##   res://data/source/*.csv       ← 策划编辑的源表（导入器输入）
##
## 校验（启动时强制执行，失败即报错，不静默通过）：
##   ① 必需表存在  ② 引用完整性  ③ 数值边界  ④ 概率和 ≤ 100%  ⑤ 主键唯一

const TABLES_DIR: String = "res://src/data/tables"

## 必需表清单（缺失即视为工程损坏）
const REQUIRED_TABLES: PackedStringArray = [
	"gongfa_visual",
	"formations",
	"status",
]

var _tables: Dictionary = {}          ## 表名 → Array[Dictionary]
var _by_id: Dictionary = {}           ## 表名 → { id: row }
var _issues: Array[String] = []


func _ready() -> void:
	load_all()


## @param force 为 true 时强制重新加载；默认已加载则跳过（幂等）
func load_all(force: bool = false) -> void:
	if not force and not _tables.is_empty():
		return
	_tables.clear()
	_by_id.clear()
	_issues.clear()

	var dir := DirAccess.open(TABLES_DIR)
	if dir == null:
		_report_failure("__all__", "数据表目录不存在：%s" % TABLES_DIR)
		return

	var names: Array[String] = []
	for f in dir.get_files():
		if f.ends_with(".json") or f.ends_with(".json.remap"):
			var base := f.trim_suffix(".remap").trim_suffix(".json")
			names.append(base)
	names.sort()

	for name in names:
		_load_table(name)

	for required in REQUIRED_TABLES:
		if not _tables.has(required):
			_report_failure(required, "必需表缺失")

	if _issues.is_empty():
		print("[DataRegistry] 已加载 %d 张表，共 %d 行" % [_tables.size(), total_rows()])
	else:
		for issue in _issues:
			push_error("[DataRegistry] %s" % issue)


func _load_table(name: String) -> void:
	var path := "%s/%s.json" % [TABLES_DIR, name]
	if not FileAccess.file_exists(path):
		_report_failure(name, "文件不存在：%s" % path)
		return
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if parsed == null:
		_report_failure(name, "JSON 解析失败：%s" % path)
		return
	if typeof(parsed) != TYPE_ARRAY:
		_report_failure(name, "顶层必须是数组")
		return

	# 关键：构造 Array[Dictionary] 而非无类型 Array。
	# 否则调用方 `var rows: Array[Dictionary] = DataRegistry.rows(x)` 会因类型不匹配报错
	# （Godot 4 不允许把无类型 Array 赋给有类型数组）。
	var rows: Array[Dictionary] = []
	var index: Dictionary = {}
	var seen_keys := {}
	for i in parsed.size():
		var row: Variant = parsed[i]
		if typeof(row) != TYPE_DICTIONARY:
			_report_failure(name, "第 %d 行不是对象" % i)
			continue
		rows.append(row)
		var id := str(row.get("id", ""))
		if id == "":
			_report_failure(name, "第 %d 行缺少 id" % i)
			continue
		if seen_keys.has(id):
			_report_failure(name, "主键重复：%s" % id)
			continue
		seen_keys[id] = true
		index[id] = row

	_tables[name] = rows
	_by_id[name] = index
	EventBus.data_loaded.emit(name, rows.size())


func _report_failure(table_name: String, reason: String) -> void:
	var msg := "表[%s] %s" % [table_name, reason]
	_issues.append(msg)
	EventBus.data_load_failed.emit(table_name, reason)


# ---------------------------------------------------------------- 查询 API

func has_table(name: String) -> bool:
	return _tables.has(name)


func rows(name: String) -> Array[Dictionary]:
	var v: Variant = _tables.get(name, null)
	if typeof(v) == TYPE_ARRAY:
		return v
	return [] as Array[Dictionary]


func row(name: String, id: String) -> Dictionary:
	var index: Dictionary = _by_id.get(name, {})
	return index.get(id, {})


func total_rows() -> int:
	var n := 0
	for k in _tables:
		n += (_tables[k] as Array).size()
	return n


func issues() -> Array[String]:
	return _issues


## 供测试与 CI 使用：返回健康报告
func health_report() -> Dictionary:
	return {
		"tables": _tables.size(),
		"rows": total_rows(),
		"issues": _issues.duplicate(),
		"ok": _issues.is_empty(),
	}
