class_name StatusRuntime
extends RefCounted
## 状态系统运行时（纯逻辑，22 种，对齐 GDD 2.1-9 / 3.1.9③）。
##
## 规则：
##   ① 同状态**不叠加**，取最高值；中毒（≤3 层）/ 流血（≤5 层）例外，按层数叠加
##   ② 每回合结束统一结算持续伤害与状态时长
##   ③ 中毒 / 灼烧按**最大气血**，流血按**当前气血**
##   ④ 属性类状态计入 L2 派生，**不得突破**既有上限（暴击 75% / 闪避 60% /
##      命中 5~95% / 暴伤 300%）
##   ⑤ 免疫标记：`ironWall` 免疫击退与破防；`immuneFirstControl`（守境阵 5 级）
##      免疫**首次**控制（用 BattleActor 的 flag 记录已消耗）
##   ⑥ `stun` 无法行动；`seal` 只能普攻；`root` 闪避归零；`knockback` 出手顺位后移 3
##
## 事件：本模块返回事件数组，由调用方合并进 BattleResult.events（不打印、不通知）。

## 属性类修正的字段名（与 BattleStats.derive 的 mods 入参对齐）
const MOD_KEYS: PackedStringArray = [
	"atk", "def", "hp_max", "spd", "crit", "dodge", "hit",
	"inner_regen", "damage_taken", "damage_dealt", "lifesteal", "speed",
]


# ---------------------------------------------------------------- 施加

## 施加状态，返回事件数组。
## 免疫 / 层数上限都会产出对应事件（供表现层提示），不会静默失败。
static func apply(actor: BattleActor, status_id: String, duration: int, stacks: int,
		data: CombatDataSource, formation: Dictionary = {}) -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	if not actor.is_alive() or status_id == "":
		return events
	var def := data.status(status_id)
	if def.is_empty():
		return events

	var is_control := str(def.get("kind", "")) == "control"

	# ① 免疫：ironWall 免疫击退与破防
	var blocked_by := str(def.get("blockedBy", ""))
	if blocked_by != "" and actor.has_status(blocked_by):
		events.append({
			"type": "hint", "hint_key": "status_ironwall",
			"vars": {"target_name": actor.display_name, "status_name": str(def.get("name", status_id))},
		})
		return events

	# ② 免疫首次控制（守境阵 5 级）：整个战斗只免一次
	if is_control and bool(formation.get("immuneFirstControl", false)) \
			and actor.get_flag("immuneFirstControl", false) \
			and not actor.get_flag("immuneFirstControl_used", false):
		actor.set_flag("immuneFirstControl_used", true)
		events.append({"type": "hint", "hint_key": "status_immune_control", "vars": {}})
		return events

	var max_stacks := maxi(1, int(def.get("maxStacks", 1)))
	var want := maxi(1, stacks)

	var existing := actor.status_entry(status_id)
	if not existing.is_empty():
		var cur_stacks := int(existing.get("stacks", 1))
		if max_stacks > 1:
			# 可叠层：层数 +1（按 want），不超上限；剩余回合取较大值
			var new_stacks := mini(max_stacks, cur_stacks + want)
			if new_stacks == cur_stacks:
				events.append({
					"type": "hint", "hint_key": "status_stack_cap",
					"vars": {"status_name": str(def.get("name", status_id)), "max_stacks": max_stacks},
				})
			existing["stacks"] = new_stacks
			existing["remaining"] = maxi(int(existing.get("remaining", 0)), duration)
		else:
			# 不可叠层：取最高值（时长刷新，层数保持 1）
			existing["remaining"] = maxi(int(existing.get("remaining", 0)), duration)
			existing["stacks"] = 1
		events.append(_applied_event(actor, status_id, def, int(existing.get("stacks", 1)),
			int(existing.get("remaining", 0))))
		return events

	actor.statuses.append({
		"id": status_id,
		"stacks": mini(max_stacks, want),
		"remaining": maxi(1, duration),
		"source": "",
	})
	events.append(_applied_event(actor, status_id, def, mini(max_stacks, want), maxi(1, duration)))
	return events


static func _applied_event(actor: BattleActor, status_id: String, def: Dictionary,
		stacks: int, remaining: int) -> Dictionary:
	return {
		"type": "status_applied",
		"target_id": actor.id,
		"target_name": actor.display_name,
		"status_id": status_id,
		"status_name": str(def.get("name", status_id)),
		"stacks": stacks,
		"duration": remaining,
		"hint_key": _float_key_for(status_id),
	}


## 状态 → 飘字提示 key（表现层查 hint_text.json 的三层体系）
static func _float_key_for(status_id: String) -> String:
	match status_id:
		"stun":
			return "status_stun"
		"seal":
			return "status_seal"
		"root":
			return "status_root"
		"knockback":
			return "status_knockback"
		"poison":
			return "status_poison"
		"bleed":
			return "status_bleed"
		"burn":
			return "status_burn"
		"shield":
			return "status_shield"
	return ""


# ---------------------------------------------------------------- 回合末结算

## 回合末统一结算：持续伤害 / 治疗 → 时长递减 → 到期移除。返回事件数组。
static func tick(actor: BattleActor, data: CombatDataSource) -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	if not actor.is_alive() or actor.statuses.is_empty():
		return events

	var survivors: Array[Dictionary] = []
	for entry in actor.statuses:
		var status_id := str(entry.get("id", ""))
		var def := data.status(status_id)
		if def.is_empty():
			continue
		var stacks := maxi(1, int(entry.get("stacks", 1)))
		var remaining := int(entry.get("remaining", 0))

		# ① 持续伤害 / 治疗
		var dot: Dictionary = def.get("dot", {})
		if not dot.is_empty():
			var percent := float(dot.get("percent", 0.0)) * float(stacks)
			var basis := str(dot.get("basis", "maxHp"))
			var base_value := float(actor.l2.get("hp_max", 0.0)) if basis == "maxHp" else actor.hp
			var amount := absf(base_value * percent)
			if percent < 0.0:
				var healed := actor.heal(amount)
				if healed > 0.0:
					events.append({
						"type": "status_tick", "target_id": actor.id, "status_id": status_id,
						"heal": healed, "damage": 0.0, "remaining": remaining,
						"hint_key": "status_regen", "vars": {"heal": int(round(healed))},
					})
			else:
				var actual := actor.take_damage(amount)
				events.append({
					"type": "status_tick", "target_id": actor.id, "status_id": status_id,
					"damage": actual, "heal": 0.0, "remaining": remaining,
					"hint_key": "status_dot_log",
					"vars": {
						"target_name": actor.display_name,
						"status_name": str(def.get("name", status_id)),
						"damage": int(round(actual)),
						"remaining": remaining,
					},
				})
				if not actor.is_alive():
					# 倒地：状态全部清空，由模拟器产出 unit_down
					actor.statuses.clear()
					return events

		# ② 时长递减
		entry["remaining"] = remaining - 1
		if int(entry["remaining"]) > 0:
			survivors.append(entry)
		else:
			events.append({
				"type": "status_expired", "target_id": actor.id, "status_id": status_id,
				"vars": {
					"target_name": actor.display_name,
					"status_name": str(def.get("name", status_id)),
				},
			})

	actor.statuses = survivors
	return events


# ---------------------------------------------------------------- 修正聚合

## 聚合所有状态对 L2 的修正。返回可直接喂给 BattleStats.derive 的 mods 字典。
## 「同状态取最高值」在写入时就已保证（不可叠层状态只会有一条）。
static func aggregate_mods(actor: BattleActor, data: CombatDataSource) -> Dictionary:
	var mods: Dictionary = {}
	if actor.statuses.is_empty():
		return mods

	# 先按 status_id 归并（可叠层状态按层数线性放大；不可叠层只有一条）
	var merged: Dictionary = {}
	for entry in actor.statuses:
		var status_id := str(entry.get("id", ""))
		var def := data.status(status_id)
		if def.is_empty():
			continue
		var stacks := maxi(1, int(entry.get("stacks", 1)))
		var raw: Dictionary = def.get("mods", {})
		for key in raw:
			var value := float(raw[key])
			if key == "dodge" and value <= -1.0:
				# 定身：闪避归零（按 -100% 处理，见 status.json）
				merged["dodge"] = -1.0
				continue
			# 只有可叠层状态（中毒 / 流血）带 mods 时才乘层数
			var scaled := value * float(stacks) if int(def.get("maxStacks", 1)) > 1 else value
			if not merged.has(key):
				merged[key] = scaled
			else:
				# 不可叠层：取"绝对值更大"的修正（等价于取最高值）
				var cur := float(merged[key])
				merged[key] = scaled if absf(scaled) > absf(cur) else cur

	# 映射到 BattleStats 的 mods 字段名
	for key in merged:
		match key:
			"spd":
				mods["speed_pct"] = float(mods.get("speed_pct", 0.0)) + float(merged[key])
			"damageTaken":
				mods["damage_taken"] = float(mods.get("damage_taken", 0.0)) + float(merged[key])
			"damageDealt":
				mods["damage_bonus"] = float(mods.get("damage_bonus", 0.0)) + float(merged[key])
			_:
				mods[key] = float(mods.get(key, 0.0)) + float(merged[key])
	return mods


## 把状态修正**应用**到一个 L2 字典上（返回新的 L2，不修改入参）。
## 属性类状态计入派生，并重新钳制上限（暴击 75% / 闪避 60% / 命中 5~95% / 暴伤 300%）。
static func apply_mods_to_l2(base: Dictionary, mods: Dictionary, data: CombatDataSource) -> Dictionary:
	var crit_cap := data.const_num("crit_rate_cap", BattleTypes.CRIT_RATE_CAP)
	var crit_dmg_cap := data.const_num("crit_damage_cap", BattleTypes.CRIT_DAMAGE_CAP)
	var dodge_cap := data.const_num("dodge_cap", BattleTypes.DODGE_CAP)
	var hit_min := data.const_num("hit_min", BattleTypes.HIT_MIN)
	var hit_max := data.const_num("hit_max", BattleTypes.HIT_MAX)

	var out := base.duplicate(true)
	out["atk"] = float(out.get("atk", 0.0)) * (1.0 + float(mods.get("atk", 0.0)))
	out["def"] = float(out.get("def", 0.0)) * (1.0 + float(mods.get("def", 0.0)))
	out["speed"] = float(out.get("speed", 0.0)) * (1.0 + float(mods.get("speed_pct", 0.0)))
	out["inner_regen"] = float(out.get("inner_regen", 0.0)) * (1.0 + float(mods.get("inner_regen", 0.0)))
	out["lifesteal"] = float(out.get("lifesteal", 0.0)) + float(mods.get("lifesteal", 0.0))
	out["damage_bonus"] = float(out.get("damage_bonus", 0.0)) + float(mods.get("damage_bonus", 0.0))
	out["damage_taken"] = float(out.get("damage_taken", 0.0)) + float(mods.get("damage_taken", 0.0))

	out["crit_rate"] = clampf(float(out.get("crit_rate", 0.0)) + float(mods.get("crit", 0.0)), 0.0, crit_cap)
	out["crit_damage"] = clampf(float(out.get("crit_damage", 0.0)) + float(mods.get("crit_dmg", 0.0)), 0.0, crit_dmg_cap)
	out["dodge_rate"] = clampf(float(out.get("dodge_rate", 0.0)) + float(mods.get("dodge", 0.0)), 0.0, dodge_cap)
	out["hit_rate"] = clampf(float(out.get("hit_rate", 0.0)) + float(mods.get("hit", 0.0)), hit_min, hit_max)
	# 气血上限修正按比例调整当前值由调用方负责（本函数只改上限字段）
	out["hp_max"] = float(out.get("hp_max", 0.0)) + float(mods.get("hp_max", 0.0))
	return out


# ---------------------------------------------------------------- 行动许可

## 能否行动（眩晕 → 否）
static func can_act(actor: BattleActor, data: CombatDataSource) -> bool:
	if not actor.is_alive():
		return false
	for entry in actor.statuses:
		var def := data.status(str(entry.get("id", "")))
		if str(entry.get("id", "")) == "stun" or str(def.get("special", "")) == "无法行动":
			return false
	return true


## 能否释放功法（封穴 → 只能普攻）
static func can_cast(actor: BattleActor, data: CombatDataSource) -> bool:
	if not actor.is_alive():
		return false
	for entry in actor.statuses:
		var status_id := str(entry.get("id", ""))
		if status_id == "seal":
			return false
		var def := data.status(status_id)
		if str(def.get("special", "")).contains("只能普攻"):
			return false
	return true


## 是否被击退（出手顺位后移 3 位）——供行动顺序排序使用
static func is_knocked_back(actor: BattleActor, data: CombatDataSource) -> bool:
	return actor.has_status("knockback")


## 定身：闪避归零（不参与同列连击由模拟器处理）
static func is_rooted(actor: BattleActor, data: CombatDataSource) -> bool:
	return actor.has_status("root")


# ---------------------------------------------------------------- 净化

## 净化所有可驱散状态，返回被移除的状态 id 数组（附带事件）。
static func cleanse(actor: BattleActor, data: CombatDataSource) -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	var survivors: Array[Dictionary] = []
	for entry in actor.statuses:
		var def := data.status(str(entry.get("id", "")))
		if bool(def.get("dispellable", false)):
			events.append({
				"type": "status_expired",
				"target_id": actor.id,
				"status_id": str(entry.get("id", "")),
				"reason": "cleanse",
				"vars": {
					"target_name": actor.display_name,
					"status_name": str(def.get("name", entry.get("id", ""))),
				},
			})
		else:
			survivors.append(entry)
	actor.statuses = survivors
	return events
