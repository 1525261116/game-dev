extends Node
## 全局事件总线（Autoload）
##
## 架构铁律：**逻辑层只发事件，表现层只订阅事件，二者不互相调用**。
## 这样战斗可以「先算完再回放」，低端机也能把表现降级甚至跳过，
## 而战斗结果完全不受表现层影响（对应 GDD 5.4 的「预结算 + 表现分离」）。
##
## 用法：
##   EventBus.battle_started.emit(setup)
##   EventBus.battle_started.connect(_on_battle_started)

# ---------------------------------------------------------------- 生命周期
signal game_bootstrapped
signal scene_will_change(from_path: String, to_path: String)
signal scene_changed(path: String)

# ---------------------------------------------------------------- 数据
signal data_loaded(table_name: String, row_count: int)
signal data_load_failed(table_name: String, reason: String)

# ---------------------------------------------------------------- 战斗
## 战斗开始（战前布阵完成）
signal battle_started(setup: Dictionary)
## 战斗过程中的单条事件（表现层按此回放）
signal battle_event_fired(event: Dictionary)
## 战斗结束
signal battle_finished(result: Dictionary)
## 命中停顿 / 震屏请求（表现层专用）
signal hit_stop_requested(duration_ms: int, shake_level: int)

# ---------------------------------------------------------------- 养成
signal level_up(actor_id: String, new_level: int)
signal realm_breakthrough(actor_id: String, realm_name: String)
signal gongfa_realm_up(gongfa_id: String, realm_index: int)
signal cultivation_gained(type: String, amount: int)

# ---------------------------------------------------------------- 世界
signal reputation_changed(delta: int, current: int)
signal morality_changed(delta: int, current: int)
signal game_time_advanced(hours: int)

# ---------------------------------------------------------------- 存档
signal game_saved(slot: int)
signal game_loaded(slot: int)
signal save_failed(slot: int, reason: String)

# ---------------------------------------------------------------- UI
signal toast_requested(message: String, level: String)
signal modal_requested(title: String, body: String, options: Array)


## 便捷方法：请求一条提示（避免各处重复构造参数）
func toast(message: String, level: String = "info") -> void:
	toast_requested.emit(message, level)
	print("[Toast:%s] %s" % [level, message])


## 便捷方法：请求一次表现层停顿（表现层可选择忽略，如低画质模式）
func request_hit_stop(duration_ms: int, shake_level: int = 0) -> void:
	hit_stop_requested.emit(duration_ms, shake_level)
