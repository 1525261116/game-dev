class_name BattleRng
extends RefCounted
## 可播种、可复现的随机数发生器（纯逻辑，无引擎依赖）。
##
## 职责：为战斗预结算提供**确定性**随机源，保证「同 seed + 同输入 = 逐事件完全一致」。
## 约束：`src/core/**` 内**禁止**使用全局 `randf()` / `randi()` / `randomize()`——
##       那会让战斗不可复现，也无法回放。
##
## 算法：SplitMix64（64 位整数运算，Godot 的 int 即 int64，溢出自动回绕）。
##       选它而不是 `RandomNumberGenerator` 的原因：
##         ① 状态可完整导出（一个 int），存档 / 回放简单；
##         ② 不依赖引擎对象，纯逻辑测试无需实例化任何节点。
##
## ⚠️ 注意：GDScript 的十六进制字面量必须是**有符号 int64 可表示**的值，
##    所以 0x9E3779B97F4A7C15 这类"高位为 1"的常数要写成其补码负数形式。
##    下面的常量注释里都标了对应的无符号值，便于与 SplitMix64 参考实现对照。

## 0x9E3779B97F4A7C15（SplitMix64 黄金比增量）
const GOLDEN: int = -7046029254386353131
## 0x2545F4914F6CDD1D（种子为 0 时的兜底非零值）
const SEED_FIXUP: int = 2685821657736338717
## 0xBF58476D1CE4E5B9
const MIX_A: int = -4658895280553007687
## 0x94D049BB133111EB
const MIX_B: int = -7723592293110705685

var _state: int = 0
var _seed: int = 0
var _calls: int = 0


func _init(seed_value: int = 0) -> void:
	reseed(seed_value)


## 重置为某个种子（种子 0 会映射到一个非零常数，避免退化序列）
func reseed(seed_value: int) -> void:
	_seed = seed_value
	_state = seed_value ^ GOLDEN
	if _state == 0:
		_state = SEED_FIXUP
	_calls = 0


func seed_value() -> int:
	return _seed


## 已产生随机数的次数（调试 / 测试用）
func calls() -> int:
	return _calls


## 下一个 64 位无符号整数（以 Godot 的 int64 表示，可能为负）
func next_int() -> int:
	# int64 溢出在 Godot 里是回绕语义，无需显式掩码
	_state = _state + GOLDEN
	var z: int = _state
	z = (z ^ (z >> 30)) * MIX_A
	z = (z ^ (z >> 27)) * MIX_B
	_calls += 1
	return z ^ (z >> 31)


## [0, 1) 的浮点数。
## 取高 31 位并**先掩码为无符号**（GDScript 的 >> 是算术移位，负数右移仍为负），
## 31 位精度（≈5e-10 分辨率）对战斗概率绰绰有余，且天然落在 [0, 1)。
func next_float() -> float:
	var v: int = (next_int() >> 33) & 0x7FFFFFFF
	return float(v) / 2147483648.0


## 概率判定：p <= 0 → false；p >= 1 → true（不消耗随机数，便于稳定复现）
func chance(p: float) -> bool:
	if p <= 0.0:
		return false
	if p >= 1.0:
		return true
	return next_float() < p


## [from, to] 闭区间整数
func range_int(from: int, to: int) -> int:
	if to <= from:
		return from
	return from + (next_int() & 0x7FFFFFFFFFFFFFFF) % (to - from + 1)


## 从数组中等概率取一个元素（空数组返回 null）
func pick(arr: Array) -> Variant:
	if arr.is_empty():
		return null
	return arr[range_int(0, arr.size() - 1)]


## 导出状态（存档 / 回放用）。用 Dictionary 以免 int64 在某端被截断。
func state() -> int:
	return _state


## 导入状态（与 state() 配套）
func restore(state_value: int, calls_made: int = 0) -> void:
	_state = state_value
	_calls = calls_made


## 便于测试与存档的完整快照
func snapshot() -> Dictionary:
	return {"seed": _seed, "state": _state, "calls": _calls}


## 由快照恢复
func from_snapshot(snap: Dictionary) -> void:
	_seed = int(snap.get("seed", 0))
	_state = int(snap.get("state", _seed))
	_calls = int(snap.get("calls", 0))
