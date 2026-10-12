extends Node
## 存档管理（Autoload）
##
## 三条硬要求（对齐 GDD 2.13 / 5.4）：
##   ① **引擎无关**：纯 JSON + 版本号 + 迁移函数，不用引擎序列化对象直接落盘
##   ② **可迁移**：覆盖前 3 个大版本，`_migrate()` 链式升级
##   ③ **原子写入**：先写临时文件再替换，避免半写损坏存档

const SAVE_VERSION: int = 1
var _save_dir: String = "user://saves"
const MANUAL_SLOTS: int = 3
const AUTO_SLOTS: int = 3


## user:// 在受限环境（沙箱/只读容器）可能创建失败。这里优雅降级并只警告一次，
## 避免刷屏，同时让游戏主体仍可运行（仅存档功能不可用）。
var _storage_available: bool = false


## 存档根目录的解析顺序（多级兜底，保证任何环境都能存档）：
##   1) 启动参数 `-- --saves-dir=<绝对路径>`（最高优先级，便于 CI / 沙箱 / 便携版）
##   2) 环境变量 JH_SAVE_DIR
##   3) user://saves            （各平台标准位置，发行版首选）
##   4) res://.local_saves      （仅开发期兜底：编辑器/源码运行时项目目录可写）
func _ready() -> void:
	_save_dir = _resolve_save_dir()
	var err := DirAccess.make_dir_recursive_absolute(_save_dir)
	_storage_available = (err == OK) and DirAccess.dir_exists_absolute(_save_dir)
	if _storage_available:
		print("[SaveManager] 存档目录：%s" % ProjectSettings.globalize_path(_save_dir))
	else:
		push_warning("[SaveManager] 存档目录不可写（%s），存档功能已禁用；游戏其余部分不受影响。" % _save_dir)


func _resolve_save_dir() -> String:
	# 1) 用户参数：-- --saves-dir=/path
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--saves-dir="):
			return arg.trim_prefix("--saves-dir=")
	# 2) 环境变量
	var env := OS.get_environment("JH_SAVE_DIR")
	if env != "":
		return env
	# 3) 标准位置
	var user_dir := "user://saves"
	if _dir_writable(user_dir):
		return user_dir
	# 4) 开发期兜底（导出后 res:// 只读，会自动跳过）
	var local_dir := "res://.local_saves"
	if _dir_writable(local_dir):
		push_warning("[SaveManager] user:// 不可用，回退到开发期目录：%s" % local_dir)
		return local_dir
	return user_dir


func _dir_writable(path: String) -> bool:
	if DirAccess.make_dir_recursive_absolute(path) != OK:
		return false
	if not DirAccess.dir_exists_absolute(path):
		return false
	# 真正写一个探针文件，避免「目录存在但只读」的误判
	var probe := path.path_join(".write_probe")
	var f := FileAccess.open(probe, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string("ok")
	f.close()
	DirAccess.remove_absolute(probe)
	return true


func storage_available() -> bool:
	return _storage_available


func save_dir() -> String:
	return _save_dir


func slot_path(slot: int, auto: bool = false) -> String:
	var prefix := "auto" if auto else "manual"
	return "%s/%s_%d.json" % [_save_dir, prefix, slot]


# ---------------------------------------------------------------- 存

func save_game(slot: int, auto: bool = false) -> bool:
	if not _storage_available:
		_report_fail(slot, "存储不可用（user:// 只读）")
		return false
	var payload := {
		"version": SAVE_VERSION,
		"saved_at_unix": Time.get_unix_time_from_system(),
		"saved_at_text": Time.get_datetime_string_from_system(),
		"game": GameState.to_dict(),
		"meta": {
			"stage": GameState.stage,
			"level": GameState.player_level,
			"reputation": GameState.reputation,
			"player_name": GameState.player_name,
		},
	}
	var json := JSON.stringify(payload, "\t")
	var final_path := slot_path(slot, auto)
	var tmp_path := final_path + ".tmp"

	# 原子写入：先写临时文件
	var f := FileAccess.open(tmp_path, FileAccess.WRITE)
	if f == null:
		_report_fail(slot, "无法写入临时文件：%s" % tmp_path)
		return false
	f.store_string(json)
	f.flush()
	f.close()

	# 再原子替换
	var dir := DirAccess.open(_save_dir)
	if dir == null or dir.rename(tmp_path.get_file(), final_path.get_file()) != OK:
		_report_fail(slot, "原子替换失败")
		return false

	EventBus.game_saved.emit(slot)
	print("[SaveManager] 已存档 slot=%d auto=%s" % [slot, auto])
	return true


# ---------------------------------------------------------------- 读

func load_game(slot: int, auto: bool = false) -> bool:
	if not _storage_available:
		_report_fail(slot, "存储不可用（user:// 只读）")
		return false
	var path := slot_path(slot, auto)
	if not FileAccess.file_exists(path):
		_report_fail(slot, "存档不存在：%s" % path)
		return false
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		_report_fail(slot, "存档损坏（JSON 解析失败）")
		return false

	var data: Dictionary = parsed
	data = _migrate(data)

	if not data.has("game"):
		_report_fail(slot, "存档缺少 game 字段")
		return false
	GameState.from_dict(data["game"])
	EventBus.game_loaded.emit(slot)
	print("[SaveManager] 已读档 slot=%d version=%s" % [slot, data.get("version", "?")])
	return true


func has_save(slot: int, auto: bool = false) -> bool:
	return FileAccess.file_exists(slot_path(slot, auto))


func list_saves() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for auto in [false, true]:
		var count := AUTO_SLOTS if auto else MANUAL_SLOTS
		for i in range(1, count + 1):
			var path := slot_path(i, auto)
			if not FileAccess.file_exists(path):
				continue
			var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
			var meta: Dictionary = {}
			var ver := 0
			if typeof(parsed) == TYPE_DICTIONARY:
				meta = parsed.get("meta", {})
				ver = int(parsed.get("version", 0))
			out.append({"slot": i, "auto": auto, "meta": meta, "version": ver, "path": path})
	return out


# ---------------------------------------------------------------- 迁移

## 链式迁移：把任意旧版本升到最新版本。新增版本时追加一个 if 分支并写测试。
func _migrate(data: Dictionary) -> Dictionary:
	var version := int(data.get("version", 0))
	if version == SAVE_VERSION:
		return data

	if version < 1:
		# v0（无版本号）→ v1：补齐缺失字段的默认值
		data["version"] = 1
		var game: Dictionary = data.get("game", {})
		game["morality"] = game.get("morality", 0)
		game["game_hours"] = game.get("game_hours", 0)
		game["formation_id"] = game.get("formation_id", "")
		data["game"] = game
		version = 1
		print("[SaveManager] 存档已从 v0 迁移到 v1")

	return data


func _report_fail(slot: int, reason: String) -> void:
	push_warning("[SaveManager] slot=%d %s" % [slot, reason])
	EventBus.save_failed.emit(slot, reason)
