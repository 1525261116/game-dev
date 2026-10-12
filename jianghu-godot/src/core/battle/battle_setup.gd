class_name BattleSetup
extends RefCounted
## 一场战斗的**输入契约**（纯逻辑）。
##
## 预结算模型的入口：`BattleSimulator.simulate(setup, data) -> BattleResult`。
## 本对象必须是**完全可序列化**的，且不含任何随机结果——
## `seed` 是唯一的随机来源，保证「同 seed + 同 setup = 逐事件完全一致」。

var seed: int = 0
var allies: Array[Dictionary] = []       ## 见下方成员结构
var enemies: Array[Dictionary] = []      ## 敌方模板 id 或内联模板
var ally_placement: Array = []           ## 长度 9，元素为成员 id 或 null
var enemy_placement: Array = []          ## 长度 9，元素为敌方成员 id 或 null
var formation_id: String = ""
var formation_level: int = 1
var ai_preference: String = "combo"      ## "combo" | "damage"
var party_scale: float = 0.0             ## 编队系数；<=0 时由 allies.size()/4 推导
var enemy_ai_preference: String = ""     ## 留空则用每个模板自身的 ai_preference
var max_rounds: int = 0                  ## 0 = 用数据表 / BattleTypes 缺省
var meta: Dictionary = {}                ## 场景标签、掉落占位等（逻辑层不解释）

## allies[i] = {
##   id, name, l1:{arm,agility,bone,inner}, equip:{},
##   skills:[...], realm_levels:{gongfa_id:1~10},
##   cultivation:{dao:..., neigong:...}, hp_max_override
## }
## enemies[i] = {template_id, id?, name?, realm_levels?, cultivation?}


func _init(seed_value: int = 0) -> void:
	seed = seed_value
	ally_placement = _empty_placement()
	enemy_placement = _empty_placement()


static func _empty_placement() -> Array:
	var a: Array = []
	a.resize(BattleGrid.SLOT_COUNT)
	a.fill(null)
	return a


## 编队系数：显式给了就用显式值，否则按 allies.size()/4 推导（GDD 3.1.9①）
func effective_party_scale() -> float:
	if party_scale > 0.0:
		return party_scale
	return roundf(float(maxi(allies.size(), 1)) / 4.0 * 100.0) / 100.0


## 上阵成员是否都有站位（缺站位时由模拟器自动补位）
func has_valid_placement() -> bool:
	return BattleGrid.is_valid_placement(ally_placement)


## 把未安置的成员依次填入空位（前排优先），返回补全后的站位（不改原对象）
func auto_placement() -> Array:
	var placement := ally_placement.duplicate()
	if not BattleGrid.is_valid_placement(placement):
		placement = _empty_placement()
	var used := {}
	for v in placement:
		if v != null and str(v) != "":
			used[str(v)] = true
	var slot := 0
	for member in allies:
		var mid := str(member.get("id", ""))
		if mid == "" or used.has(mid):
			continue
		while slot < BattleGrid.SLOT_COUNT and placement[slot] != null and str(placement[slot]) != "":
			slot += 1
		if slot >= BattleGrid.SLOT_COUNT:
			break
		placement[slot] = mid
		used[mid] = true
	return placement


## 敌方站位自动补位（同样前排优先）
func auto_enemy_placement() -> Array:
	var placement := enemy_placement.duplicate()
	if not BattleGrid.is_valid_placement(placement):
		placement = _empty_placement()
	var slot := 0
	for entry in enemies:
		# 敌方条目允许两种写法：{"template_id": "EN_xx"} 或 {"id": "EN_xx"}
		var tid := str(entry.get("template_id", entry.get("id", "")))
		if tid == "":
			continue
		while slot < BattleGrid.SLOT_COUNT and placement[slot] != null and str(placement[slot]) != "":
			slot += 1
		if slot >= BattleGrid.SLOT_COUNT:
			break
		placement[slot] = tid
		slot += 1
	return placement
