class_name BattleResult
extends RefCounted
## 一场战斗的**输出契约**（纯逻辑）。
##
## `events` 是表现层唯一输入：表现层只读不写，不得参与任何数值计算，
## 也不得依赖前序事件的状态（保证可跳过 / 可快进 / 可从任意点回放）。
## `final_state` 供"跳过战斗"直接把状态设到结果。

var outcome: int = BattleTypes.Outcome.DRAW
var rounds: int = 0
var events: Array[Dictionary] = []
var stats: Dictionary = {}
var final_state: Dictionary = {}
var seed: int = 0


func is_ally_win() -> bool:
	return outcome == BattleTypes.Outcome.ALLY_WIN


func is_draw() -> bool:
	return outcome == BattleTypes.Outcome.DRAW


## 便于断言的可读摘要
func summary() -> String:
	var labels: Dictionary = {
		BattleTypes.Outcome.ALLY_WIN: "我方胜",
		BattleTypes.Outcome.ENEMY_WIN: "敌方胜",
		BattleTypes.Outcome.DRAW: "平局",
	}
	var label := str(labels.get(outcome, "?"))
	return "seed=%d %s 回合=%d 事件=%d" % [seed, label, rounds, events.size()]


## 事件类型计数（数值验证报告 / 测试用）
func event_counts() -> Dictionary:
	var counts: Dictionary = {}
	for e in events:
		var t := str(e.get("type", ""))
		counts[t] = int(counts.get(t, 0)) + 1
	return counts


## 所有事件的最终时间戳（毫秒），用于推算播放时长
func duration_ms() -> int:
	var last := 0
	for e in events:
		last = maxi(last, int(e.get("t", 0)))
	return last
