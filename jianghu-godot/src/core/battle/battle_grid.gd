class_name BattleGrid
extends RefCounted
## 九宫格站位（纯逻辑，无引擎依赖）
##
## 索引 0~8 对应站位编号 1~9：
##   前排 0,1,2 ｜ 中排 3,4,5 ｜ 后排 6,7,8
##   左列 0,3,6 ｜ 中列 1,4,7 ｜ 右列 2,5,8
##
## 用途：我方布阵、敌方模板编组、列连击、阵法站位校验、同列集火。

const SLOT_COUNT: int = 9

const FRONT: Array[int] = [0, 1, 2]
const MID: Array[int] = [3, 4, 5]
const BACK: Array[int] = [6, 7, 8]

const LEFT: Array[int] = [0, 3, 6]
const CENTER: Array[int] = [1, 4, 7]
const RIGHT: Array[int] = [2, 5, 8]

const CORNERS: Array[int] = [0, 2, 6, 8]

const ROWS: Dictionary = {"front": FRONT, "mid": MID, "back": BACK}
const COLS: Dictionary = {"left": LEFT, "center": CENTER, "right": RIGHT}


static func row_of(slot: int) -> String:
	if slot <= 2:
		return "front"
	elif slot <= 5:
		return "mid"
	return "back"


static func col_of(slot: int) -> String:
	@warning_ignore("integer_division")
	var c := slot % 3
	if c == 0:
		return "left"
	elif c == 1:
		return "center"
	return "right"


## 同列格位（列连击 / 锋矢阵 / 敌方同列集火）
static func same_column(slot: int) -> Array[int]:
	return COLS[col_of(slot)]


static func count_occupied(placement: Array) -> int:
	var n := 0
	for v in placement:
		if _occupied(v):
			n += 1
	return n


static func occupied_at(placement: Array, slots: Array) -> int:
	var n := 0
	for s in slots:
		var idx := int(s)
		if idx >= 0 and idx < placement.size() and _occupied(placement[idx]):
			n += 1
	return n


static func is_valid_placement(placement: Array) -> bool:
	return placement.size() == SLOT_COUNT


static func _occupied(v: Variant) -> bool:
	if v == null:
		return false
	if typeof(v) == TYPE_STRING:
		return (v as String) != ""
	return true


## 按等距投影把格位换算为屏幕坐标（供表现层使用）
## screenX = ox + (col - row) * tile_w / 2
## screenY = oy + (col + row) * tile_h / 2
static func to_screen(slot: int, origin: Vector2, tile: Vector2) -> Vector2:
	var r := ["front", "mid", "back"].find(row_of(slot))
	var c := ["left", "center", "right"].find(col_of(slot))
	return Vector2(
		origin.x + float(c - r) * tile.x * 0.5,
		origin.y + float(c + r) * tile.y * 0.5,
	)


## 渲染层级：后排先画、前排压住（按 col + row 升序）
static func render_order(slot: int) -> int:
	var r := ["front", "mid", "back"].find(row_of(slot))
	var c := ["left", "center", "right"].find(col_of(slot))
	return c + r
