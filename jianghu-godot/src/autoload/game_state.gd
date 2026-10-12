extends Node
## 运行时游戏状态（Autoload）
##
## 只保存「当前这一局」的状态；**配置数据在 DataRegistry，存档读写走 SaveManager**。
## 所有字段都要能被 SaveManager 序列化（只放基础类型 / Dictionary / Array）。

const MAX_REPUTATION: int = 10000
const PARTY_SCALE_BASE: int = 4

# ---------------------------------------------------------------- 主角
var player_name: String = "沈一凡"          ## 化名（GDD 阶段1 幕4）
var player_level: int = 1
var realm_index: int = 0                     ## 人物境界 0~21（见 GDD 3.3.1）
var attributes: Dictionary = {               ## L1 基础四维
	"arm": 5,      # 臂力
	"agility": 5,  # 身法
	"bone": 5,     # 根骨
	"inner": 5,    # 内息
}
var free_points: int = 0
var hidden_talent: int = 10                  ## 隐藏资质「悟性」(0~100)
var cultivation: Dictionary = {}             ## 修为：按 8 类分别累计（GDD 3.4.3）

# ---------------------------------------------------------------- 进度
var reputation: int = 0                      ## 声望 0~10000（5 档）
var morality: int = 0                        ## 正邪值（独立于声望）
var stage: int = 1                           ## 主线阶段 1~5
var game_hours: int = 0                      ## 游戏内累计小时（时间系统）

# ---------------------------------------------------------------- 队伍
var party: Array[String] = []                ## 当前上阵成员 id（主角在首位）
var companions_owned: Array[String] = []
var formation_id: String = ""                ## 当前装备的阵法 id

# ---------------------------------------------------------------- 门派
var sect_name: String = ""
var sect_level: int = 0

# ---------------------------------------------------------------- 便捷查询

## 上阵人数上限：3 → 4 → 5（门派战 6），对齐烟雨江湖的人数成长
func max_party_size(is_sect_war: bool = false) -> int:
	if is_sect_war:
		return 6 if sect_level >= 3 else 4
	if sect_level >= 3:
		return 5
	if reputation >= 500:
		return 4
	return 3


## 编队系数：以 4 人为基准，用于缩放敌方气血，保证 TTK 恒定
func party_scale() -> float:
	var n: int = max(party.size(), 1)
	return roundf(float(n) / float(PARTY_SCALE_BASE) * 100.0) / 100.0


## 是否满足守境阵等「免疫首次控制」的前置
func has_immune_first_control() -> bool:
	return formation_id == "FM_shoujing" and sect_level >= 0 and _formation_level("FM_shoujing") >= 5


var _formation_levels: Dictionary = {}


func set_formation_level(formation_id: String, level: int) -> void:
	_formation_levels[formation_id] = clampi(level, 1, 5)


func _formation_level(formation_id: String) -> int:
	return int(_formation_levels.get(formation_id, 1))


# ---------------------------------------------------------------- 序列化

func to_dict() -> Dictionary:
	return {
		"player_name": player_name,
		"player_level": player_level,
		"realm_index": realm_index,
		"attributes": attributes,
		"free_points": free_points,
		"hidden_talent": hidden_talent,
		"cultivation": cultivation,
		"reputation": reputation,
		"morality": morality,
		"stage": stage,
		"game_hours": game_hours,
		"party": party,
		"companions_owned": companions_owned,
		"formation_id": formation_id,
		"sect_name": sect_name,
		"sect_level": sect_level,
		"formation_levels": _formation_levels,
	}


func from_dict(d: Dictionary) -> void:
	player_name = str(d.get("player_name", "沈一凡"))
	player_level = int(d.get("player_level", 1))
	realm_index = int(d.get("realm_index", 0))
	attributes = d.get("attributes", attributes)
	free_points = int(d.get("free_points", 0))
	hidden_talent = int(d.get("hidden_talent", 10))
	cultivation = d.get("cultivation", {})
	reputation = int(d.get("reputation", 0))
	morality = int(d.get("morality", 0))
	stage = int(d.get("stage", 1))
	game_hours = int(d.get("game_hours", 0))
	party.assign(d.get("party", []))
	companions_owned.assign(d.get("companions_owned", []))
	formation_id = str(d.get("formation_id", ""))
	sect_name = str(d.get("sect_name", ""))
	sect_level = int(d.get("sect_level", 0))
	_formation_levels = d.get("formation_levels", {})


func reset() -> void:
	player_name = "沈一凡"
	player_level = 1
	realm_index = 0
	attributes = {"arm": 5, "agility": 5, "bone": 5, "inner": 5}
	free_points = 0
	hidden_talent = 10
	cultivation = {}
	reputation = 0
	morality = 0
	stage = 1
	game_hours = 0
	party = ["player"]
	companions_owned = []
	formation_id = ""
	sect_name = ""
	sect_level = 0
	_formation_levels = {}


func _ready() -> void:
	reset()
