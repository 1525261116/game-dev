class_name ComboResolver
extends RefCounted
## 连招判定（纯逻辑，对齐 GDD 3.4.5 与 05_combat/连招系统.md）。
##
## 规则：
##   上一式的**收势** == 本式的**起势**（且均非 0） → 连招成立
##   链路长度 2 → 伤害 +30%
##   链路长度 3 → 伤害 +60%，并额外吸血 +10%
##   接不上 → **无惩罚**，本式按第 1 段正常释放，并从本式重新起势
##   辅助型（内功 / 身法，起收势为 0）→ 不参与连招，且**中断**本列链路
##
## 链路挂在「每方 × 每列（left / center / right）」上，因此同列跨位也能连击
## （GDD 02 §2.1.1 的"列连击"，同列前中后三人接力）。

## 一式的连招元信息（canonical 结果结构）
static func no_combo() -> Dictionary:
	return {"level": 1, "damage_bonus": 0.0, "lifesteal_bonus": 0.0, "label": ""}


## 检查「上一式的收势」是否等于「本式的起势」
static func chains(prev: Dictionary, next: Dictionary) -> bool:
	var prev_end := int(prev.get("end_mark", 0))
	var next_start := int(next.get("start_mark", 0))
	if prev_end == 0 or next_start == 0:
		return false
	return prev_end == next_start


## 某式是否「辅助型」（内功 / 身法，起收势均为 0）
static func is_support(skill: Dictionary) -> bool:
	return int(skill.get("start_mark", 0)) == 0 and int(skill.get("end_mark", 0)) == 0


## 由链路长度给出加成（长度 1 = 未连招；2 = 二连；3 = 三连）
static func bonus_for_level(level: int) -> Dictionary:
	match clampi(level, 1, 3):
		2:
			return {
				"level": 2,
				"damage_bonus": BattleTypes.COMBO_2_BONUS,
				"lifesteal_bonus": 0.0,
				"label": "combo_2",
			}
		3:
			return {
				"level": 3,
				"damage_bonus": BattleTypes.COMBO_3_BONUS,
				"lifesteal_bonus": BattleTypes.COMBO_3_LIFESTEAL,
				"label": "combo_3",
			}
	return no_combo()


## 解析第 cast_index 式在链中的位置。
## skills：按出手顺序排列的功法行数组；chain_len：该列当前已接续的长度（0/1/2）。
## 返回 {level, damage_bonus, lifesteal_bonus, label}。
## level = 0 表示"本式未连招但**中断了链路**"（普攻 / 辅助型），level = 1 表示第一式。
static func resolve_chain(skills: Array[Dictionary], cast_index: int, chain_len: int) -> Dictionary:
	if cast_index < 0 or cast_index >= skills.size():
		return no_combo()
	var skill := skills[cast_index]
	if is_support(skill):
		var out := no_combo()
		out["level"] = 0
		out["interrupted"] = true
		return out
	var level := clampi(chain_len + 1, 1, 3)
	var bonus := bonus_for_level(level)
	bonus["interrupted"] = false
	return bonus


## 推进一条链（纯函数，不入参）——返回 {chain_len, expected_start, combo}
## chain_len：推进后链长（0 = 空 / 1 = 已出第一式 / 2 = 已出第二式）
## expected_start：下一次出手需要匹配的起势（0 = 未定）
static func advance(chain_len: int, expected_start: int, skill: Dictionary) -> Dictionary:
	# 辅助型 / 普攻：中断链路，重新起势
	if skill.is_empty() or is_support(skill):
		return {"chain_len": 0, "expected_start": 0, "combo": _interrupted()}

	var start := int(skill.get("start_mark", 0))
	var end := int(skill.get("end_mark", 0))

	# 链路为空 → 第一式，起势不校验
	if chain_len <= 0:
		return {"chain_len": 1, "expected_start": end, "combo": no_combo()}

	# 续链：本次起势接上链路期待的收势
	if start == expected_start and start != 0:
		if chain_len >= 2:
			# 三连达成 → 给 +60% 与吸血，然后**重新起势**
			var triple := bonus_for_level(3)
			return {"chain_len": 0, "expected_start": 0, "combo": triple}
		return {"chain_len": 2, "expected_start": end, "combo": bonus_for_level(2)}

	# 接不上：不惩罚，本次按第一式释放，并从本式重新起势
	return {"chain_len": 1, "expected_start": end, "combo": no_combo()}


## 检查一组功法内是否存在长度 ≥ min_len 的连招链路（数据校验 / 测试用）
static func max_chain_length(rows: Array[Dictionary]) -> int:
	var best := 0
	var run := 0
	for i in rows.size():
		if i == 0:
			run = 1
		elif chains(rows[i - 1], rows[i]):
			run += 1
		else:
			run = 1
		best = maxi(best, run)
	return best


## 在链路中找出所有长度 ≥ 3 的连续片段（测试断言「每个 group 至少 1 条 3 连」）
static func triple_chains(rows: Array[Dictionary]) -> Array:
	var out: Array = []
	var run_start := 0
	for i in rows.size():
		if i > 0 and not chains(rows[i - 1], rows[i]):
			run_start = i
		if i - run_start + 1 >= 3:
			out.append(rows.slice(i - 2, i + 1))
	return out


static func _interrupted() -> Dictionary:
	var out := no_combo()
	out["level"] = 0
	out["interrupted"] = true
	return out
