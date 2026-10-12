class_name FormationResolver
extends RefCounted
## 阵法站位校验与加成解析（纯逻辑）
##
## 规则（对齐 GDD 2.1-8) 与 05_combat/烟雨江湖战斗对齐.md）：
##   完全符合 → 100% 生效
##   部分符合 → 50% 生效（PARTIAL_DISCOUNT）
##   完全不符 → 0% 生效
##
## 本文件与 TypeScript 版 `src/core/battle/formation.ts` 逻辑等价，
## 两者的测试用例一一对应——这是「数据与逻辑引擎中立」的验证方式。

const PARTIAL_DISCOUNT: float = 0.5
const MAX_LEVEL: int = 5


## 判定站位是否满足要求
## req: {"kind": "...", "count": n, "row": "..."}
## placement: Array[9]，元素为成员 id 或 null/""
static func evaluate_requirement(req: Dictionary, placement: Array) -> String:
	if not BattleGrid.is_valid_placement(placement):
		return "fail"

	var kind := str(req.get("kind", "any"))
	var total := BattleGrid.count_occupied(placement)

	match kind:
		"any":
			return "ok"

		"minMembers":
			var need := int(req.get("count", 1))
			if total >= need:
				return "ok"
			return "partial" if total >= need - 1 else "fail"

		"frontFull":
			var n := BattleGrid.occupied_at(placement, BattleGrid.FRONT)
			if n == 3:
				return "ok"
			return "partial" if n == 2 else "fail"

		"rowFull":
			var row := str(req.get("row", "front"))
			var n2 := BattleGrid.occupied_at(placement, BattleGrid.ROWS.get(row, BattleGrid.FRONT))
			if n2 == 3:
				return "ok"
			return "partial" if n2 == 2 else "fail"

		"corners":
			var n3 := BattleGrid.occupied_at(placement, BattleGrid.CORNERS)
			if n3 >= 4:
				return "ok"
			return "partial" if n3 == 3 else "fail"

		"allThreeRows":
			var rows_hit := 0
			for key in ["front", "mid", "back"]:
				if BattleGrid.occupied_at(placement, BattleGrid.ROWS[key]) > 0:
					rows_hit += 1
			if rows_hit == 3:
				return "ok"
			return "partial" if rows_hit == 2 else "fail"

		"singleColumn":
			var need2 := int(req.get("count", 2))
			var best := 0
			for key in ["left", "center", "right"]:
				best = maxi(best, BattleGrid.occupied_at(placement, BattleGrid.COLS[key]))
			if best >= need2:
				return "ok"
			return "partial" if best >= need2 - 1 else "fail"

		"frontOneBackThree":
			var front := BattleGrid.occupied_at(placement, BattleGrid.FRONT)
			var back := BattleGrid.occupied_at(placement, BattleGrid.BACK)
			if front == 1 and back >= 3:
				return "ok"
			return "partial" if front <= 2 and back >= 3 else "fail"

	push_error("[FormationResolver] 未知的阵法要求：%s" % kind)
	return "fail"


## 计算最终加成（已按站位结果折扣）
static func resolve(formation: Dictionary, placement: Array, level: int = 1) -> Dictionary:
	var lv := clampi(level, 1, MAX_LEVEL)
	var result := evaluate_requirement(formation.get("requirement", {"kind": "any"}), placement)
	var bonuses: Array = formation.get("bonuses", [])
	var base: Dictionary = {}
	if bonuses.size() >= lv:
		base = bonuses[lv - 1]
	elif bonuses.size() > 0:
		base = bonuses[bonuses.size() - 1]

	var effective: Dictionary = {}
	if result == "ok":
		effective = base.duplicate(true)
	elif result == "partial":
		effective = _discount(base, PARTIAL_DISCOUNT)

	return {
		"formation_id": str(formation.get("id", "")),
		"level": lv,
		"result": result,
		"effective": effective,
	}


static func _discount(bonus: Dictionary, k: float) -> Dictionary:
	var out: Dictionary = {}
	if bonus.has("mods"):
		var mods: Dictionary = {}
		for key in (bonus["mods"] as Dictionary):
			mods[key] = float(bonus["mods"][key]) * k
		out["mods"] = mods
	if bonus.has("special"):
		var sp: Dictionary = {}
		for key in (bonus["special"] as Dictionary):
			var v: Variant = bonus["special"][key]
			sp[key] = v if typeof(v) == TYPE_BOOL else float(v) * k
		out["special"] = sp
	return out


## 把加成渲染成人话（UI 用）
static func describe(bonus: Dictionary) -> String:
	const LABEL := {
		"atk": "攻击", "def": "防御", "hpMax": "气血上限", "spd": "速度",
		"crit": "暴击率", "dodge": "闪避", "hit": "命中", "innerRegen": "内力回复",
		"damageTaken": "受到伤害", "damageDealt": "造成伤害", "lifesteal": "吸血",
	}
	var parts: PackedStringArray = []
	for key in (bonus.get("mods", {}) as Dictionary):
		var pct := roundf(float(bonus["mods"][key]) * 1000.0) / 10.0
		parts.append("%s %s%.1f%%" % [LABEL.get(key, key), "+" if pct >= 0.0 else "", pct])
	var sp: Dictionary = bonus.get("special", {})
	if sp.has("comboPower"):
		parts.append("连招威力 +%d%%" % roundi(float(sp["comboPower"]) * 100.0))
	if sp.has("reflect"):
		parts.append("受击反弹 %d%%" % roundi(float(sp["reflect"]) * 100.0))
	if sp.has("columnDamage"):
		parts.append("该列伤害 +%d%%" % roundi(float(sp["columnDamage"]) * 100.0))
	if sp.has("backRowDamage"):
		parts.append("后排输出 +%d%%" % roundi(float(sp["backRowDamage"]) * 100.0))
	if sp.has("frontRowTaken"):
		parts.append("前排承伤 %d%%" % roundi(float(sp["frontRowTaken"]) * 100.0))
	if sp.get("immuneFirstControl", false):
		parts.append("免疫首次控制")
	return "，".join(parts)
