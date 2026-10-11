# 江湖从心 · 游戏开发项目

> 武侠开放世界 + 单机 RPG · 多端支持（移动端 / PC）

## 项目说明

本仓库为《江湖从心》游戏本体开发项目，基于策划案与 GDD 进行游戏程序实现。

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
| **M0 骨架能动** | ✅ **已达成** | 3 体型 / 3 动作 / 33 测试全绿 / 无头截图验证 |

详见 [`docs/sprint-01-report.md`](docs/sprint-01-report.md)

## 目录结构

```
jianghu-game/
├─ docs/
│  ├─ rig-spec.md            # 骨架与部件规范（贴图按此画）
│  └─ sprint-01-report.md    # Sprint-01 报告
├─ src/
│  ├─ core/anim/             # 动画内核（纯逻辑，可 node --test）
│  │  ├─ types.ts            #   slot / clip / 骨架类型（唯一真相）
│  │  ├─ ease.ts             #   5 种缓动
│  │  ├─ skeleton.ts         #   层级求解 / 挂点换算 / 事件区间
│  │  ├─ clip.ts             #   时间轴采样
│  │  └─ validate.ts         #   校验器
│  └─ data/
│     ├─ rigs.ts             # 3 套体型构建器
│     ├─ gongfa_visual.ts    # 87 门功法表现映射
│     └─ motions/*.json      # 动作数据
├─ tests/                    # node --test
├─ tools/
│  ├─ load-json.ts
│  └─ preview/make-preview.ts # 无依赖骨架预览生成器
└─ preview/                  # 预览 HTML + 截图
```

## 常用命令

```bash
pnpm install                 # 首次需联网安装 Phaser / Vite / Electron
node --test tests/*.test.ts  # 核心逻辑测试（零依赖，可随时跑）
node tools/preview/make-preview.ts   # 生成骨架预览 preview/rig-preview.html
pnpm dev                     # 启动开发服务器（需先 install）
```

## 上手路径（美术）

1. 读 [`docs/rig-spec.md`](docs/rig-spec.md)
2. 按 §4 画布尺寸与 §2 slot 清单，产出第 1 个角色的 17 个部件（`cloak` 可选）
3. 命名严格等于 slot 名，放入 `assets/chars/<charId>/parts/`
4. 由 `tools/gen-skin.ts` 自动生成 `skin.json` 并做 slot 完整性校验（待实现）

> 骨架与动作数据已冻结，**美术可以并行开工，不需要等程序**。
