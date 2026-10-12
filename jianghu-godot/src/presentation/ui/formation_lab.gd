extends Control
## 阵法演练台（开发验证场景）
##
## 用途：在引擎内实时验证
##   ① 12 个阵法的站位要求是否正确
##   ② FormationResolver 的 ok / partial / fail 判定与折扣是否符合设计
##   ③ 数据表读取链路是否通畅
##
## 交互：点击左侧九宫格格位切换「有人 / 无人」，右侧实时刷新每个阵法的判定与生效加成。

const SAMPLE_LEVEL: int = 5   ## 预览用的阵法等级
const MAX_MEMBERS: int = 3    ## 演练用的上阵人数上限（GDD 阶段 1~2）

var _placement: Array = []
var _slot_buttons: Array[Button] = []
var _rows: Array[Dictionary] = []
var _list: VBoxContainer
var _summary: Label


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_placement.resize(BattleGrid.SLOT_COUNT)
	_placement.fill(null)
	_build_ui()
	_refresh()


func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = Color("f4f1e8")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 24)
	margin.add_theme_constant_override("margin_right", 24)
	margin.add_theme_constant_override("margin_top", 16)
	margin.add_theme_constant_override("margin_bottom", 16)
	add_child(margin)

	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 12)
	margin.add_child(root)

	var title := Label.new()
	title.text = "阵法演练台"
	title.add_theme_font_size_override("font_size", 28)
	root.add_child(title)

	_summary = Label.new()
	_summary.add_theme_font_size_override("font_size", 14)
	_summary.add_theme_color_override("font_color", Color("5c5a54"))
	root.add_child(_summary)

	var split := HBoxContainer.new()
	split.add_theme_constant_override("separation", 24)
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(split)

	# ---- 左：九宫格 ----
	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 8)
	split.add_child(left)

	left.add_child(_label("点击格位切换上阵（最多 %d 人）" % MAX_MEMBERS, 13, Color("5c5a54")))

	for slot in BattleGrid.SLOT_COUNT:
		var b := Button.new()
		b.custom_minimum_size = Vector2(96, 40)
		b.toggle_mode = true
		b.text = "%d · %s" % [slot + 1, BattleGrid.row_of(slot)]
		b.pressed.connect(_on_slot_toggled.bind(slot))
		_slot_buttons.append(b)
		# 3 列排布
		if slot % 3 == 0:
			var row_box := HBoxContainer.new()
			row_box.add_theme_constant_override("separation", 6)
			row_box.name = "Row%d" % (slot / 3)
			left.add_child(row_box)
		left.get_node("Row%d" % (slot / 3)).add_child(b)

	var reset := Button.new()
	reset.text = "清空"
	reset.pressed.connect(_on_reset)
	left.add_child(reset)

	var back := Button.new()
	back.text = "返回主菜单 (Esc)"
	back.pressed.connect(func() -> void: SceneRouter.goto(SceneRouter.MAIN_MENU))
	left.add_child(back)

	# ---- 右：阵法列表 ----
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_child(scroll)

	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_list)

	_rows = DataRegistry.rows("formations")


func _label(text: String, size: int = 15, color: Color = Color("1f1f1f")) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _on_slot_toggled(slot: int) -> void:
	var occupied := _placement[slot] != null
	if not occupied and _count_members() >= MAX_MEMBERS:
		EventBus.toast("上阵已满 %d 人" % MAX_MEMBERS, "warn")
		_slot_buttons[slot].set_pressed_no_signal(false)
		return
	_placement[slot] = null if occupied else "unit_%d" % slot
	_refresh()


func _on_reset() -> void:
	_placement.fill(null)
	for b in _slot_buttons:
		b.set_pressed_no_signal(false)
	_refresh()


func _count_members() -> int:
	var n := 0
	for v in _placement:
		if v != null:
			n += 1
	return n


func _refresh() -> void:
	for slot in BattleGrid.SLOT_COUNT:
		_slot_buttons[slot].set_pressed_no_signal(_placement[slot] != null)

	var members := _count_members()
	_summary.text = "上阵 %d 人 ｜ 编队系数 ×%.2f ｜ 数据表 %d 张 / %d 行 ｜ 阵法等级预览 Lv%d" % [
		members, _party_scale(members), DataRegistry.health_report()["tables"],
		DataRegistry.health_report()["rows"], SAMPLE_LEVEL,
	]

	for child in _list.get_children():
		child.queue_free()

	for f in _rows:
		var r := FormationResolver.resolve(f, _placement, SAMPLE_LEVEL)
		var row := PanelContainer.new()
		var style := StyleBoxFlat.new()
		style.bg_color = _result_color(str(r["result"]))
		style.set_corner_radius_all(4)
		style.content_margin_left = 10
		style.content_margin_right = 10
		style.content_margin_top = 6
		style.content_margin_bottom = 6
		row.add_theme_stylebox_override("panel", style)
		_list.add_child(row)

		var box := VBoxContainer.new()
		row.add_child(box)

		var head := Label.new()
		head.text = "%s（%s）— %s" % [str(f["name"]), str(f["quality"]), _result_text(str(r["result"]))]
		head.add_theme_font_size_override("font_size", 15)
		box.add_child(head)

		var desc := Label.new()
		var bonus_text := FormationResolver.describe(r["effective"])
		desc.text = "要求：%s ｜ 生效：%s" % [
			_requirement_text(f.get("requirement", {})),
			bonus_text if bonus_text != "" else "（无）",
		]
		desc.add_theme_font_size_override("font_size", 13)
		desc.add_theme_color_override("font_color", Color("4a4842"))
		desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		box.add_child(desc)


func _party_scale(members: int) -> float:
	return roundf(float(maxi(members, 1)) / 4.0 * 100.0) / 100.0


func _result_color(result: String) -> Color:
	match result:
		"ok":
			return Color("e8f0e4")
		"partial":
			return Color("f6f0dd")
		_:
			return Color("f2eae6")


func _result_text(result: String) -> String:
	match result:
		"ok":
			return "✅ 完全符合（全额）"
		"partial":
			return "🟡 部分符合（50%）"
		_:
			return "❌ 不符合（失效）"


func _requirement_text(req: Dictionary) -> String:
	match str(req.get("kind", "any")):
		"any":
			return "任意站位"
		"minMembers":
			return "至少 %d 人" % int(req.get("count", 0))
		"frontFull":
			return "前排 3 格满员"
		"rowFull":
			return "%s排 3 格满员" % _row_name(str(req.get("row", "front")))
		"corners":
			return "占据四角"
		"allThreeRows":
			return "前中后各一人"
		"singleColumn":
			return "单列 %d 人" % int(req.get("count", 0))
		"frontOneBackThree":
			return "前排 1 人 + 后排 3 人"
	return str(req.get("kind", "?"))


func _row_name(row: String) -> String:
	match row:
		"front":
			return "前"
		"mid":
			return "中"
		"back":
			return "后"
	return row


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		SceneRouter.goto(SceneRouter.MAIN_MENU)
