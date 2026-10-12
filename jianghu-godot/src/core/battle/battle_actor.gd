class_name BattleActor
extends RefCounted
## 战斗单位（纯逻辑，无引擎依赖）。
##
## 职责：承载一个参战单位的全部可变状态（气血 / 内力 / 状态 / 站位），
##       并提供**不产生事件**的原子操作；事件由调用方（模拟器 / 公式层）产出。
## 约束：本类**不发事件、不打印、不感知表现层**，只做数值与状态的读写。

var id: String = ""
var display_name: String = ""
var side: int = BattleTypes.Side.ALLY       ## BattleTypes.Side
var slot: int = 0                            ## 0~8 九宫格索引
var l2: Dictionary = {}                      ## 派生属性（BattleStats.derive 的结果）
var hp: float = 0.0
var inner: float = 0.0
var skills: Array[String] = []               ## 装备的功法 id（外功一/二/三 + 内功 [+ 身法]）
var realm_levels: Dictionary = {}            ## gongfa_id -> 境界 index(1~10)
var cultivation: Dictionary = {}             ## 修为类别 -> 数值（GDD 3.4.3）
var statuses: Array[Dictionary] = []         ## [{id, stacks, remaining, source}]
var alive: bool = true
var enemy_template_id: String = ""           ## 敌方模板 id（我方为空）
var tier: String = ""                        ## normal / elite / boss / leader
var ai_preference: String = "combo"
var meta: Dictionary = {}                    ## 附加数据（皮肤 id 等，表现层只读）

## 本场战斗内的统计（用于 BattleResult.stats）
var dealt_damage: float = 0.0
var taken_damage: float = 0.0
var healed: float = 0.0
var inner_spent: float = 0.0

## 免疫标记的**已消耗**记录（守境阵的 immuneFirstControl 只免一次）
var _flags: Dictionary = {}


# ---------------------------------------------------------------- 基本查询

func is_alive() -> bool:
	return alive and hp > 0.0


func hp_ratio() -> float:
	var max_hp := float(l2.get("hp_max", 0.0))
	if max_hp <= 0.0:
		return 0.0
	return clampf(hp / max_hp, 0.0, 1.0)


func inner_ratio() -> float:
	var max_inner := float(l2.get("inner_max", 0.0))
	if max_inner <= 0.0:
		return 0.0
	return clampf(inner / max_inner, 0.0, 1.0)


## 坐标标识（事件流 / 日志用）
func label() -> String:
	return "%s#%d" % [display_name, slot + 1]


# ---------------------------------------------------------------- 数值操作

## 扣血：返回**实际**扣除量（不溢出，血量不为负）
func take_damage(amount: float) -> float:
	if amount <= 0.0 or not is_alive():
		return 0.0
	var actual := minf(amount, hp)
	hp -= actual
	taken_damage += actual
	if hp <= 0.0:
		hp = 0.0
		alive = false
	return actual


## 回血：返回**实际**回复量（不超过气血上限）
func heal(amount: float) -> float:
	if amount <= 0.0 or not is_alive():
		return 0.0
	var max_hp := float(l2.get("hp_max", hp))
	var actual := minf(amount, max_hp - hp)
	if actual <= 0.0:
		return 0.0
	hp += actual
	healed += actual
	return actual


## 消耗内力：不足返回 false 且**不扣除**
func spend_inner(cost: float) -> bool:
	if cost <= 0.0:
		return true
	if inner < cost:
		return false
	inner -= cost
	inner_spent += cost
	return true


## 回合末回复内力（不超上限）
func regen_inner() -> float:
	var gain := float(l2.get("inner_regen", 0.0))
	if gain <= 0.0 or not is_alive():
		return 0.0
	var max_inner := float(l2.get("inner_max", inner))
	var actual := minf(gain, max_inner - inner)
	if actual <= 0.0:
		return 0.0
	inner += actual
	return actual


## 直接改内力（状态效果 / 内功被动用）
func add_inner(amount: float) -> float:
	var max_inner := float(l2.get("inner_max", inner + amount))
	var before := inner
	inner = clampf(inner + amount, 0.0, max_inner)
	return inner - before


# ---------------------------------------------------------------- 状态查询

func has_status(status_id: String) -> bool:
	for s in statuses:
		if str(s.get("id", "")) == status_id:
			return true
	return false


func status_stacks(status_id: String) -> int:
	for s in statuses:
		if str(s.get("id", "")) == status_id:
			return int(s.get("stacks", 1))
	return 0


func status_entry(status_id: String) -> Dictionary:
	for s in statuses:
		if str(s.get("id", "")) == status_id:
			return s
	return {}


## 是否携带某个免疫标记（且尚未被消耗）
func has_immunity(mark: String) -> bool:
	if mark == "":
		return false
	if mark == "immuneFirstControl":
		return get_flag("immuneFirstControl") and not get_flag("immuneFirstControl_used")
	return has_status(mark)


func get_flag(key: String, default_value: Variant = false) -> Variant:
	return _flags.get(key, default_value)


func set_flag(key: String, value: Variant) -> void:
	_flags[key] = value


## 状态快照（事件 / 存档用）
func status_snapshot() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for s in statuses:
		out.append({
			"id": str(s.get("id", "")),
			"stacks": int(s.get("stacks", 1)),
			"remaining": int(s.get("remaining", 0)),
			"source": str(s.get("source", "")),
		})
	return out


# ---------------------------------------------------------------- 构造

## 由 BattleSetup 的成员字典构造（我方）
static func from_member(member: Dictionary, side: int, slot: int, mods: Dictionary = {}) -> BattleActor:
	var a := BattleActor.new()
	a.id = str(member.get("id", ""))
	a.display_name = str(member.get("name", a.id))
	a.side = side
	a.slot = slot
	a.l2 = BattleStats.derive(
		BattleStats.normalize_l1(member.get("l1", {})),
		member.get("equip", {}),
		mods
	)
	var hp_override := float(member.get("hp_max_override", 0.0))
	if hp_override > 0.0:
		a.l2["hp_max"] = hp_override
	a.hp = float(a.l2.get("hp_max", 0.0))
	a.inner = float(a.l2.get("inner_max", 0.0))
	a.skills.assign(member.get("skills", []))
	a.realm_levels = (member.get("realm_levels", {}) as Dictionary).duplicate(true)
	a.cultivation = (member.get("cultivation", {}) as Dictionary).duplicate(true)
	a.meta = (member.get("meta", {}) as Dictionary).duplicate(true)
	a.set_flag("immuneFirstControl", bool(member.get("immune_first_control", false)))
	return a


## 由敌方模板构造（敌方气血按编队系数缩放，GDD 3.1.9①）
static func from_enemy_template(template: Dictionary, side: int, slot: int,
		party_scale: float = 1.0, overrides: Dictionary = {}) -> BattleActor:
	var a := BattleActor.new()
	a.id = str(overrides.get("id", template.get("id", "")))
	a.display_name = str(overrides.get("name", template.get("name", a.id)))
	a.side = side
	a.slot = slot
	a.enemy_template_id = str(template.get("id", ""))
	a.tier = str(template.get("tier", "normal"))
	a.ai_preference = str(template.get("ai_preference", "damage"))

	var hp_max := float(template.get("hp", 1.0)) * maxf(party_scale, 0.01)
	a.l2 = {
		"atk": float(template.get("atk", 0)),
		"def": float(template.get("def", 0)),
		"hp_max": hp_max,
		"inner_max": float(template.get("inner", 0)),
		"inner_regen": float(template.get("inner", 0)) / 10.0,
		"crit_rate": BattleTypes.CRIT_BASE,
		"crit_damage": BattleTypes.CRIT_DAMAGE_BASE,
		"hit_rate": BattleTypes.HIT_BASE,
		"dodge_rate": 0.0,
		"speed": float(template.get("spd", 0)),
		"lifesteal": 0.0,
		"damage_bonus": 0.0,
		"damage_taken": 0.0,
	}
	a.hp = hp_max
	a.inner = float(a.l2.get("inner_max", 0.0))
	a.skills.assign(template.get("skill_ids", []))
	a.realm_levels = (overrides.get("realm_levels", {}) as Dictionary).duplicate(true)
	a.cultivation = (overrides.get("cultivation", {}) as Dictionary).duplicate(true)
	a.set_flag("immuneFirstControl", bool(overrides.get("immune_first_control", false)))
	return a


## 深拷贝（用于"同 seed 两次 simulate"之类的对照实验）
func clone() -> BattleActor:
	var a := BattleActor.new()
	a.id = id
	a.display_name = display_name
	a.side = side
	a.slot = slot
	a.l2 = l2.duplicate(true)
	a.hp = hp
	a.inner = inner
	a.skills = skills.duplicate()
	a.realm_levels = realm_levels.duplicate(true)
	a.cultivation = cultivation.duplicate(true)
	a.statuses = _copy_statuses()
	a.alive = alive
	a.enemy_template_id = enemy_template_id
	a.tier = tier
	a.ai_preference = ai_preference
	a.meta = meta.duplicate(true)
	a.dealt_damage = dealt_damage
	a.taken_damage = taken_damage
	a.healed = healed
	a.inner_spent = inner_spent
	a._flags = _flags.duplicate(true)
	return a


func _copy_statuses() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for s in statuses:
		out.append(s.duplicate(true))
	return out
