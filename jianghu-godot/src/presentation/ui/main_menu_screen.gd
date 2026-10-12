extends Control
## 主菜单

const MENU_ITEMS: Array[Dictionary] = [
	{"id": "new_game", "text": "新游戏", "hint": "穿越成逃犯，从青山镇开始"},
	{"id": "continue", "text": "继续游戏", "hint": "从最近一次自动存档继续"},
	{"id": "formation_lab", "text": "阵法演练（开发）", "hint": "校验 12 阵法与 22 状态的数值"},
	{"id": "quit", "text": "退出", "hint": ""},
]

@onready var _buttons: VBoxContainer = $Layout/Buttons
@onready var _hint: Label = $Layout/Hint


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	($Background as ColorRect).color = Color("f4f1e8")
	($Layout/Title as Label).text = "江湖从心"
	($Layout/Subtitle as Label).text = "武侠开放世界 · 单机 RPG · Godot %s" % Engine.get_version_info()["string"]
	for item in MENU_ITEMS:
		var b := Button.new()
		b.text = item["text"]
		b.custom_minimum_size = Vector2(280, 44)
		b.focus_mode = Control.FOCUS_ALL
		b.pressed.connect(_on_item_pressed.bind(item["id"]))
		b.mouse_entered.connect(func() -> void: _hint.text = item["hint"])
		_buttons.add_child(b)
	_buttons.get_child(0).grab_focus()


func _on_item_pressed(id: String) -> void:
	match id:
		"new_game":
			GameState.reset()
			EventBus.toast("新的江湖开始了", "info")
			SceneRouter.goto(SceneRouter.WORLD, 260)
		"continue":
			if SaveManager.has_save(1, true):
				SaveManager.load_game(1, true)
				SceneRouter.goto(SceneRouter.WORLD, 260)
			else:
				EventBus.toast("没有找到自动存档", "warn")
		"formation_lab":
			SceneRouter.goto("res://scenes/dev/formation_lab.tscn", 200)
		"quit":
			get_tree().quit()
