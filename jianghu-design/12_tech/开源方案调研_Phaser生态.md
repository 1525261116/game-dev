# Phaser 生态开源方案调研（针对本项目的 7 个具体问题）

> 日期：2026-10-11｜关联：[技术方案与执行计划 v1.1](技术方案与执行计划_v1.1.md)｜[动画复用方案](动画复用方案_v1.0.md)

---

## 0. 先说实话：我能做到什么、做不到什么

**做不到**（已实测）：

| 目标 | 实测结果 |
|------|----------|
| `https://github.com` | 000（DNS 黑洞） |
| `https://api.github.com` | 000 |
| `https://raw.githubusercontent.com` | 000 |
| `git ls-remote https://github.com/…` | `SSL_ERROR_SYSCALL` |

**所以本文的性质是**：通过搜索**定位到仓库**（名称 + 简介 + 部分文件路径），
**但我无法克隆、无法读源码、无法核实 star 数 / 最后提交时间 / 许可证 / 是否归档**。

因此下表每条都标了证据等级：

| 标记 | 含义 |
|:----:|------|
| ✅ | **官方仓库**（组织名即引擎/作者官方），可信度最高 |
| 🟢 | 搜索命中且**名称+简介语义明确**，多来源交叉出现 |
| 🟡 | 单次命中，需你核实 |

**你一条命令就能核实全部**（见 §5）。

---

## 1. 结论速览：你的 7 个问题 → 现成方案

| # | 你的问题 | 现成方案 | 采用方式 |
|:-:|----------|----------|----------|
| 1 | 工程脚手架（TS + Vite） | `phaserjs/template-vite-ts` ✅ | **直接用**（官方模板） |
| 2 | **一套武学动画 × 多角色复用** | Spine 官方 `mix-and-match` 示例 🟢 + **LPC 纸娃娃生成器** 🟢 | **参考架构 + 解决占位美术**（见 §2.1） |
| 3 | 重 UI 的 RPG（几十个面板） | `rexrainbow/phaser3-rex-notes`（rexUI） 🟢 | **直接用**（省几千行 UI 代码） |
| 4 | 2.5D 斜视角 | `FelipeIzolan/phaser-isometric-engine` 🟢 | 参考/直接用 |
| 5 | 移动端 + PC 打包 | `phaserjs/editor-starter-template-capacitorjs` ✅（移动）、`phaserjs/template-tauri` ✅（PC） | **直接用**（官方模板） |
| 6 | 数据驱动配置 / 存档迁移 | Phaser 官方「load assets via JSON」✅ + 自研 zod 校验 | 混合 |
| 7 | 回合制/战术战斗参考 | `rootasjey/backwards` 🟢、`Ssj400/wek-fighters` 🟢、**`parhelia512/jynew`**（金庸群侠传 3D 重制版）🟢 | **参考设计** |

> **最值钱的两条**：**#2 的 LPC 纸娃娃**（能立刻解决"没有美术就无法验证"）与 **#3 的 rexUI**（能省掉整个 UI 层）。详见 §2。

---

## 2. 逐项详述

### 2.1 ★ 核心问题：一套动画 × 多角色（你的原始诉求）

#### (a) `EsotericSoftware/spine-runtimes` 的 **mix-and-match** 示例 🟢

命中的具体文件路径：
`spine-runtimes/spine-ts/spine-canvaskit/example/**mix-and-match.html**`
（[仓库文件](https://github.com/EsotericSoftware/spine-runtimes/blob/32f43fbf5daca6658bb1b629c6061713dc6d4144/spine-ts/spine-canvaskit/example/mix-and-match.html)）

**为什么这条最重要**：它的名字就是你要的东西——**mix and match（混搭）**，即
「**同一副骨架 + 多套 skin 部件 → 组合出不同角色**」。
官方还有 `spine_skeleton_set_scale` 等 API 与 skins 工作流（[Spine 官方论坛：Skins for Template](https://vi.esotericsoftware.com/forum/d/29845-help-regarding-skins-for-template/2)、[角色自定义](https://hr.esotericsoftware.com/forum/d/30235-advice-on-best-way-to-setup-character-customiser/5)）。

**对我们的意义**：
- ✅ **架构验证**：这正是我们方案 C 已经实现的模型（17 slot + skin.json + 共用动作）。
- ✅ **可直接借鉴的工程约定**：① slot 名固定 ② skin 只换贴图 ③ 混搭组合由数据驱动。
- ❌ **不建议引入 Spine 本体**：商业授权 + GUI 编辑器（我无法操作，会破坏 vibe coding 闭环）。
- 📌 **行动**：把它的 skin 数据组织方式拿来对照我们的 `skin.json`（**你可能只需要它的一个约定，而不是它的引擎**）。

#### (b) ★★ `sanderfrenken/Universal-LPC-Spritesheet-Character-Generator` 🟢

（[GitHub](https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator)、v2 版：[lpc-spritesheet-generator-v2](https://github.com/sanderfrenken/lpc-spritesheet-generator-v2)）

**这是什么**：基于 **LPC（Liberated Pixel Cup，开源美术资产集）** 的**分层纸娃娃角色生成器**——
把角色拆成图层（身体/头发/衣服/武器…），按组合生成精灵图，**可生成上千种外观**。

**它能直接解决你的两个问题**：

| 问题 | LPC 怎么解决 |
|------|--------------|
| **"没有美术，骨架动起来也看不出效果"** | LPC 资产是**开源免费**的，可直接当**占位美术**：立刻让剪纸小人变成"有手有脚有衣服"的角色，验证观感 |
| **"换肤管线对不对"** | 它的"分层部件 → 组合"与我们 `skin.json` 模型**同构**，可直接对照甚至复用其图层规范 |

**配套**：`ivopc/phaser-lpc-character`（[GitHub](https://github.com/ivopc/phaser-lpc-character)）——
**把 LPC 精灵图用在 Phaser 3 里**的现成实现。另有 `fralonra/paperdoll`（[2D 纸娃娃模型](https://github.com/fralonra/paperdoll)）。

> ⚠️ **许可证提醒**：LPC 资产多为 CC-BY-SA / GPL 类，**商用需按各资产署名并可能需同样开源**。
> 因此**建议只用作开发期占位与观感验证，不用于最终发行**（或严格逐条核对授权）。

#### (c) 结论：你的动画复用方案**不需要换技术路线**

自研 cutout 已跑通（17 slot / 3 体型 / 56 clip 计划 / 9.7× 复用率）。
开源的收获是三条：**架构被验证**、**占位美术有来源**、**skin 数据约定可对照**。

---

### 2.2 ★ 重 UI：`rexrainbow/phaser3-rex-notes`（rexUI）🟢

（[文档站](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/ui-label/)、GitHub `rexrainbow/phaser3-rex-notes`）

**为什么对你特别重要**：本作是**重 UI 的 RPG**——装备/功法/门派/任务/图鉴/商店/好感…几十个面板。
Phaser 原生 UI 很弱（这是它相对 Unity 的最大短板）。**rexUI 补齐了这一块**：
文本/标签、按钮、对话框、列表、表格、滚动、Tabs、网格、进度条、滑动条、开关、颜色选择、DOM 元素等。

**采用方式**：`npm i phaser3-rex-plugins`，按需引入（支持 tree-shaking 式的单文件引入）。
**价值估算**：**至少省掉 2,000~4,000 行自研 UI 代码**，且我能在无头浏览器里截图验证。

> 同类可选：`phaser3-rex-notes` 是生态里事实标准，基本没有同等体量的替代品。

---

### 2.3 等距 2.5D：`FelipeIzolan/phaser-isometric-engine` 🟢

（[GitHub](https://github.com/FelipeIzolan/phaser-isometric-engine) — "grid-based" 等距引擎）

**解决什么**：等距坐标转换、网格绘制、深度排序——正是我在 GDD 里让你自研的那部分。
**采用方式**：**对照实现**或直接依赖。即使不用，也可拿它验证我们的投影公式与渲染层级是否一致。
**注意**：我们的战斗是"九宫格 UI 层 + 场景斜视角"，**等距主要用在场景，不在战斗**——所以它不是关键路径。

配套：`grid-engine`（[npm](https://www.npmjs.com/package/grid-engine)）—— 网格移动 + 寻路（**注意：我们明确不做自动寻路**，所以只借鉴其网格坐标/动画同步部分）。

---

### 2.4 ✅ 多端打包：**官方模板**（这条最省事，直接用）

| 目标 | 官方仓库 | 说明 |
|------|----------|------|
| 移动 iOS/Android | `phaserjs/editor-starter-template-capacitorjs` ✅（[GitHub](https://github.com/phaserjs/editor-starter-template-capacitorjs)） | Phaser 官方 + CapacitorJS 的原生壳模板 |
| PC 桌面 | `phaserjs/template-tauri` ✅（[GitHub](https://github.com/phaserjs/template-tauri)） | **官方 Tauri 模板**（比 Electron 体积小得多） |
| 社区 Tauri 版 | `furuTra/template-phaser-tauri` 🟢 | 备选参考 |
| Steam 上架流程 | [DEV: Publish your Web Game to Steam using Electron](https://dev.to/jacklehamster/publish-your-web-game-to-steam-using-electron-670)、[Gamedev.js](https://gamedev.js.com/tutorials/publishing-web-games-on-steam-with-electron/) | 实操文章 |

> 📌 **决策更新建议**：原计划 PC 用 **Electron**，但官方已有 **Tauri 模板** → 我更推荐 **Tauri**（包体小一个量级，Steam 上同样可行）。**这条需要你确认（见 §4）**。

---

### 2.5 数据驱动与存档

| 需求 | 方案 |
|------|------|
| 资源/配置按 JSON 批量加载 | Phaser 官方教程 [How to load assets via JSON](https://phaser.io/news/2024/07/how-to-load-assets-via-json) ✅ |
| 运行时配置校验 | 自研 + **zod**（我们已定） |
| 存档版本化与迁移 | 参考 [Phaser 存档迁移与版本化：从 LocalStorage 到可恢复数据管线](https://plumephp.com/phaser-save-migration-versioning-2026/) 🟡（思路与我们 GDD 2.13 一致） |
| 数据驱动讨论 | [StackOverflow: Data driven game with Phaser 3](https://stackoverflow.com/questions/67992580/data-driven-game-with-phaser-3) 🟡 |

---

### 2.6 回合制战斗与 RPG 参考（**作品/设计参考，不是库**）

| 仓库 | 价值 |
|------|------|
| `rootasjey/backwards` 🟢（[GitHub](https://github.com/rootasjey/backwards)） | "A turn-based game system built with phaser" —— **回合制战斗系统的现成结构参考** |
| `Ssj400/wek-fighters` 🟢（[GitHub](https://github.com/Ssj400/wek-fighters)） | 回合制 + **Phaser 3 + TypeScript** —— 技术栈完全一致，可直接对照代码组织 |
| ★ `parhelia512/jynew` 🟢（[GitHub](https://github.com/parhelia512/jynew)） | **金庸群侠传 3D 重制版**：武侠 RPG 框架，**带完整 Modding 支持 + 10 小时可玩 Demo**。同类题材里最完整的开源工程 |
| `mimikim/harvest-moon-phaser3-game` 🟢（[GitHub](https://github.com/mimikim/harvest-moon-phaser3-game)） | Phaser 3 俯视角 RPG（含种田/经营要素，与本作"门派经营"有相通处） |
| `chongdashu/phaserjs-tinyswords` 🟢（[GitHub](https://github.com/chongdashu/phaserjs-tinyswords)） | 完整 Phaser 3 小游戏范例（战斗 + 建造），工程组织可参考 |
| `sarvex/phaser3-examples` 🟢（[GitHub](https://github.com/sarvex/phaser3-examples)） | Phaser 3 官方示例的镜像（labs.phaser.io 的源码） |

> ⚠️ `jynew` 是 **Unity/C# 3D** 方向 —— **参考它的系统设计（武学/门派/事件），不要参考代码**。

---

### 2.7 ECS（可选，暂不建议）

`bitECS` + Phaser 的示例：`officialyenum/tank-wars` 🟢、`ourcade/phaser3-matterjs-bitecs` 🟢（[Ecosyste.ms](https://repos.ecosyste.ms/hosts/GitHub/topics/matter-js)）。

**我的建议：暂不引入 ECS**。我们的战斗是"预结算 + 表现回放"的纯函数模型，**比 ECS 更简单、更好测**；
引入 ECS 会与 GDD 5.4 的确定性要求产生额外复杂度。等系统规模真的爆炸再评估。

---

## 3. 最重要的三条判断

1. **你的动画复用方案不需要换路线。** Spine 的 `mix-and-match` 与 LPC 纸娃娃都证明「**一副骨架 + 多套皮肤**」是行业标准做法——我们已经在做同一件事，且不需要买 Spine 授权、不需要 GUI 编辑器（对 AI 协作更友好）。
2. **真正能立刻解决问题的是 LPC**：它给你**免费的开源部件资产**，让你在自研美术到位前就能看到"有衣服有武器的角色在挥刀"。**这是本轮调研最实用的发现。**
3. **UI 不要自研**：rexUI 能省几千行，而 UI 是本作最大的工程量之一（几十个面板）。

---

## 4. 需要你确认的 1 个决策

| # | 决策 | 我的建议 | 备选 |
|:-:|------|----------|------|
| **E1** | PC 打包用 **Tauri** 还是 Electron | ✅ **改用 Tauri**（官方模板已存在，包体小一个量级，Steam 同样可行） | 保持 Electron（生态更熟，Steamworks 集成资料更多） |

> 说明：Tauri 用**系统 WebView**（Windows 上是 WebView2/Chromium，macOS 是 WKWebView），包体可小到几 MB；
> Electron 自带 Chromium（约 80~150MB）。代价是 Tauri 的 Steam 集成资料少于 Electron。**两者都可行，你选。**

---

## 5. 你来核实（我给现成命令）

GitHub 在我这边不可达，但在你机器上一条命令即可核实全部：

**第一步 · 仓库清单**（共 16 个，逐一核实）：

| # | 仓库 | # | 仓库 |
|:-:|------|:-:|------|
| 1 | `phaserjs/template-vite-ts` | 9 | `fralonra/paperdoll` |
| 2 | `phaserjs/template-tauri` | 10 | `EsotericSoftware/spine-runtimes` |
| 3 | `phaserjs/editor-starter-template-capacitorjs` | 11 | `rootasjey/backwards` |
| 4 | `rexrainbow/phaser3-rex-notes` | 12 | `Ssj400/wek-fighters` |
| 5 | `FelipeIzolan/phaser-isometric-engine` | 13 | `parhelia512/jynew` |
| 6 | `sanderfrenken/Universal-LPC-Spritesheet-Character-Generator` | 14 | `mimikim/harvest-moon-phaser3-game` |
| 7 | `sanderfrenken/lpc-spritesheet-generator-v2` | 15 | `chongdashu/phaserjs-tinyswords` |
| 8 | `ivopc/phaser-lpc-character` | 16 | `sarvex/phaser3-examples` |

**第二步 · 逐仓库取字段**：对上面每一个仓库，用 `curl` 静默请求 GitHub 仓库接口 `https://api.github.com/repos/<所属者>/<仓库名>`，再用 `jq` 抽出五个字段——仓库全名、星标数、最后推送日期（取前 10 位）、许可证编号（缺失时记为 `NO-LICENSE`）、是否归档（`archived`），输出为一行一个仓库的制表符分隔文本；请求失败的行打印该仓库名并标注「查询失败」。

**重点看三列**：`pushed_at`（是否还在维护）、`license`（能否商用）、`archived`（是否已归档停更）。
把输出贴给我，我据此筛掉死项目、锁定最终集成清单。

更详细的清单页也可参考：<https://repos.ecosyste.ms/hosts/GitHub/topics/phaserjs>（Phaser 主题仓库聚合）

---

## 6. 引用

> ⚠️ 全部为"页面已定位、正文未逐字核验"级。

**官方模板与示例**
1. phaserjs/template-vite-ts — <https://github.com/phaserjs/template-vite-ts>
2. phaserjs/template-tauri — <https://github.com/phaserjs/template-tauri>
3. phaserjs/editor-starter-template-capacitorjs — <https://github.com/phaserjs/editor-starter-template-capacitorjs>
4. phaserjs/template-vue-ts — <https://github.com/phaserjs/template-vue-ts>
5. sarvex/phaser3-examples（官方示例镜像） — <https://github.com/sarvex/phaser3-examples>
6. Phaser 官方 GitHub 社区页 — <https://www.phaser.io/community/github>
7. furuTra/template-phaser-tauri — <https://github.com/furuTra/template-phaser-tauri>

**动画 / 换肤 / 纸娃娃（核心）**
8. Spone runtimes · mix-and-match 示例 — <https://github.com/EsotericSoftware/spine-runtimes/blob/32f43fbf5daca6658bb1b629c6061713dc6d4144/spine-ts/spine-canvaskit/example/mix-and-match.html>
9. Spine 官方论坛 · Skins for Template — <https://vi.esotericsoftware.com/forum/d/29845-help-regarding-skins-for-template/2>
10. Spine 官方论坛 · 角色自定义 setup — <https://hr.esotericsoftware.com/forum/d/30235-advice-on-best-way-to-setup-character-customiser/5>
11. sanderfrenken/Universal-LPC-Spritesheet-Character-Generator — <https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator>
12. sanderfrenken/lpc-spritesheet-generator-v2 — <https://github.com/sanderfrenken/lpc-spritesheet-generator-v2>
13. ivopc/phaser-lpc-character — <https://github.com/ivopc/phaser-lpc-character>
14. fralonra/paperdoll — <https://github.com/fralonra/paperdoll>
15. HCPTangHY/CoT-Paperdoll-Mod — <https://github.com/HCPTangHY/CoT-Paperdoll-Mod>
16. Phaser Mesh（网格变形能力参考） — <https://docs.phaser.io/phaser/concepts/gameobjects/mesh>
17. @esotericsoftware/spine-phaser（npm） — <https://www.npmjs.com/package/@esotericsoftware/spine-phaser/v/4.2.24>

**UI / 等距 / 网格**
18. rexrainbow/phaser3-rex-notes（rexUI 文档） — <https://rexrainbow.github.io/phaser3-rex-notes/docs/site/ui-label/>
19. FelipeIzolan/phaser-isometric-engine — <https://github.com/FelipeIzolan/phaser-isometric-engine>
20. grid-engine（npm） — <https://www.npmjs.com/package/grid-engine>

**回合制 / RPG / 武侠参考**
21. rootasjey/backwards（回合制系统） — <https://github.com/rootasjey/backwards>
22. Ssj400/wek-fighters（Phaser3 + TS 回合制） — <https://github.com/Ssj400/wek-fighters>
23. parhelia512/jynew（金庸群侠传 3D 重制版，含 Modding） — <https://github.com/parhelia512/jynew>
24. MUDV587/jynew（同名分支） — <https://github.com/MUDV587/jynew>
25. mimikim/harvest-moon-phaser3-game — <https://github.com/mimikim/harvest-moon-phaser3-game>
26. chongdashu/phaserjs-tinyswords — <https://github.com/chongdashu/phaserjs-tinyswords>
27. ECS 示例 · ourcade/phaser3-matterjs-bitecs — <https://repos.ecosyste.ms/hosts/GitHub/topics/matter-js>
28. ECS 示例 · officialyenum/tank-wars — <https://github.com/officialyenum/tank-wars>

**数据 / 存档 / 打包流程**
29. Phaser 官方 · How to load assets via JSON — <https://phaser.io/news/2024/07/how-to-load-assets-via-json>
30. Phaser 存档迁移与版本化 — <https://plumephp.com/phaser-save-migration-versioning-2026/>
31. StackOverflow · Data driven game with Phaser 3 — <https://stackoverflow.com/questions/67992580/data-driven-game-with-phaser-3>
32. DEV · Publish your Web Game to Steam using Electron — <https://dev.to/jacklehamster/publish-your-web-game-to-steam-using-electron-670>
33. Gamedev.js · Publishing web games on Steam with Electron — <https://gamedev.js.com/tutorials/publishing-web-games-on-steam-with-electron/>

---

> 本文为开源方案调研，**所有条目均需按 §5 的命令核实后再采用**。
