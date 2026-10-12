extends Control
## 启动场景：加载数据 → 校验 → 进入主菜单
##
## 这是全工程的第一个场景，承担三件事：
##   ① 加载配置数据（DataRegistry）
##   ② 健康自检（数据表问题直接暴露，不静默通过）
##   ③ 转场到主菜单

const MIN_SPLASH_SECONDS: float = 0.6

@onready var _status: Label = $Layout/Status
@onready var _progress: ProgressBar = $Layout/Progress
@onready var _detail: Label = $Layout/Detail


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_style()
	_run()


func _style() -> void:
	var bg := $Background as ColorRect
	bg.color = Color("f4f1e8")


func _run() -> void:
	_status.text = "正在载入江湖……"
	_progress.value = 10.0
	await get_tree().process_frame

	# autoload 在 _ready 时已加载；这里只做健康检查（load_all 幂等，重复调用无副作用）
	DataRegistry.load_all()
	var report := DataRegistry.health_report()
	_progress.value = 60.0

	if not report["ok"]:
		_status.text = "数据校验未通过"
		_detail.text = "\n".join(PackedStringArray(report["issues"]))
		_detail.add_theme_color_override("font_color", Color("a62b1f"))
		push_error("[Boot] 数据校验失败，已中止启动")
		return

	_detail.text = "数据表 %d 张 / %d 行" % [report["tables"], report["rows"]]
	await get_tree().create_timer(MIN_SPLASH_SECONDS).timeout
	_progress.value = 100.0

	EventBus.game_bootstrapped.emit()
	print("[Boot] 启动完成，进入主菜单")
	SceneRouter.goto(SceneRouter.MAIN_MENU, 260)
