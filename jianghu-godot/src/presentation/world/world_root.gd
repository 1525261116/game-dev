extends Node2D
## 世界场景（占位）：大地图节点选择 → 进入小场景
## TODO(S2)：等距地图渲染、节点点选、奇遇触发、时间推进

@onready var _info: Label = $UI/Info


func _ready() -> void:
	_info.text = "世界地图（待实现）\n阶段 %d ｜ 声望 %d ｜ 上阵上限 %d 人 ｜ 编队系数 ×%.2f" % [
		GameState.stage, GameState.reputation, GameState.max_party_size(), GameState.party_scale()
	]
	# 自动存档：进入世界即存（GDD 2.13 触发点之一）
	SaveManager.save_game(1, true)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		SceneRouter.goto(SceneRouter.MAIN_MENU)
