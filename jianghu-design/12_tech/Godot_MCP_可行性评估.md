# Godot + MCP 可行性评估（能否补上"AI 验证闭环"）

> 日期：2026-10-11｜前置：[Godot 可行性评估](Godot可行性评估_动画复用专项.md)
> **结论：路径可行，且这是让 Godot 反超的关键一块拼图。但有 1 个未知点需要你确认后才能实测。**

---

## 0. 为什么这件事重要

上一篇的结论是：

> **Godot 在产品能力上全面领先（原生 2D 骨骼/形变/可共享动画库/原生 UI/移动端性能），
> 但它会拆掉我们在 Phaser 上已经跑通的"AI 写代码 → 自动跑测试 → 截图验证"闭环。**

如果 **Godot MCP** 能让我在你的机器上**启动 Godot、运行工程、读取报错、甚至截图**，
那这条唯一的短板就被补上了 —— **Godot 从"能力更强但没法用"变成"能力更强且能用"**。

---

## 1. ✅ 实测证据：DSH 本身支持 MCP（这是前提）

我在 DSH 的打包文件里找到了完整的 MCP 实现（`strings` 提取，非猜测）：

### 1.1 协议层（支持 4 种传输）

```
"$ref": "#/$defs/McpServerStdio"     ← 本地进程（stdio，最常用）
"$ref": "#/$defs/McpServerHttp"      ← HTTP
"$ref": "#/$defs/McpServerSse"       ← SSE
"$ref": "#/$defs/McpServerAcp"       ← ACP 隧道
McpServer / McpServerAcpId
ConnectMcpRequest / ConnectMcpResponse / DisconnectMcpRequest / DisconnectMcpResponse
MessageMcpRequest / MessageMcpResponse / MessageMcpNotification
```

### 1.2 会话与工具暴露

```
agent.session.new 的参数：{ cwd: "/workspace", mcpServers: [] }   ← 每会话挂载 MCP
...(this.request.mcpServers ?? [])
.withMcpServer(mcpServer)
throw new Error(`Duplicate function name ${mcpToolName} found in MCP tools. ...`)
'sse.event === "agent.mcp_tool_use"' / '"agent.mcp_tool_result"'   ← 工具调用事件
```

**也就是说**：MCP 工具的调用与结果会以事件形式进入会话 —— **我能像调用内置工具一样调用 MCP 工具**。

### 1.3 插件已内置

`~/.dsh/profiles/desktop/cordis.yml` 第 364~365 行：

```yaml
- id: mcp-resources
  name: '@deepseek-ai/dsh-mcp-resources'
```

### 1.4 配置入口已找到

`~/.dsh/profiles/desktop/cordis.patch.yml`，文件头自述：

> "Your patch layer for this dsh profile, applied after every bundle layer:
> a top-level YAML array of loader patch entries (id-targeted config overrides, disables, and insert lists; `!!js` expressions allowed)."

→ **这就是添加/覆盖 MCP 服务器配置的地方。**

> ⚠️ **唯一未知点**：`dsh-mcp-resources` 在基础层里**没有 config 段**，我无法从打包文件反推出它的配置 schema
> （插件源码在 `app.asar` 内，`strings` 只能看到片段）。
> **需要你确认**：DSH 的**设置界面**（有 `ui-settings` / `config-editor` 插件）里是否有 MCP 配置项，或查一下 DSH 文档。
> **把 schema 或截图给我，我立刻能写出准确的 patch 配置。**

---

## 2. Godot MCP 生态（已确认存在且活跃）

| 项目 | 形态 | 特点 | 证据 |
|------|------|------|------|
| **`Sods2/godot-mcp`** | GitHub | "MCP server for **full Godot IDE integration**"；LobeHub 有条目分节 `#run-debug`（运行 + 调试） | 🟢 [GitHub](https://github.com/Sods2/godot-mcp)、[LobeHub](https://lobehub.com/zh-TW/mcp/sods2-godot-mcp#run-debug) |
| **`godot-editor-mcp`** | PyPI，**更新频繁**（2026.9.30 / 9.28 / 9.17 …） | 深度编辑器集成：`godot_scene_edit_reload_scene`、`godot_scene_edit_delete_node` 等场景编辑工具；需要 **Godot bridge 插件**连上（有 "Godot bridge is not connected" 提示） | 🟢 [PyPI](https://pypi.org/project/godot-editor-mcp/) |
| `Coding-Solo/godot-mcp` | GitHub | 社区里出现较早的 Godot MCP 实现 | 🟢 [deps.dev](https://deps.dev/project/github/coding-solo%2fgodot-mcp) |
| `@letsagents/godot-mcp` / `@minirui/godot-mcp` | npm | Node 实现，走 stdio 传输（与 DSH 的 `McpServerStdio` 直接匹配） | 🟢 [npm](https://www.npmjs.com/package/@letsagents/godot-mcp) |

**候选优先级建议**：先用 **`@minirui/godot-mcp` 或 `@letsagents/godot-mcp`（npm/stdio）**——因为 DSH 的 `McpServerStdio` 是最直白的接入方式；`godot-editor-mcp` 能力最强但要额外装 Godot 内插件。

---

## 3. 完整路径与三道门

```
① 装 Godot（你做，约 100MB，5 分钟）
        ↓
② 装 Godot MCP 服务（你做，npm/pip，1 分钟）
        ↓
③ 在 cordis.patch.yml 挂载 MCP（配置 schema 待确认 ⚠️）
        ↓
④ 重启 DSH → 我的工具列表里出现 godot_* 工具
        ↓
⑤ 我写最小工程 → 我启动 Godot → 我读报错 → 我截图 → 闭环成立
```

| 门 | 状态 | 谁做 |
|:-:|------|------|
| ① Godot 安装 | ❌ 未安装，我无法下载（官网/GitHub 均 000，无 brew） | **你** |
| ② MCP 服务安装 | ❌ 我无法 npm/pip（网络受限） | **你** |
| ③ DSH 挂载配置 | ⚠️ **机制已确认，schema 未知** | 你提供信息 → **我写配置** |
| ④⑤ 运行与验证 | 未实测 | **我** |

---

## 4. 如果跑通，收益矩阵会变成这样

| 能力 | 现在（Phaser） | Godot 无 MCP | **Godot + MCP** |
|------|:--------------:|:------------:|:---------------:|
| 我写代码 | ✅ | ✅ | ✅ |
| 我跑逻辑测试 | ✅ 60 个测试（node --test） | ❌ | ✅ `godot --headless --script` |
| 我读运行时/编译报错 | ✅ | ❌ | ✅ MCP 抓 debug 输出 |
| 我截图看画面 | ✅ 无头 Chrome | ❌ | 🔶 **待实测**（取决于 MCP 工具集） |
| 一骨架多角色 | ✅ 自研（已实现） | ✅ **原生** | ✅ **原生** |
| 关节蒙皮形变 | ❌ | ✅ | ✅ |
| 动画混合/状态机 | ❌ 需自研 | ✅ | ✅ |
| 原生 UI | ⚠️ 靠 rexUI | ✅ | ✅ |
| 移动端性能 | ⚠️ WebView 天花板 | ✅ 原生 | ✅ 原生 |
| 一键多端部署 | ⚠️ 自建 | ✅ 官方 | ✅ 官方 |

**若截图那一格也变成 ✅，Godot 就是全面胜出，我会明确建议切换。**

---

## 5. 你要做的三步（可复制）

**第 1 步 · 装 Godot**

```bash
# 到官网下载 macOS 版（免安装，解压即用）
# https://godotengine.org/download/macos/
open ~/Downloads/Godot_v4.*_macos.universal.zip
# 解压后把 Godot.app 拖到「应用程序」，或放任意目录
```

**第 2 步 · 装一个 Godot MCP 服务**

```bash
# 方案 A（推荐先试，Node/stdio，与 DSH 的 McpServerStdio 最匹配）
npx -y @minirui/godot-mcp --help
# 或
npx -y @letsagents/godot-mcp --help

# 方案 B（能力最强，需要额外在 Godot 内装 bridge 插件）
pip install godot-editor-mcp
```

**第 3 步 · 找到 DSH 的 MCP 配置入口**

两种情况：
- **如果有设置界面**：打开 DSH 设置，找 "MCP" / "工具" / "扩展" 分页 → 截图给我
- **如果只能改配置文件**：把下面这条命令的输出贴给我

```bash
grep -n -A3 -B3 "mcp" ~/.dsh/profiles/desktop/cordis.yml
ls ~/.dsh/profiles/desktop/node_modules/@deepseek-ai | grep -i mcp
# 另外看看 DSH 有没有自带文档/示例
find ~/.dsh -maxdepth 3 -iname "*mcp*" 2>/dev/null
```

我拿到信息后，**直接给你写好 `cordis.patch.yml` 的配置**，你贴进去重启即可。

---

## 6. 风险与诚实交代

| # | 风险 | 说明 |
|:-:|------|------|
| 1 | **配置 schema 未知** | 我无法从打包文件反推；这是当前唯一的硬阻塞 |
| 2 | **MCP 服务器质量参差** | 社区项目，可能有 bug；npm 上出现多个同名/镜像包（`@iflow-mcp/*`），**注意别装到李鬼包** |
| 3 | **截图能力不确定** | 多数 Godot MCP 主打"运行 + 读日志 + 改场景"，截图需单独确认 |
| 4 | **多了一层依赖** | MCP 服务 + Godot bridge 插件都可能随版本失效 |
| 5 | **GDScript AI 生成质量** | 语料少于 TS，幻觉率更高；Godot 静态类型能兜一部分，但不如 TS 严格 |
| 6 | **我仍未实测** | 本文全部结论基于**字符串证据 + 搜索结果**，不是跑通的结果 |

---

## 7. 我的建议

> **这件事值得花 1 小时试。**
>
> 理由：它把"Godot 能力更强但用不了"变成"能力更强且能用"。
> 而成本极低——装 Godot + 装一个 npm 包 + 贴一段配置。
>
> **但请按这个顺序走，避免白忙**：
> 1. **先解决第 3 步**（找到 DSH 的 MCP 配置入口 / schema）——这是唯一未知项，不通则后面都是空谈
> 2. 再装 Godot
> 3. 最后挂 MCP，让我实测 `godot --headless` 与截图
>
> **与此同时，Phaser 路线不受影响**：cutout 已跑通、60 个测试全绿、设计资产 100% 可移植。
> **两条路可以并行——你在装环境，我继续推进 Phaser 的下一阶段。** 谁先给出确定结论，就按谁走。

---

## 8. 引用

> ⚠️ `web_fetch` 被沙箱拦截，以下均为"页面已定位、正文未逐字核验"级。

1. Sods2/godot-mcp（full Godot IDE integration） — <https://github.com/Sods2/godot-mcp>
2. LobeHub · godot-mcp（含 run/debug 分节） — <https://lobehub.com/zh-TW/mcp/sods2-godot-mcp#run-debug>
3. godot-editor-mcp（PyPI，场景编辑工具） — <https://pypi.org/project/godot-editor-mcp/>
4. godot-editor-mcp 2026.9.30（Godot bridge 连接提示） — <https://pypi.org/project/godot-editor-mcp/2026.9.30/>
5. Coding-Solo/godot-mcp — <https://deps.dev/project/github/coding-solo%2fgodot-mcp>
6. @letsagents/godot-mcp（npm） — <https://www.npmjs.com/package/@letsagents/godot-mcp>
7. @minirui/godot-mcp（npm） — <https://www.npmjs.com/package/@minirui/godot-mcp>
8. Godot 官方文档 · 2D 骨架 — <https://docs.godotengine.org/zh-tw/4.x/tutorials/animation/2d_skeletons.html>
9. Godot 官方文章 · 2D skeletal deform — <https://godotengine.org/article/godot-gets-2d-skeletal-deform/>
10. GodotSteam GDExtension — <https://store.godotengine.org/asset/godotsteam/godotsteam-gdextension/>

**本机实测证据（非搜索）**：
- DSH 打包文件中存在 `McpServerStdio/Http/Sse/Acp`、`ConnectMcp/DisconnectMcp/MessageMcp` 协议定义与 `agent.mcp_tool_use` 事件
- `~/.dsh/profiles/desktop/cordis.yml:364` 内置插件 `@deepseek-ai/dsh-mcp-resources`
- `~/.dsh/profiles/desktop/cordis.patch.yml` 为用户 patch 层（可做 id 定向的 config 覆盖）

---

> 本文为可行性评估。**第 3 步（配置入口）确认前，不进行引擎切换。**
