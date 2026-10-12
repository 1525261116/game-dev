class_name RegistryCombatDataSource
extends CombatDataSource
## 从 `DataRegistry` 取数的战斗数据源（**装配层**，运行时用）。
##
## 位置说明：本文件位于 `src/data/registry/`（data 层），因此**允许**引用
## `DataRegistry` autoload——它正是"把 autoload 注入进 core"的那一层。
## `src/core/**` 只认识 `CombatDataSource` 抽象类，绝不引用本文件。
##
## 缓存策略：表在启动时加载一次后不变，故第一次访问时建立 id 索引，
##           避免每次战斗都线性扫描（87 功法 × 每回合多次查询）。

var _registry: Node = null

var _gongfa_index: Dictionary = {}
var _visual_index: Dictionary = {}
var _status_index: Dictionary = {}
var _formation_index: Dictionary = {}
var _enemy_index: Dictionary = {}
var _realm_index: Dictionary = {}
var _hint_index: Dictionary = {}
var _tag_index: Dictionary = {}
var _constants: Dictionary = {}
var _realms: Array[Dictionary] = []
var _ready_index: bool = false


func _init(registry: Node = null) -> void:
	_registry = registry


## 工厂：显式传入 registry（推荐，便于测试替换）
static func create(registry: Node) -> CombatDataSource:
	return new(registry)


## 工厂：用默认的 DataRegistry autoload
static func from_autoload() -> CombatDataSource:
	var ds := new()
	ds._registry = _resolve_registry()
	return ds


static func _resolve_registry() -> Node:
	# 通过场景树取 autoload，避免在编译期依赖全局标识符
	# （`--script` 模式下全局名不可解析，但本文件只在运行时装配路径使用）
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null or tree.root == null:
		return null
	return tree.root.get_node_or_null("DataRegistry")


func _ensure() -> void:
	if _ready_index or _registry == null:
		return
	_ready_index = true
	_index("gongfa", _gongfa_index)
	_index("gongfa_visual", _visual_index)
	_index("status", _status_index)
	_index("formations", _formation_index)
	_index("enemy_template", _enemy_index)
	for row in _rows("gongfa_realm"):
		_realm_index[int(row.get("index", 0))] = row
		_realms.append(row)
	for row in _rows("hint_text"):
		_hint_index[str(row.get("key", row.get("id", "")))] = row
	for row in _rows("tag_combo"):
		var a := str(row.get("a", ""))
		var b := str(row.get("b", ""))
		if a == "" or b == "":
			continue
		_tag_index["%s|%s" % [a, b]] = row
		_tag_index["%s|%s" % [b, a]] = row
	_constants = BattleTypes.constants_from_rows(_rows("battle_constants"))


func _rows(table: String) -> Array[Dictionary]:
	if _registry == null:
		return [] as Array[Dictionary]
	return _registry.call("rows", table) as Array[Dictionary]


func _index(table: String, target: Dictionary) -> void:
	for row in _rows(table):
		target[str(row.get("id", ""))] = row


# ---------------------------------------------------------------- 接口实现

func gongfa(id: String) -> Dictionary:
	_ensure()
	return _gongfa_index.get(id, {})


func gongfa_realms() -> Array[Dictionary]:
	_ensure()
	return _realms


func gongfa_visual(id: String) -> Dictionary:
	_ensure()
	return _visual_index.get(id, {})


func status(id: String) -> Dictionary:
	_ensure()
	return _status_index.get(id, {})


func formation(id: String) -> Dictionary:
	_ensure()
	return _formation_index.get(id, {})


func enemy(id: String) -> Dictionary:
	_ensure()
	return _enemy_index.get(id, {})


func constants() -> Dictionary:
	_ensure()
	return _constants


func hint(key: String) -> Dictionary:
	_ensure()
	return _hint_index.get(key, {})


func tag_for(a_id: String, b_id: String) -> Dictionary:
	_ensure()
	return _tag_index.get("%s|%s" % [a_id, b_id], {})


## 数据表是否可用（装配层自检用；不可用时战斗应给出明确提示而不是静默空跑）
func is_ready() -> bool:
	_ensure()
	return not _gongfa_index.is_empty() and not _constants.is_empty()
