# FastPPT

FastPPT 是一个本地优先的 AI 演示文稿工作区。它把 Claude Code、OpenAI Codex、Slidev 实时预览、主题 Skill 和可编辑 PPTX 导出整合到同一套工作流中。

浏览器负责编辑、预览与导出捕获；本地 `fastppt` 命令负责工作区文件、Agent 会话、主题、Skill、MCP、Slidev 进程和 PPTX 转换。

```text
FastPPT Web
    │ HTTP + WebSocket
    ▼
本地 Gateway（127.0.0.1:4317）
    ├── Claude Code / Codex Harness
    ├── Slidev 实时预览
    ├── Theme + Skill 管理
    ├── 工作区文件与 SQLite 状态
    └── Slidewave 可编辑 PPTX 导出
```

## 功能

- 在同一个工作区中让用户和 Agent 编辑 Slidev Markdown。
- 支持 Claude Code 与 OpenAI Codex 会话、审批、恢复和审计。
- 自动安装基础 Skill、主题 Skill 和 MCP 配置。
- 提供内置主题，也可以从现有 PPTX 提取并生成新主题。
- 支持图片、复杂 CSS、背景、透明度、字体嵌入和溢出检查。
- 将浏览器中的 Slidev 页面导出为可继续编辑的 PPTX。
- 所有文件、缓存、导出和运行状态默认保留在本地。

## 使用代码

### 环境要求

- Node.js 22 或更高版本
- pnpm 10（仅源码开发需要）
- 现代浏览器
- Claude Code 或 Codex CLI（只使用对应 Agent 时需要）

### 安装 CLI

全局安装：

```bash
pnpm add --global @fastppt/cli
```

也可以安装到当前项目：

```bash
pnpm add --save-dev @fastppt/cli
pnpm exec fastppt --help
```

安装后，内置主题会同步到 `$HOME/.fastppt/themes`

CLI 升级会刷新内置主题，但不会删除用户导入的额外主题。

### 启动工作区

进入包含 `slides.md` 的目录并启动：

```bash
cd /path/to/your-deck
fastppt start --open
```

也可以在任意目录指定工作区：

```bash
fastppt start --dir /path/to/your-deck
```

默认地址：

- Web：<https://fastppt.vercel.app>
- Gateway：<http://127.0.0.1:4317>
- 健康检查：<http://127.0.0.1:4317/health>
- 完整诊断：<http://127.0.0.1:4317/ready>

### 最小演示文稿

在工作区创建 `slides.md`：

```md
---
theme: slidev-theme-landing
title: FastPPT Demo
---

# 使用 Agent 制作演示文稿

在浏览器中继续编辑、预览并导出 PPTX。

---

## 第二页

- Slidev 实时预览
- Claude Code / Codex 协作
- 可编辑 PPTX 导出
```

然后运行：

```bash
fastppt start --open
```

### CLI 命令

```bash
# 启动当前工作区
fastppt

# 指定工作区、端口并打开 Web
fastppt start --dir ./deck --port 4317 --open

# 查看运行状态
fastppt status --dir ./deck

# 检查主题、Skill、MCP、Slidev、Harness 和导出运行时
fastppt doctor --dir ./deck

# 输出 JSON，便于脚本处理
fastppt status --json
fastppt doctor --json

# 停止当前工作区注册的 Gateway
fastppt stop --dir ./deck
```

查看全部参数：

```bash
fastppt --help
```

### 源码开发

```bash
git clone https://github.com/FastR-D/FastPPT.git
cd FastPPT
pnpm install
pnpm dev --dir ./examples/demo-deck
```

本地开发地址：

- Web：<http://127.0.0.1:4318>
- Gateway：<http://127.0.0.1:4317>

常用检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# 浏览器端到端测试
pnpm --filter @fastppt/e2e test
```

## 目录结构

```text
apps/cli                 可发布的 fastppt 命令
apps/gateway             Fastify 本地服务与任务编排
apps/web                 Vue 3 工作区界面
packages/fastppt-mcp     Agent 使用的 MCP 工具
packages/fastppt-skill   基础 Skill 与托管安装器
packages/harness-claude  Claude Agent SDK 适配器
packages/harness-codex   Codex app-server 适配器
packages/slidev-host     Slidev 预览进程管理
packages/slidewave       DOM 捕获与可编辑 PPTX 转换
packages/theme-registry  主题注册、校验与加载
packages/fonts           浏览器与 PPTX 共用字体
themes/                  内置 Slidev 主题与主题 Skill
examples/                示例工作区
tests/e2e                浏览器端到端测试
```

运行时目录：

```text
$HOME/.fastppt/themes             用户主题目录
<workspace>/.fastppt/runtime      Gateway 连接信息
<workspace>/.fastppt/state        SQLite 状态
<workspace>/.fastppt/exports      PPTX 导出结果
<workspace>/.claude/skills        Claude Skills
<workspace>/.agents/skills        Codex Skills
```

FastPPT 会自动把 `.fastppt/`、`.claude/`、`.codex/`、`.agents/` 和托管 MCP 配置加入工作区 `.gitignore`。

## 参考项目

FastPPT 在以下项目与工作流基础上进行集成、迁移或参考设计：

- [Slidev](https://sli.dev/)：Markdown 演示文稿、Vue 组件、主题与实时预览基础。
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/)：PowerPoint 文件生成基础。
- [Model Context Protocol](https://modelcontextprotocol.io/)：Agent 与 FastPPT 工具之间的标准协议。
- [OpenAI Codex](https://github.com/openai/codex)：Codex CLI 与 app-server 会话能力。
- [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk)：Claude Harness 能力。
- [pptx-renderer](https://github.com/aiden0z/pptx-renderer)：PPTX 解析与渲染实现参考。
- [open-kimi-ppt-skill](https://github.com/Binaryify/open-kimi-ppt-skill)：PPT 生成 Skill、内容组织和设计流程参考。
- `@fastppt/slidewave`：项目内维护的浏览器捕获与可编辑 PPTX 转换分支。

内置主题可能来自不同的上游 Slidev 主题。每个主题的来源、改动和许可证信息记录在对应目录的 `THIRD_PARTY_NOTICES.md` 与 `UPSTREAM_LICENSE` 中。

## 文档索引

| 文档                                                            | 内容                                         |
| --------------------------------------------------------------- | -------------------------------------------- |
| [开发入门](docs/development/getting-started.md)                 | 本地开发、CLI、环境配置与贡献流程            |
| [系统架构](docs/architecture/overview.md)                       | Gateway、Web、Harness、主题、事件与导出边界  |
| [HTTP API](docs/api/http.md)                                    | 健康检查、工作区、会话、主题、预览和导出接口 |
| [FastPPT Skill](packages/fastppt-skill/SKILL.md)                | Agent 制作、检查和导出演示文稿的基础流程     |
| [Slidewave 说明](packages/slidewave/README.md)                  | 浏览器捕获、快照协议与服务端转换入口         |
| [可编辑 PPTX](packages/slidewave/SLIDEV_EDITABLE_PPT.md)        | Slidev 到可编辑 PowerPoint 的转换设计        |
| [pptx-renderer 参考](https://github.com/aiden0z/pptx-renderer)        | PPTX 渲染参考项目                 |
| [Kimi PPT Skill 参考](https://github.com/Binaryify/open-kimi-ppt-skill) | PPT 生成 Skill 参考项目           |

