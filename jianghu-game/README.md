# 江湖从心 · 游戏开发项目

> 武侠开放世界 + 单机 RPG · 多端支持（移动端 / PC）

## 项目说明

本仓库为《江湖从心》游戏本体开发项目，基于策划案与 GDD 进行游戏程序实现。

- **零基础上手手册**：`docs/零基础上手手册_v1.0.md`（**项目主人入门必读**：原理、术语、可自行修改的实操）
- **策划设计（GDD）**：`../jianghu-design/GDD/`
- **技术方案与执行计划**：`../jianghu-design/12_tech/技术方案与执行计划_v1.1.md`（已确认，执行依据）
- **辅助工具**：`../jianghu-tools/`

## 技术栈

> 决策见 [技术方案与执行计划 v1.1](../jianghu-design/12_tech/技术方案与执行计划_v1.1.md) §1.2

| 层 | 选型 |
|----|------|
| 引擎 | **Phaser 3.x**（锁定小版本） |
| 语言 | **TypeScript 5.x（strict）** |
| 构建 | **Vite** |
| 测试 | **Node 原生 `node --test`**（Core 逻辑，零依赖）+ Playwright（表现截图，可选） |
| 数据校验 | **zod** |
| PC 打包 | Electron（+ steamworks.js） |
| 移动打包 | Capacitor 8.x |
| 动画 | **自研轻量 cutout 骨骼（方案 C）** |
| 存档 | 引擎无关 JSON + zod + 版本迁移 |

**五条架构铁律**（见技术方案 §2.2）：Core 禁 import Phaser ｜ 战斗预结算与表现分离 ｜ 零硬编码 ｜ 存档引擎无关 ｜ 可播种 RNG 禁 `Math.random()`

## 当前进度

| 里程碑 | 状态 | 说明 |
|--------|:----:|------|
| **M0 骨架能动** | ✅ **已达成** | 3 体型 / 3 动作 / 60 测试全绿 / 无头截图验证 |
| **动作库补齐** | ✅ **已完成** | **62 个动作**（6 武器组 × 9 + 内功 4 + 身法 4）/ 测试 **69 项**全绿 |
| **M1 游戏骨架** | 🚧 **进行中** | 场景流转 + Phaser 骨架渲染 + 九宫格布阵 + 战斗预结算与日志回放 + **阵法系统接入**（站位真正影响攻防） |
| **战斗系统深化** | ✅ **已完成** | **10 型攻击范围 + 战斗倾向选目标 + 连招起收势 + 内力消耗** |
| **美术资源管线** | ✅ **已完成** | `assets/` 放图即生效（改名不改代码）；skin.json 自动生成 + 8 类错误导入期拦截；**占位贴图 + 三层水墨背景**已就位；测试 **202 项**全绿 |

详见 [`docs/sprint-01-report.md`](docs/sprint-01-report.md) 与 [`docs/sprint-02-report.md`](docs/sprint-02-report.md)
> **要改人物贴图 / 战斗背景 / 战斗 UI？先读 [`docs/asset-pipeline.md`](docs/asset-pipeline.md)** —— 那篇就是"放图 → 跑命令 → 生效"的完整手册。

## 目录结构

| 路径 | 用途 / 说明 |
|------|------|
| `jianghu-game/` | 工程根目录 |
| 　`assets/chars/<角色>/parts/` | **美术贴图**（17 个部件，文件名 = slot 名）；`skin.json` 由 `pnpm skin:gen` 生成 |
| 　`assets/weapons/<组>/` | 武器贴图（6 组 × 5 品质，全角色共享） |
| 　`assets/bg/battle/` | 战斗背景三层（远山 / 中景 / 地面） |
| 　`data/tables/*.csv` | **策划编辑的配置表源文件**（Excel 可直接打开） |
| 　`docs/` | — |
| 　　`零基础上手手册_v1.0.md` | **零基础上手手册**（原理 / 术语 / 实操） |
| 　　`rig-spec.md` | 骨架与部件规范（贴图按此画） |
| 　　`asset-pipeline.md` | **美术资源管线手册**（换贴图 / 换背景 / 改战斗 UI 全流程） |
| 　　`战斗演出制作计划_v1.0.md` | **战斗演出制作计划**（对标参考视频风格；P0~P6 分阶段 + 验收 + 资源清单） |
| 　　`sprint-01-report.md` | Sprint-01 报告 |
| 　　`sprint-02-report.md` | Sprint-02 报告（战斗系统深化） |
| 　`src/` | — |
| 　　`core/anim/` | 动画内核（纯逻辑，可 node --test） |
| 　　　`types.ts` | slot / clip / 骨架类型（唯一真相） |
| 　　　`ease.ts` | 5 种缓动 |
| 　　　`skeleton.ts` | 层级求解 / 挂点换算 / 事件区间 |
| 　　　`clip.ts` | 时间轴采样 |
| 　　　`validate.ts` | 校验器 |
| 　　`core/battle/` | 战斗内核（九宫格 / 阵法 / 范围 / 选目标 / 连招 / 内力 / 结算，纯逻辑） |
| 　　　`types.ts` | 站位 / 阵型 / 状态 / 属性修正类型 |
| 　　　`formation.ts` | 阵法加成求解 |
| 　　　`rng.ts` | 可播种随机数（铁律 5：禁止 `Math.random()`） |
| 　　　`formula.ts` | **伤害公式纯函数**（口径见 GDD 03 §3.1.2 定稿） |
| 　　　`range.ts` | **10 型攻击范围**（数量 × 区域双轴；动态十字 / 就近回退 / 表现形状换算） |
| 　　　`targeting.ts` | **目标选取**（候选池 → 战斗倾向排序 → 取前 C；出手快照不递补） |
| 　　　`combo.ts` | **连招**（起势收势 + 每方每列一条链，+30% / +60% + 吸血） |
| 　　　`simulate.ts` | **战斗预结算** → 战斗日志；含内力系统、AI 选招与批量模拟器 |
| 　　`core/config/` | 配置表契约（zod 校验 + 跨表一致性检查） |
| 　　`data/` | — |
| 　　　`rigs.ts` | 3 套体型构建器 |
| 　　　`gongfa_visual.ts` | 87 门功法表现映射 |
| 　　　`status.ts` | 状态效果表 |
| 　　　`formations.ts` | 阵法表 |
| 　　　`gongfa-power.ts` | 品质威力 / 境界倍率 / 一级属性换算（数值口径） |
| 　　　`tables.ts` | **配置表访问层**（运行时自检 + 翻译成战斗配置） |
| 　　　`battle-presets.ts` | 默认对战入口（数值全部来自配置表） |
| 　　　`generated/tables.ts` | ⚠️ 自动生成，**请勿手改**（由 `pnpm tables:import` 产出） |
| 　　　`motions/*.json` | 动作数据（62 个，由 `tools/gen-motions.ts` 生成） |
| 　　`render/` | **表现层**（Phaser 相关：只负责画，不含任何数值计算） |
| 　　　`anim/RigView.ts` | 骨架渲染（预创建部件、每帧只改属性，避免手机掉帧） |
| 　　　`anim/CharacterView.ts` | 角色视图（骨架 + 动作播放 + 朝向镜像） |
| 　　　`anim/MotionLib.ts` | 动作库注册表（自动收进全部动作，新增文件不用改代码） |
| 　　　`anim/SkinRegistry.ts` | 皮肤注册表（资源路径 ↔ 纹理 key ↔ 单位 charId） |
| 　　　`anim/RigView.ts` | 部件渲染：**有贴图用贴图，没贴图回退色块**（美术可分批交付） |
| 　　　`scenes/` | 场景：启动 / 资源加载 / 主菜单 / 战斗 / **战斗验证台** / 动作库预览 |
| 　　　`ui/Theme.ts` | 视觉主题与按钮（改一处，全游戏生效） |
| 　`main.ts` | 游戏入口（只做配置与场景注册，保持极短） |
| 　`index.html` | 网页入口（含移动端 viewport 适配） |
| 　`tests/` | node --test（**202 项**：动画 24 / 战斗 27 / 伤害公式 23 / 范围 9 / 选目标 20 / 内力 9 / 连招 14 / **皮肤 16** / 战斗结算 14 / 配置管线 14 / 阵法集成 14 / 功法 9 / 动作库 9） |
| 　　`fixtures.ts` | 测试夹具（面板可完全指定，用于精确断言；非 .test.ts 不会被收集） |
| 　`tools/` | — |
| 　　`load-json.ts` | — |
| 　　`gen-motions.ts` | **动作库程序化生成器**（动作原型 × 组特征 → 62 个动作 JSON） |
| 　　`tables-io.ts` | 配置表读取与校验（脚本与测试共用，报错精确到行列） |
| 　　`import-tables.ts` | **配置表导入器**（CSV → 生成的 TS；校验不通过不写盘） |
| 　　`validate-tables.ts` | 配置表校验器（只检查，不生成文件） |
| 　　`gen-skin.ts` | **皮肤导入器**（零依赖，自己读 PNG 文件头；校验 + 生成 skin.json） |
| 　　`gen-placeholder-art.ts` | **占位美术生成器**（程序生成合规贴图与背景，默认不覆盖你画的图） |
| 　　`gen-skin-templates.ts` | **枢轴对位模板生成器**（4× 放大 + 粉色十字准星，手调关节用） |
| 　　`fit-skin-part.ts` | **部件对位器**（抠底 → 裁边 → 缩放 → 自动钉住关节；AI 生图落地关键工具） |
| 　　`preview/make-preview.ts` | 无依赖骨架预览生成器 |
| 　`preview/` | 预览 HTML + 截图 |

## 动作库（62 个动作）

动作**不是手写的**，而是由「动作原型 × 组特征」两个维度相乘生成：

| 维度 | 数量 | 内容 |
|------|:----:|------|
| 动作原型 | 15 | 待机 / 起势 / 快招 / 重击 / 横扫 / 功法起手 / 受击 / 闪避 / 倒地 / 打坐 / 气劲 / 疾冲 / 腾挪 / 消失 / 落地 |
| 组特征 | 8 | 刀 / 剑 / 拳掌 / 暗器 / 奇门 / 长兵 / 内功 / 身法 |

数量：6 武器组 × 9 原型 + 内功 4 + 身法 4 = **62 个**（全角色共用，与角色数无关）

> **与设计文档的差异说明**：《动画复用方案 v1.0》§4.3 记为 56 个（武器组按 8 个原型计），
> 但代码中 `MotionArchetype` 已包含 `sweep`（横扫），且枪组有 4 门功法
> （杨家枪法 / 梨花枪 / 五虎断门枪 / 岳家枪）实际使用 `sweep`。
> 若只做 56 个，这 4 门功法将没有动作可播 —— 因此本工程按 **62 个** 执行。

| 想改什么 | 改哪里 |
|----------|--------|
| 某类武器的整体手感（幅度 / 速度 / 伸展 / 打击点） | `tools/gen-motions.ts` 的 `PROFILES` |
| 某类动作的手感（例如所有快招都更狠） | `tools/gen-motions.ts` 的 `ARCHETYPES` |
| 单个动作的细节 | 直接改 `src/data/motions/<组>_<原型>.json`（**不会被生成器覆盖**） |
| 新增武器类型（例如鞭） | 在 `PROFILES` 加一组特征，再跑 `pnpm gen:motions` |

守护测试见 `tests/motion-lib.test.ts`：保证 62 个动作齐全、**87 门功法都有动作可播**、
循环动作不跳帧、攻击动作的打击点真的在动。

## 配置管线（改表格就能改数值）

数值**不写在代码里**，全部放在 CSV 表格中：

| 路径 | 说明 |
|------|------|
| `data/tables/skills.csv` | 功法表：品质 / 境界 / 招式倍率 / **10 型范围**（`range` + `randomCount`）/ **连招起收势**（`stanceStart`/`stanceEnd`）/ 附带状态 |
| `data/tables/units.csv` | 单位表：阵营 / 站位 / 武器组 / 面板数值 / **内息**（`breath` → 内力上限与回复）/ **装备位 3 门套路**（`skillId`/`skillIdB`/`skillIdC`） |
| `data/tables/units.csv` | 单位表：阵营 / 站位 / 武器组 / 面板数值 / 使用功法 |
| `data/tables/battle.csv` | 对战配置：双方各用哪个阵法、练到几级（留空 = 不用阵法） |
| `src/core/config/schema.ts` | 配置表契约（zod 校验 + 跨表一致性检查） |
| `src/data/generated/tables.ts` | **自动生成，请勿手改** |
| `src/data/tables.ts` | 运行时访问层：自检 + 翻译成战斗配置 |

**改数值的标准流程**

| 步骤 | 操作 |
|:--:|------|
| 1 | 用 Excel 或任意文本编辑器打开 `data/tables/*.csv` |
| 2 | 改数字，保存 |
| 3 | 运行 `pnpm tables:validate` 检查有没有写错 |
| 4 | 运行 `pnpm tables:import` 写进代码 |
| 5 | 浏览器刷新即时生效（**不需要重启开发服务器**） |

**两条设计原则**

| 原则 | 说明 |
|------|------|
| 功法威力**不写进表** | 表里只填「品质 + 境界」，威力由 `品质基础威力 × 境界倍率 × 3` 算出（见 `data/gongfa-power.ts`）。调平衡只需改品质或境界**这一个点** |
| 脏数据**进不来** | 导入前做三层校验：单表字段范围 → 跨表引用（功法 id 是否存在）→ 站位唯一性。不通过就不写盘，并报出「第几行、哪个字段、错在哪」 |

**实测效果**（把剑客攻击力从 320 改成 600，一行代码未改）：

| | 平均回合 | 我方场均输出 | 敌方场均输出 |
|---|:--:|:--:|:--:|
| 320（原） | 4.77 | 2880 | 1777 |
| 600（改表后） | **3.87** | **2994** | **1424** |

## 常用命令

- 首次联网运行 `pnpm install` 安装 Phaser / Vite / Electron。
- 运行 `node --test tests/*.test.ts` 执行核心逻辑测试（零依赖，可随时跑）。
- 运行 `node tools/preview/make-preview.ts` 生成骨架预览 `preview/rig-preview.html`。
- 运行 `pnpm art:placeholder` 生成一整套**合规的占位贴图与战斗背景**（**默认不覆盖你画好的图**；要重生成加 `--force`）。
- 运行 `pnpm skin:gen` 扫描 `assets/` 并生成/校验 `skin.json`（缺件、尺寸、枢轴画错都会报出来，且**报错不写盘**）。
- 运行 `pnpm skin:check` 只校验不写盘（CI 用）。
- 运行 `pnpm skin:templates` 生成**枢轴对位模板**（4× 放大，粉色十字 = 关节必须落的位置）。
- 运行 `pnpm skin:fit <原始图或目录> --slot=<slot> --char=<角色id>` 把 AI 生图**自动抠底、裁边、缩放并对准关节**；只画了一部分也能用（声明 `art` 后其余部件继承底图）。
- 运行 `pnpm gen:motions` 重新生成动作库（**默认不覆盖已有文件**，保护手工调整过的动作）。
- 运行 `pnpm gen:motions:force` 强制重新生成全部动作（会覆盖手工调整）。
- 运行 `pnpm dev` 启动开发服务器（需先 install）。

## 上手路径（美术）

1. 读 [`docs/rig-spec.md`](docs/rig-spec.md)（骨架与部件规范）与 [`docs/asset-pipeline.md`](docs/asset-pipeline.md)（操作手册）
2. **先跑 `pnpm art:placeholder` 生成一套占位贴图**，用图片查看器打开对着看尺寸与枢轴
3. 按 §4 画布尺寸与 §2 slot 清单，产出角色的 17 个部件（`cloak` / `weapon` 可选）
4. 命名严格等于 slot 名，**同名覆盖** `assets/chars/<charId>/parts/<slot>.png`
5. 跑 `pnpm skin:gen` —— 缺件 / 尺寸错 / 枢轴错会直接告诉你是哪一张、应该是多少
6. 浏览器刷新看效果（Vite 热更新，不用重启）

战斗背景同理：同名覆盖 `assets/bg/battle/{far,mid,ground}.png` 后刷新即可。

> 骨架与动作数据已冻结，**美术可以并行开工，不需要等程序**。
> 贴图缺失时程序会**自动回退成色块占位** —— 画到一半也能随时跑起来看。
