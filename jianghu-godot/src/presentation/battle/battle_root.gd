extends Node2D
## 战斗场景（占位）
## TODO(S2)：九宫格布阵 → 战斗预结算 → 事件流回放 → HitStop/震屏 → 结算

@onready var _info: Label = $UI/Info


func _ready() -> void:
	_info.text = "战斗场景（待实现）\n上阵：%d 人 ｜ 阵法：%s" % [
		GameState.party.size(), GameState.formation_id if GameState.formation_id != "" else "（未装备）"
	]


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		SceneRouter.back()
