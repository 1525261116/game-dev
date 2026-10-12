extends Node
## 场景路由（Autoload）
##
## 统一管理场景切换与转场遮罩，避免各处直接调用 change_scene_to_file
## （那会失去转场、无法拦截、也无法记录导航栈）。
##
## 场景路径常量集中在此，禁止在业务代码里写死 "res://scenes/..."。

const BOOT: String = "res://scenes/boot/boot.tscn"
const MAIN_MENU: String = "res://scenes/main_menu/main_menu.tscn"
const WORLD: String = "res://scenes/world/world.tscn"
const BATTLE: String = "res://scenes/battle/battle.tscn"

var _current_path: String = ""
var _history: Array[String] = []
var _busy: bool = false
var _fade: ColorRect


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_fade_layer()


## 构建一个常驻的转场遮罩（挂在 autoload 上，跨场景不销毁）
func _build_fade_layer() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 128
	add_child(layer)

	_fade = ColorRect.new()
	_fade.color = Color(0.06, 0.06, 0.07, 0.0)
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(_fade)


func current_path() -> String:
	return _current_path


func history() -> Array[String]:
	return _history.duplicate()


## 切换场景（带淡入淡出）。repeat=true 表示允许切到当前场景（用于重开）
func goto(path: String, fade_ms: int = 220, repeat: bool = false) -> void:
	if _busy:
		push_warning("[SceneRouter] 正在切换中，忽略请求：%s" % path)
		return
	if not repeat and path == _current_path:
		return
	if not ResourceLoader.exists(path):
		push_error("[SceneRouter] 场景不存在：%s" % path)
		EventBus.toast_requested.emit("场景缺失：%s" % path, "error")
		return

	_busy = true
	EventBus.scene_will_change.emit(_current_path, path)

	await _fade_to(1.0, fade_ms)

	var err := get_tree().change_scene_to_file(path)
	if err != OK:
		push_error("[SceneRouter] 切换失败（错误码 %d）：%s" % [err, path])
		_busy = false
		await _fade_to(0.0, fade_ms)
		return

	if _current_path != "":
		_history.append(_current_path)
	_current_path = path
	EventBus.scene_changed.emit(path)

	await _fade_to(0.0, fade_ms)
	_busy = false


## 回到上一个场景（用于从战斗返回世界）
func back(fade_ms: int = 220) -> void:
	if _history.is_empty():
		await goto(MAIN_MENU, fade_ms)
		return
	var prev: String = _history.pop_back()
	await goto(prev, fade_ms, true)


func _fade_to(target_alpha: float, duration_ms: int) -> void:
	if _fade == null:
		return
	if duration_ms <= 0:
		_fade.color.a = target_alpha
		return
	var tween := create_tween()
	tween.tween_property(_fade, "color:a", target_alpha, duration_ms / 1000.0)
	await tween.finished
