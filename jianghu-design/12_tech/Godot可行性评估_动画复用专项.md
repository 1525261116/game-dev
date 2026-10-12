# Godot 能否解决「一套武学动画 × 多角色」——可行性评估

> 日期：2026-10-11｜问题来源：[动画复用方案](动画复用方案_v1.0.md)、[技术架构综合比较](技术架构综合比较_v1.0.md)
> 结论先行：**能，而且在这个专项上 Godot 比 Phaser 更原生；但它会拆掉我们赖以工作的 AI 验证闭环。**

---

## 1. 直接回答

| 问题 | 答案 |
|------|------|
| Godot 能解决"一套动画多角色复用"吗？ | **能，而且是原生能力**，比我们在 Phaser 里自研 cutout 更省事 |
| 那该换吗？ | **不建议现在换**——但这不是因为 Godot 差，而是因为我实测**在这个环境里完全无法运行 Godot**（见 §4） |
| 有没有折中？ | **有**：花 1~2 天做一个"2 个角色共用一套动画"的 Godot 最小验证（见 §7），用实测代替争论 |

---

## 2. Godot 的原生机制（4 条，逐条对上你的诉求）

### 2.1 Skeleton2D + Bone2D + Polygon2D —— 2D 骨骼是引擎一等公民

Godot 有官方的 **2D 骨架（2D skeletons）** 教程模块（[官方文档 · 2D 骨架](https://docs.godotengine.org/zh-tw/4.x/tutorials/animation/2d_skeletons.html)），
以及官方文章专门介绍 **「Godot gets 2D skeletal deform」**——即 **Polygon2D 绑定骨骼权重做形变**（[官方文章](https://godotengine.org/article/godot-gets-2d-skeletal-deform/#4-setup-polygon-for-painting)）。

**对我们的意义**：我们的方案 C 是"部件刚性跟随骨骼"（关节处靠重叠 8~12px 遮缝），
而 Godot 能做**蒙皮形变**——布料/衣摆/头发可以真正变形，不会有关节缝。**这是能力上的真实差距。**

### 2.2 SpriteFrames / AnimationLibrary 资源可共享 —— **这就是"一套动画多角色"**

Godot 的动画是**资源（Resource）**：
- `AnimationPlayer` 的动画可抽成 **`AnimationLibrary`** 资源（[提案与实现](https://github.com/godotengine/godot-proposals/issues/4296)），**跨场景、跨角色共享**；
- `AnimatedSprite2D` 用 **`SpriteFrames`** 资源，动画按**名字**索引（`idle` / `attack` / `cast`）；
- 每个角色只需给出**自己的贴图**，动画定义完全复用 → **同一套 `SpriteFrames`，N 套贴图 = N 个角色**。

**这正好是我们手写 `Rig` + `skin.json` 想达到的效果，而 Godot 是内建的。**

### 2.3 骨骼重定向（Retargeting）—— 不同骨架之间转移动画

Godot 有 `SkeletonProfile` 类与官方的**骨架重定向**文档（[SkeletonProfile 类](https://docs.godotengine.org/en/4.2/classes/class_skeletonprofile.html)、[3D 骨架重定向](https://docs.godotengine.org/uk/4.3/tutorials/assets_pipeline/retargeting_3d_skeletons.html)）。
⚠️ **2D 侧的重定向（`SkeletonProfileHumanoid2D`）我未能核实**——`web_fetch` 被沙箱拦截，只搜到 3D 的官方文档。**这条请你确认**。

> 如果 2D 重定向确实存在，那它意味着：**哪怕两个角色的骨架比例不同，动画也能自动适配**——这正是"不同人物用同一套武学动画"的终极形态。

### 2.4 动画面板之外，`.tres` / `.tscn` 是**纯文本**

Godot 的场景与资源文件是文本格式，AI 可以直接读写。**这一点对 vibe coding 是加分项**（比 Unity 的二进制/编辑器产物好得多）。

---

## 3. 专项对比：Phaser 自研 cutout vs Godot 原生

| 能力 | 我们已实现的 Phaser cutout | Godot 原生 | 谁赢 |
|------|---------------------------|-----------|:----:|
| 一骨架 + 多皮肤 | ✅ 已实现（17 slot / skin.json） | ✅ 内建（Skeleton2D + 多贴图） | 平 |
| 动画数据可 AI 生成 | ✅ JSON 时间轴 | ✅ `.tres` 文本 | 平 |
| **关节处形变（蒙皮）** | ❌ 只能靠部件重叠遮缝 | ✅ **skeletal deform** | **Godot** |
| 动画混合 / 状态机 | ❌ 需自研 | ✅ **AnimationTree / BlendSpace2D** | **Godot** |
| 2D 骨架重定向 | ❌ 无 | ⚠️ 待核实（3D 有） | Godot（若属实） |
| 动画编辑器 | ❌ 需我另写浏览器编辑器 | ✅ **编辑器内建**（但我无法操作 GUI） | 分裂 |
| UI 系统 | ⚠️ 弱，需 **rexUI** 补 | ✅ **Control 节点原生强** | **Godot** |
| 移动端性能 | ⚠️ WebView 有天花板 | ✅ 原生 | **Godot** |
| 包体 | ✅ 小 | ✅ 小 | 平 |
| Steam | ✅ Electron/Tauri + steamworks.js | ✅ **GodotSteam GDExtension**（[官方 Asset Store](https://store.godotengine.org/asset/godotsteam/godotsteam-gdextension/)） | 平 |
| 一键部署多端 | ⚠️ 需自建 | ✅ **官方 one-click deploy**（[文档](https://docs.godotengine.org/zh-tw/4.5/tutorials/export/one-click_deploy.html)） | **Godot** |
| 主机 | ❌ 无路径 | ⚠️ 需第三方移植商 | Godot |
| **AI 能否自己跑起来验证** | ✅ **60 个测试 + 无头截图，已实测可用** | ❌ **实测完全不可用**（见 §4） | **Phaser** |
| AI 语料与生成质量 | ✅ JS/TS 语料第一 | ⚠️ GDScript 语料少（业界已在专门评测"最好的 GDScript LLM"，[参考](https://www.summerengine.com/blog/best-llm-for-godot)） | **Phaser** |

**读表结论**：**产品能力上 Godot 全面领先；工作方式上 Phaser 全面领先。** 这是一次典型的交换，而不是谁对谁错。

---

## 4. ⚠️ 决定性事实：我在这个环境里**完全无法使用 Godot**

**刚才的实测**：

```
=== 本机是否已安装 Godot ===
未安装                              ← /Applications、~/Applications、PATH 全无
=== 能否下载 ===
https://godotengine.org                     → 000
https://github.com/.../Godot_v4.4-...zip    → 000
=== 能否用 brew 安装 ===
无 brew
```

**这意味着**：

| 我现在能对 Phaser 做的事 | 换成 Godot 后 |
|---------------------------|---------------|
| `node --test` 跑 60 个测试（零依赖） | ❌ 需要 Godot 二进制，装不了 |
| 无头 Chrome 截图验证画面 | ⚠️ Godot `--headless` **不渲染**，截图需要真实显示上下文，且引擎都没有 |
| 用 Node 直接生成动作数据并预览 | ❌ GDScript 需要 Godot 运行时 |
| 改一行 → 立刻看到结果 | ❌ 只能你自己开编辑器看 |

**并且你本人也无法用我给的方式安装**：这台机器没有 brew、没有 Godot，而我的网络被限制。
**要换 Godot，第一步必须是你手动下载安装**（约 100MB，官网直下）。

> 这条不是"Godot 不好"，而是**我们这套"AI 写代码 + 自动验证"的工作流会当场断裂**。
> 而它正是当初选 Phaser 的**唯一决定性理由**。

---

## 5. 迁移成本：如果换，什么会丢、什么能留

### 5.1 能完整保留（与引擎无关）

| 资产 | 说明 |
|------|------|
| **17 slot 骨架规范** | 纯设计约定，直接搬到 Godot 的 Bone2D 命名 |
| **3 套体型参数** | 骨长/缩放数据 |
| **56 clip 动作规划 + 动作原型表** | 设计层 |
| **87 门功法表现映射表** | `gongfa_visual.ts` → 一行行数据，可导出为 Godot 资源 |
| **12 阵法 / 22 状态 / 编队系数** | 纯数值 + 纯逻辑，可移植 |
| **JSON 时间轴动作数据格式** | 可写一个导出器转成 Godot `Animation` 资源 |
| GDD 全部策划内容 | 与引擎完全无关 |

### 5.2 会丢（需要重写）

| 资产 | 规模 | 说明 |
|------|:----:|------|
| 动画运行时（`Rig`/`MotionPlayer`/`SkinRegistry`/`Vfx`） | ~800 行 TS | Godot 用原生替代，**但这块其实不用重写，是删掉** |
| **测试与验证闭环** | 60 个测试 | 需重建为 GDScript 测试（`--headless --script` 可能可行，待实测） |
| **无头截图验证** | 已跑通 | 需重建；有社区方案 `mrf/godot-stagehand`（含 `visual-smoke-contract.md`，[GitHub](https://github.com/mrf/godot-stagehand/blob/main/docs/visual-smoke-contract.md)）待核实 |
| 时间轴编辑器（尚未做） | 计划 1,200 行 | Godot 编辑器内建，不需要了 |

**净结论**：**代码层面迁移成本不高**（我们只写了 1 个 Sprint 的动画内核，且大部分会被 Godot 原生替代）；
**真正的成本是"验证闭环"要从零重建**，而这件事能否成功**在这个环境里未知**。

---

## 6. 什么情况下该换 / 不该换

### ✅ 该换 Godot 的情况（任一成立）

1. 你能接受**自己开编辑器看效果**，不再依赖我自动截图验证；
2. 你要**蒙皮形变**（衣摆/头发真变形）——这是 Phaser cutout 做不到的；
3. 你把**移动端原生性能**放在第一位（WebView 天花板是真实风险）；
4. 你需要 **Godot 原生 UI**（Control 节点）而不是 rexUI；
5. 你打算未来上**主机**。

### ❌ 不该换的情况（任一成立）

1. 你希望**我用"写代码 → 跑测试 → 截图给你看"的闭环**推进（这是目前最高效的部分）；
2. 你的动画需求是**剪纸/皮影式刚性部件**——我们能达到的效果与 Godot 差别不大；
3. 你不想在装引擎、配导出模板、重建测试上再花 1~2 周；
4. 你担心 GDScript 的 **AI 生成质量**（语料远少于 TS，幻觉率更高，且我无法用类型系统兜底到同样程度）。

---

## 7. ★ 建议：用 1~2 天做一次"实测"，而不是继续争论

**这个问题的答案不该由我拍板，而该由一次实验给出。**

### 实验设计

| 步 | 谁做 | 内容 | 耗时 |
|:-:|------|------|:----:|
| 1 | **你** | 从官网下载安装 Godot 4.x（约 100MB，macOS 版免安装） | 5 分钟 |
| 2 | 我 | 写一个最小 Godot 工程：**2 个角色共用同一套 `idle`/`attack` 动画**（Skeleton2D + 两套贴图） | 半天 |
| 3 | 我 | 尝试 `godot --headless --script tests.gd` 跑逻辑测试 | 半天 |
| 4 | 我 | 尝试用脚本渲染并保存 PNG（`get_viewport().get_texture().get_image().save_png()`） | 半天 |
| 5 | 双方 | **看结论**：如果 3、4 都成功 → Godot 的短板被补上，值得认真考虑切换 | — |

### 判定标准

| 实验结果 | 结论 |
|----------|------|
| 逻辑测试 ✅ + 截图 ✅ | **Godot 反超**：产品能力更强且验证闭环可用 → 建议切换 |
| 逻辑测试 ✅ + 截图 ❌ | 可接受：我写代码 + 跑测试，画面你看 → 可切换 |
| 逻辑测试 ❌ | **不建议切换**：回到"我盲写、你验证"的低效模式 |

### 无论结果如何都不浪费

§5.1 列出的**全部设计资产（骨架规范 / 动作规划 / 功法映射 / 阵法状态数值 / GDD）100% 可移植**。
这一天的实验成本，换的是一个确定答案。

---

## 8. 我的倾向（说清楚立场）

> **如果只看"能不能解决动画复用"，Godot 是更好的答案——它是原生的，我们是自研的。**
> **但你现在问我"能不能解决这个问题"，我的回答必须先过一关：我在这个环境里连 Godot 都跑不起来。**
>
> 所以我的建议是：**先花 1~2 天做 §7 的实验**。
> - 实验通过 → 我支持换 Godot（产品能力确实更强，而且我们损失很小）
> - 实验失败 → 继续 Phaser（我们的 cutout 已经跑通，60 个测试全绿，复现了 Godot 的核心收益）

---

## 9. 引用

> ⚠️ `web_fetch` 被沙箱拦截，以下均为"页面已定位、正文未逐字核验"级。

1. Godot 官方文档 · 2D 骨架 — <https://docs.godotengine.org/zh-tw/4.x/tutorials/animation/2d_skeletons.html>
2. Godot 官方文章 · Godot gets 2D skeletal deform — <https://godotengine.org/article/godot-gets-2d-skeletal-deform/#4-setup-polygon-for-painting>
3. Godot 官方文档 · SkeletonProfile 类 — <https://docs.godotengine.org/en/4.2/classes/class_skeletonprofile.html>
4. Godot 官方文档 · 骨架重定向（3D） — <https://docs.godotengine.org/uk/4.3/tutorials/assets_pipeline/retargeting_3d_skeletons.html>
5. Godot 官方文档 · 一键部署 — <https://docs.godotengine.org/zh-tw/4.5/tutorials/export/one-click_deploy.html>
6. GodotSteam GDExtension（官方 Asset Store） — <https://store.godotengine.org/asset/godotsteam/godotsteam-gdextension/>
7. GodotSteam 文档 · 成就/排行榜 — <https://godotsteam.com/classes/user_stats/>
8. godot-proposals #4296 · AnimationLibrary 资源与导入器 — <https://github.com/godotengine/godot-proposals/issues/4296>
9. godot #85602 · AnimationTree 与继承场景的 AnimationLibrary 重复问题 — <https://github.com/godotengine/godot/issues/85602>
10. mrf/godot-stagehand · 视觉冒烟测试契约 — <https://github.com/mrf/godot-stagehand/blob/main/docs/visual-smoke-contract.md>
11. The Best LLM for GDScript in 2026 — <https://www.summerengine.com/blog/best-llm-for-godot>
12. Phaser vs Godot for 2D Games（2025 对比） — <https://generalistprogrammer.com/tutorials/phaser-vs-godot-2d-games>
13. Playgama · Phaser / Godot / Unity 网页游戏对比 — <https://playgama.com/blog/business-faqs/how-do-phaser-godot-and-unity-compare-for-web-game-projects/>
14. CG Channel · Godot 4.3 五大艺术相关特性 — <https://www.cgchannel.com/2024/08/5-key-features-for-cg-artists-in-godot-4-3/>

---

> 本文为技术可行性评估。**§7 的实验结论出来之前，不建议切换引擎。**
