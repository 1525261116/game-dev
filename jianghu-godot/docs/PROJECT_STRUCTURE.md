# 工程目录规范（PROJECT_STRUCTURE）

> 《江湖从心》Godot 工程｜引擎：Godot 4.7.x｜目标：移动端（iOS/Android）+ PC
> **本文是目录与命名约定的唯一依据。新增文件前先读本文。**

---

## 0. 三条总原则

| # | 原则 | 含义 |
|:-:|------|------|
| 1 | **逻辑与表现分离** | `src/core/` 是纯逻辑（不依赖场景树、不进 `_process`），`src/presentation/` 才是表现。战斗必须能「先算完再回放」。 |
| 2 | **内容与代码分离** | 一切内容来自 `src/data/tables/*.json`；**代码里不得出现功法名、装备名、数值常量**。 |
| 3 | **数据引擎中立** | 配置表是纯 JSON，TypeScript 与 GDScript 都能读。**换引擎的代价只落在代码，不落在内容。** |

---

## 1. 顶层目录

```
jianghu-godot/
├─ project.godot          Godot 工程入口（唯一）
├─ icon.svg               工程图标
├─ .gitignore / .gitattributes
├─ README.md
│
├─ docs/                  📄 文档（架构、规范、决策记录）
├─ addons/                🔌 插件（Godot 保留名，第三方与自研编辑器插件）
├─ assets/                🎨 原始资产（美术/音频/字体源文件）
├─ data/                  📊 设计数据源（策划编辑的 CSV / Excel）
├─ src/                   💻 源码（GDScript）
├─ scenes/                🎬 场景（.tscn）
├─ resources/             📦 自定义 Resource（.tres 实例）
├─ tests/                 🧪 测试
├─ tools/                 🔧 工具脚本（导入器 / CI）
└─ build/                 📤 导出产物（git 忽略）
```

---

## 2. `assets/` —— 原始资产

**原则：只放「源」资源，不放导入产物**（导入产物由 Godot 在 `.godot/` 自动生成）。

```
assets/
├─ art/
│  ├─ characters/     角色部件贴图（严格按 slot 命名，见 rig-spec）
│  ├─ backgrounds/    场景背景
│  ├─ ui/             UI 素材
│  ├─ vfx/            特效序列帧
│  └─ fonts/          字体（含全局主题 ui_theme.tres）
├─ audio/
│  ├─ bgm/            配乐
│  ├─ sfx/            音效
│  └─ voice/          配音
└─ fonts/
```

**命名规范**：`{类别}_{名称}_{变体}.png`，全小写下划线分隔。
例：`char_xiejiu_torso.png`、`ui_btn_primary_normal.png`、`vfx_slash_arc_01.png`

---

## 3. `data/` vs `src/data/` —— 两处容易混淆，务必区分

| 目录 | 内容 | 谁写 | 谁读 |
|------|------|------|------|
| `data/source/` | **策划编辑的源表**（CSV / Excel） | 策划（人） | 导入器 |
| `data/schema/` | 字段定义（类型、取值范围、必填） | 策划 + 程序 | 校验器 |
| `src/data/tables/` | **生成的运行期表**（JSON，唯一真相） | 导入器（脚本） | 运行时 / 测试 |

**流程**：

```
data/source/*.csv  →  tools/import/  →  src/data/tables/*.json  →  DataRegistry
                                          ↑
                                    校验器（引用完整性 / 边界 / 概率和 / 唯一主键）
```

> **禁止手改 `src/data/tables/`**：它由导入器生成。改了会在下次导入时被覆盖。

---

## 4. `src/` —— 源码分层

```
src/
├─ autoload/          🔌 全局单例（在 project.godot 注册）
│  ├─ event_bus.gd        事件总线（逻辑↔表现解耦的唯一通道）
│  ├─ game_state.gd       运行时状态（当前这一局）
│  ├─ data_registry.gd    配置表加载与校验
│  ├─ save_manager.gd     存档（版本化 + 原子写入 + 迁移）
│  └─ scene_router.gd     场景路由（带转场，禁止裸调 change_scene）
│
├─ core/              🧠 纯逻辑（**禁止依赖场景树 / 节点 / 渲染**）
│  ├─ battle/             战斗：九宫格、预结算、阵法、状态、AI
│  ├─ formula/            伤害/命中/暴击/连招/词条公式
│  ├─ progression/        等级、四维、境界、突破、修为、悟性
│  ├─ economy/            货币、交易、掉落
│  ├─ quest/              任务、奇遇、触发条件求值
│  ├─ sect/               门派、弟子、建筑、生产、外交
│  ├─ save/               存档序列化与迁移（不含文件 IO）
│  ├─ anim/               动画数学：骨架求解、时间轴采样、挂点
│  └─ rng/                可播种随机（禁 Math.random / randf 全局）
│
├─ data/              📦 数据层
│  ├─ tables/             生成的 JSON（唯一真相）
│  ├─ registry/           数据访问封装（供 core 使用）
│  └─ schema/             GDScript 侧的类型/schema 定义
│
├─ presentation/      🎬 表现层（可以依赖 core，反向禁止）
│  ├─ ui/                 界面：启动、主菜单、面板、HUD
│  ├─ battle/             战斗表现：布阵、事件回放、HitStop、飘字
│  ├─ anim/               骨架渲染：cutout 骨骼、皮肤、特效层
│  ├─ audio/              BGM / SFX 总线
│  └─ widgets/            可复用组件（先建组件库，再生产页面）
│
└─ platform/          🌐 平台适配（Steam / 触屏 / 安全区 / 生命周期）
```

### 依赖方向（**只允许向下**）

```
presentation  →  core  →  data
      ↓            ↓
   platform     autoload
```

**违规示例**（review 直接打回）：
- `core/battle/*.gd` 里出现 `Node` / `Node2D` / `get_tree()` / `await`
- `core/` 里 `preload("res://scenes/...")`
- 任意位置直接 `Input.is_action_pressed()`（应走输入抽象，便于触屏/键鼠/手柄三模）

---

## 5. `scenes/` —— 场景

```
scenes/
├─ boot/          启动（数据加载 + 自检）
├─ main_menu/     主菜单
├─ world/         大地图、小场景
├─ battle/        战斗
├─ ui/            可复用 UI 场景（面板、弹窗、列表项）
└─ dev/           开发验证场景（**不随发行版打包**）
```

**命名**：`snake_case.tscn`，与同名脚本对应（`world.tscn` ↔ `world_root.gd`）。
**根节点命名**：与场景同名，PascalCase（`World` / `MainMenu`）。

> ⚠️ **不要用编辑器拖出来的隐式依赖**：场景之间的引用走 `SceneRouter` 的路径常量，
> 组件之间走信号或事件总线。这样场景可以单独打开测试。

---

## 6. `resources/` —— 自定义 Resource

存放**自定义 Resource 类的实例**（`.tres`），按业务分子目录：

```
resources/
├─ gongfa/        功法（品质、境界倍率、内力消耗、被动）
├─ equipment/     装备
├─ companions/    伙伴 / 弟子
├─ formations/    阵法（12 个）
├─ status/        状态效果（22 种）
└─ motions/       动作 clip（骨架动画数据）
```

**用途**：Godot 编辑器可以直接编辑这些资源、做属性检查、拖进 Inspector。
**注意**：与 `src/data/tables/*.json` 有职责重叠——**约定：批量数值走 JSON 表，单个复杂对象走 .tres**。
（例如 87 门功法的数值走表；一个 BOSS 的多阶段行为走 .tres）

---

## 7. `tests/` —— 测试

```
tests/
├─ run_tests.gd       主测试运行器（无依赖，不需要 GUT）
├─ unit/              单元测试（纯逻辑）
└─ integration/       集成测试（场景加载、存档往返）
```

**运行**：

```bash
# 逻辑测试（无头，零依赖，退出码 = 失败数）
Godot --headless --path . --script res://tests/run_tests.gd

# 集成测试
Godot --headless --path . --script res://tests/integration/run_integration.gd
```

**约定**：测试只依赖 `src/core/` 与 `FileAccess`，**不依赖 autoload** ——
这样核心逻辑天然与引擎解耦，也能在 CI 独立运行。

---

## 8. `tools/` —— 工具

```
tools/
├─ import/            数据导入器（CSV → JSON + 校验）
│  └─ export_tables.gd
└─ ci/                CI 脚本
   ├─ run_tests.sh          跑测试
   └─ render_frames.sh      渲染帧到 PNG（**视觉验证**）
```

---

## 9. 视觉验证（这条是本工程的关键能力）

Godot 可以在**无 GUI 会话**下把真实画面渲染成 PNG 序列：

```bash
Godot --path . \
      --write-movie build/frames/frame.png \
      --quit-after 30 \
      --resolution 1280x720
```

产物：`frame00000000.png` … 可直接查看，用于**画面回归验证**。
这使得「AI 写代码 → 跑测试 → 看画面」的完整闭环成立。

> ⚠️ `--headless` 会强制使用 dummy 渲染驱动，**不出图**。
> 要出图**不能加 `--headless`**（但也不需要交互式桌面会话）。

---

## 10. 命名与代码规范速查

| 对象 | 规范 | 示例 |
|------|------|------|
| 目录 / 文件 | `snake_case` | `formation_resolver.gd` |
| 类（`class_name`） | `PascalCase` | `class_name FormationResolver` |
| 节点名 | `PascalCase` | `MainMenu` / `Buttons` |
| 信号 | `snake_case`（过去式/名词） | `battle_finished` / `data_loaded` |
| 常量 | `SCREAMING_SNAKE` | `MAX_PARTY_SIZE` |
| 私有成员 | `_` 前缀 | `var _tables: Dictionary` |
| 配置表主键 | `{前缀}_{名称}` | `FM_changshe` / `GF_badao` / `ST_stun` |
| 场景路径 | 集中在 `SceneRouter` 常量 | `SceneRouter.WORLD` |

**类型标注**：所有函数参数与返回值必须标注类型（`func x(a: int) -> void:`）。
**注释**：文件顶部写模块职责；公开函数写用途与约束。

---

## 11. 新增文件的检查清单

```
□ 放在正确的层（core / presentation / data / scenes / resources）
□ 依赖方向没有反向（presentation → core → data）
□ 没有硬编码内容（数值/名称走配置表）
□ 类型标注完整
□ 若属核心逻辑：在 tests/ 有对应用例
□ 若新增配置表：在 data/schema/ 有字段定义
□ 若新增场景：路径登记进 SceneRouter
```

---

## 12. 相关文档

| 文档 | 内容 |
|------|------|
| `docs/ARCHITECTURE.md` | 分层架构与关键设计决策 |
| `docs/CODING_CONVENTIONS.md` | GDScript 编码规范 |
| `../jianghu-design/GDD/` | 完整策划设计（玩法/数值/内容） |
| `../jianghu-design/12_tech/` | 技术方案、引擎评估、MCP 评估 |
| `../jianghu-game/docs/rig-spec.md` | 骨架 slot 规范（美术按此作画） |
