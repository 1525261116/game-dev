class_name CombatDataSource
extends RefCounted
## 战斗数据的**抽象来源**（依赖倒置：core 定义接口，装配层提供实现）。
##
## 这是本任务「基于依赖的模式」的核心：
##   `src/core/**` 只认识本抽象类，**不认识 DataRegistry / GameState / EventBus**；
##   运行时由 `RegistryCombatDataSource`（data 层）注入真实表数据，
##   测试时由 `TableCombatDataSource`（core/data 层）从字典注入。
## 因此核心逻辑既能在正式游戏里跑，也能在 `--script` 无 autoload 模式下被测试。
##
## 约定：所有方法**永不返回 null**；查不到时返回空字典 / 空数组 / 缺省值，
##       由调用方决定缺省行为（通常是"该效果不生效"，而不是崩溃）。


## 功法战斗数据（gongfa.json 的一行）
func gongfa(_id: String) -> Dictionary:
	return {}


## 功法境界倍率表的全部行（gongfa_realm.json）
func gongfa_realms() -> Array[Dictionary]:
	return [] as Array[Dictionary]


## 功法表现数据（gongfa_visual.json 的一行，供 skill_cast 事件原样透传）
func gongfa_visual(_id: String) -> Dictionary:
	return {}


## 状态定义（status.json 的一行）
func status(_id: String) -> Dictionary:
	return {}


## 阵法定义（formations.json 的一行）
func formation(_id: String) -> Dictionary:
	return {}


## 敌方模板（enemy_template.json 的一行）
func enemy(_id: String) -> Dictionary:
	return {}


## 战斗常量（battle_constants.json 的行数组）
func constants() -> Dictionary:
	return {}


## 提示语（hint_text.json 的一行，按 key 查）
func hint(_key: String) -> Dictionary:
	return {}


## 三层词条（tag_combo.json 的某一行；默认按两层 id 查找）
func tag_for(_a_id: String, _b_id: String) -> Dictionary:
	return {}


# ---------------------------------------------------------------- 便捷读取
# 逻辑层统一通过这些帮助函数取值，保证「表里没有就用缺省值」的一致口径。

## 取战斗常数（数值型）
func const_num(key: String, fallback: float) -> float:
	var v: Variant = constants().get(key, null)
	if v == null:
		return fallback
	return float(v)


func const_int(key: String, fallback: int) -> int:
	return int(const_num(key, float(fallback)))


## 取功法境界倍率（index 从 1 起；越界钳制到最近的一档）
func realm_multiplier(index: int) -> float:
	var rows := gongfa_realms()
	if rows.is_empty():
		return 1.0
	var clamped := clampi(index, 1, rows.size())
	for r in rows:
		if int(r.get("index", 0)) == clamped:
			return float(r.get("multiplier", 1.0))
	# 表里 index 不连续时退化为"按行号取"
	return float(rows[clamped - 1].get("multiplier", 1.0))


## 取功法境界行（含 name / cultivation_gain）
func realm_row(index: int) -> Dictionary:
	var rows := gongfa_realms()
	if rows.is_empty():
		return {}
	var clamped := clampi(index, 1, rows.size())
	for r in rows:
		if int(r.get("index", 0)) == clamped:
			return r
	return rows[clamped - 1]
