# FastPPT v1.0.0 产品与工程 Spec

- 文档版本：`v1.0.0`
- 产品版本：`v1.0.0`
- 日期：2026-08-20
- 状态：实现依据
- 适用仓库：<https://github.com/FastR-D/FastPPT>
- 适用分支：`main`

## 0. 文档地位

本文件是 FastPPT `v1.0.0` 的产品、工程和验收依据。旧仓库、旧实现、历史交接说明和历史 Spec 只提供问题背景与可复用资产，不构成兼容要求。它们与本文件冲突时，以本文件为准。

当前正式仓库只完成了主线迁移和目录骨架，不能把旧项目的“已完成”、旧测试结果或旧提交状态直接视为 FastPPT `v1.0.0` 已完成。项目必须在正式仓库中重新实现、重新集成并重新验收。

本文件所称 FastPPT 是一个独立项目，不是 Codex Skill，不依赖 Codex App、Skill、MCP、Harness 或特定聊天宿主才能运行。自然语言指令是 FastPPT 的产品能力之一，不是产品名称，也不是唯一使用方式。

## 1. 不可变决策

以下决策优先级高于旧实现、开发便利和模型建议：

1. 产品名称统一为 **FastPPT**，版本统一为 **`v1.0.0`**。
2. 正式代码、文档、Issue、提交和发布只进入 `FastR-D/FastPPT`。
3. 只开发和维护 `main`，不得派生功能分支、部署分支、版本分支或产品分支。
4. FastPPT `v1.0.0` 必须同时支持本机部署和服务器部署，两种方式共用一套产品代码、领域模型和质量标准。
5. 项目按重新实现处理。旧代码可以逐文件复制、提炼或重写，但旧架构、API、数据库、配置和 UI 均不要求兼容。
6. 源码、配置、测试和文档不得硬编码开发者盘符、用户目录或工作区绝对路径。
7. `v1.0.0` 不建设 PPT 风格包、主题市场、品牌包或可复用风格资产管理系统。
8. `ppt-master` 是上游 PPT 生成与转换内核，不是 FastPPT 的产品形态。其现有目录名不表示 FastPPT 继续开发 Skill。
9. 最终交付是经过检查的 PPTX。快速预览、SVG、页面图片或导出命令成功都不能单独代表交付完成。
10. 禁止用整页位图加文字层冒充原生可编辑 PPTX。无法结构化的复杂局部可以使用已登记的局部位图，并必须披露可编辑边界。

## 2. 仓库、分支与版本规则

### 2.1 正式仓库

```yaml
project: FastPPT
repository: https://github.com/FastR-D/FastPPT
development_branch: main
release_tag: v1.0.0
upstream_repository: https://github.com/hugohe3/ppt-master
upstream_branch: main
upstream_base_commit: a160e776b7faff5d2227d180d0f31c6253056fae
```

远程关系必须保持为：

```text
origin   -> FastR-D/FastPPT
upstream -> hugohe3/ppt-master
```

`upstream` 只用于读取和受控同步，不得推送。旧个人 Fork、旧归档仓库和旧本地工作区均不是提交目标。

### 2.2 单一 main 规则

- 所有 FastPPT 开发直接在 `main` 上进行，保持小步、可审查、可回退的提交。
- 不创建 `feature/*`、`develop`、`release/*`、`local`、`server` 或其他派生分支。
- 本机与服务器差异通过配置、依赖注入和 `deploy/` 下的部署文件表达，不能通过 Git 分支表达。
- 上游同步先读取差异、许可证和测试影响，再在 `main` 上形成独立同步提交。
- 每次推送前运行与改动范围相称的检查；影响生成内核、数据合同或部署方式时必须运行完整回归。
- `v1.0.0` 通过全部发布门后，在已验收的 `main` 提交上创建同名 Tag。

### 2.3 路径可移植性

本地检出位置已经发生迁移，但仓库不得记录迁移前或迁移后的机器绝对路径。所有工具都必须从以下来源确定位置：

1. 仓库根目录动态发现。
2. 当前进程工作目录。
3. 显式环境变量。
4. 部署配置中的挂载点。
5. 数据库或对象存储中的逻辑对象 ID。

仓库内路径统一使用相对仓库根目录的 POSIX 风格表示，例如 `apps/web`、`services/worker`。操作系统路径必须通过标准路径库拼接和规范化，不得手工拼接分隔符。

允许的运行时配置示例：

```dotenv
FASTPPT_DATA_DIR=./var/data
FASTPPT_TEMP_DIR=./var/tmp
FASTPPT_EXPORT_DIR=./var/exports
```

上述值只是仓库相对默认值。部署者可以覆盖，但真实绝对值不得写入源码、提交的配置、日志中的公开字段、浏览器响应、测试快照或文档示例。

### 2.4 版本表达

- 产品界面、文档标题、发布说明、容器标签和 Git Tag 使用 `v1.0.0`。
- 只接受纯 SemVer 的技术字段，例如 `package.json.version`，使用 `1.0.0`；对用户显示时补充 `v` 前缀。
- FastPPT 自有包、API 元信息、导出报告和构建产物必须来自同一个版本源，不得分别硬编码。
- API 命名空间固定为 `/api/v1`，数据合同记录 `schema_version: 1.0.0`。
- 新主线不得使用其他历史产品版本号描述当前交付。

## 3. 重新实现与资产复用政策

### 3.1 重新实现原则

FastPPT `v1.0.0` 是正式仓库中的重新实现，不是旧应用目录的整体搬迁，也不是旧分支合并。开发者应先定义当前模块合同，再决定旧代码是否能降低实现风险。

以下内容不要求兼容：

- 旧 URL、API 版本和请求结构。
- 旧数据库表、JSON 存储格式和运行数据。
- 旧环境变量名称和默认端口。
- 旧页面布局、组件层级和文案。
- 旧任务状态、旧项目包和旧登录会话。
- 旧构建产物、测试截图和验收报告。

不得为了兼容旧实现而破坏本文件规定的模块边界、双部署能力、路径可移植性或安全要求。

### 3.2 允许复用的资产

旧实现中的以下资产可以作为候选，经审查后逐项复制或改写：

- React/Vite 工作台中的通用页面列表、预览、操作记录和版本比较交互。
- Fastify API 中的请求校验、WebSocket 事件、项目权限和任务编排思路。
- 共享数据模型与结构化协议定义。
- 文档解析、PPTX 导出和 PowerPoint 渲染 Worker。
- PostgreSQL Schema、对象存储适配和持久任务租约设计。
- 单元测试、集成测试、浏览器 E2E、Golden Deck 夹具和 PowerPoint smoke 思路。
- 安全远程下载、SSRF 防护、上传限制、成本账本和不可变版本逻辑。

复用不是默认选择。任何候选代码只有同时满足以下条件才能进入正式仓库：

1. 来源、提交和许可证清楚。
2. 不包含密钥、真实用户数据、构建产物或机器路径。
3. 能放入本文件规定的目标目录，不继续维护旧应用单体。
4. 对本机和服务器两种部署方式都成立，或被收敛到明确适配器。
5. 通过当前仓库的类型检查、测试和安全检查。
6. 命名已经统一为 FastPPT，版本已经统一为 `v1.0.0`。
7. 代码质量不低于重新实现，并且维护成本可接受。

每次复用必须登记到 `docs/reuse-ledger.md`，至少记录：来源仓库、来源提交、来源相对路径、目标相对路径、采用方式、许可证结论、改动摘要和验证证据。

### 3.3 禁止复制的内容

- `.env`、凭据、个人域名、个人邮箱白名单和中转站地址。
- `data/`、`output/`、`start-data/`、`smoke-data/` 等运行数据。
- `dist/`、`dist-server/`、缓存、虚拟环境、`__pycache__` 和浏览器自动化临时目录。
- 旧数据库实例、登录会话、对象存储内容和导出文件。
- 旧绝对路径、盘符、用户目录和端口假设。
- 把旧测试通过记录当作新主线验收证据。
- 通过合并旧功能分支把整个历史实现一次性带入 `main`。

## 4. 产品定义

### 4.1 一句话定位

FastPPT 是一个可在本机或服务器部署的 AI 演示文稿生产与修改系统，用于把结构化内容、文档或已有 PPT 转换为可预览、可追溯、尽量原生可编辑并经过 PowerPoint 质量验证的 PPTX。

### 4.2 目标用户

- 在个人电脑上处理敏感材料或希望完全掌控数据的个人用户。
- 在服务器上为小团队提供统一项目、任务和导出的组织。
- 需要从报告、Markdown、DOCX、PDF 或既有 PPTX 快速形成演示文稿的内容生产者。
- 需要对页面进行自然语言修改、版本比较和失败恢复的设计与汇报人员。

### 4.3 核心价值

1. 同一产品支持本机和服务器部署，不维护两套功能。
2. 页面事实、来源、版本、成本和导出结果可追溯。
3. 视觉生成与可编辑重建分离，能力边界诚实可见。
4. 单页失败可恢复，长任务可继续，已成功页面不重复执行。
5. 最终结果以 PowerPoint 实际渲染为最高等级的视觉证据。

## 5. v1.0.0 范围

### 5.1 必须实现

#### 项目与输入

- 新建、打开、重命名、复制、归档和恢复项目。
- 上传并管理项目资料，首批支持 Markdown、DOCX、PDF 和 PPTX。
- Markdown、DOCX、PDF 用于内容提取；PPTX 还用于已有演示文稿改进。
- 原始输入建立不可变快照，后续工具只处理受控副本。
- 文件去重、解析状态、来源定位、摘要、事实候选和错误可见。

#### 三种生产流程

1. **文档生成**：从一个或多个文档形成大纲、逐页内容和新 PPTX。
2. **逐页录入**：用户提供每页标题与正文，FastPPT 负责内容整理、视觉规划和 PPTX 生成。
3. **PPT 改进**：导入已有 PPTX，在默认保持页数、顺序和事实的前提下修改页面。

#### 计划与确认

- 模型只输出结构化计划，服务端校验后执行，不能输出任意文件命令。
- 创建新演示文稿前展示页面类型、标题、内容摘要和页数预算。
- 多页、全局、页数变化、事实变化、视觉方向整体变化和高成本操作必须确认。
- 单页低风险修改在计划校验通过后可以直接执行。
- 任何未解决的高风险事实冲突都会阻断相关生成或修改。

#### 生成与修改

- 支持文字、布局、层级、颜色、图片和基础结构的页面修改。
- 支持当前页、勾选多页和按条件发现相似页面三种作用范围。
- 视觉任务先产生可审查的页面预览，再进入可编辑重建。
- 新演示文稿先生成封面和一至两张代表内容页；确认后复用这些版本继续全量生成，不重复计费。
- 支持取消、有限重试、失败页单独恢复和长任务断点续做。

#### 版本与导出

- 页面使用稳定 `page_id`，显示页码只由排序计算。
- 每次实际修改产生不可变 `version_id`。
- 支持版本比较、单页恢复、整组回滚和导出版本锁定。
- 导出独立 PPTX，不覆盖用户输入文件或上一个成功版本。
- 每页展示可编辑等级、局部位图区域和 QA 状态。

#### 双部署

- 本机模式提供单机启动、停止、状态检查、数据目录配置和本地升级说明。
- 服务器模式提供认证、用户与项目隔离、持久队列、对象存储和独立 Worker。
- 两种模式使用相同 Web UI、API 合同、领域服务、PPT 生成链和测试夹具。
- 部署模式在启动时显式确定并通过健康接口可见，不能在运行中静默切换持久化后端。

### 5.2 明确不做

- 不开发或发布 FastPPT Skill。
- 不把 Codex App、MCP、Harness 或任何特定智能体宿主作为运行依赖。
- 不建设 PPT 风格包、主题包、品牌包、风格市场、团队风格库或相应 UI。
- 不承诺任意复杂图表、流程图连接线、SmartArt、动画、视频、宏和嵌入对象都能原生重建。
- 不实现多人实时协同编辑、评论审批流和同页光标同步。
- 不实现 WOPI、Microsoft 365 网页编辑或第三方 Office 文件预览服务。
- 不把 PDF 页面截图默认送入视觉模型，不在 `v1.0.0` 承诺扫描 PDF 的完整 OCR。
- 不提供公开批量生成 API、插件市场或第三方扩展市场。
- 不迁移旧应用数据库、旧配置和旧运行项目。

### 5.3 风格相关边界

FastPPT 仍需保证同一演示文稿的字体、色彩、布局和视觉语言一致，但 `v1.0.0` 只允许以下来源：

- 用户在当前项目中的自然语言视觉要求。
- 用户提供的参考图片或参考演示文稿。
- 导入 PPTX 自身的主题、字体和颜色信息。
- FastPPT 内置的最小默认视觉规则。

这些信息保存在项目合同和页面版本中，不抽象为可安装、可发布或可复用的“风格包”。界面不得展示未实现的风格包入口。

## 6. 产品工作流

### 6.1 总体状态机

```text
created
-> ingesting
-> planning
-> awaiting_plan_confirmation
-> generating_samples
-> awaiting_sample_confirmation
-> generating_pages
-> reconstructing
-> validating
-> ready
```

失败状态：

```text
failed_recoverable
failed_terminal
cancelled
```

每个阶段必须持久化当前状态、输入哈希、已完成页面、下一动作和活动错误。进程重启后从最后一个有效检查点恢复，不能依赖浏览器状态或模型上下文。

### 6.2 文档生成

```text
上传资料
-> 安全校验与解析
-> 来源、事实和冲突
-> 页面预算与逐页大纲
-> 用户确认
-> 代表页预览
-> 用户确认
-> 其余页面预览
-> 可编辑重建
-> 静态 QA
-> PowerPoint 渲染 QA
-> 导出
```

页面预算必须区分封面、目录或过渡页、内容页和结束页。用户要求的“内容页数量”不能被封面或目录占用。

### 6.3 逐页录入

每个草稿页至少包含：

```yaml
page_draft_id: string
order_index: integer
title: string
body: string
locked: boolean
```

用户可以新增、删除、排序和粘贴多页内容。模型默认只优化已录入页面；需要拆分、合并或增加页面时，先展示具体差异并等待确认。

### 6.4 PPT 改进

```text
上传 PPTX
-> 建立不可变原件与工作副本
-> 解析页面、文本、形状和媒体
-> 为每页分配稳定 page_id
-> PowerPoint 渲染原始版本
-> 用户选择作用范围并提交指令
-> 结构化计划与确认
-> 新视觉预览
-> 可编辑重建
-> 同版本 PowerPoint 渲染
-> 比较、恢复或导出
```

默认保持页数、顺序、页面身份和锁定事实。新增、删除、拆分、合并和全局视觉方向变化必须确认。

### 6.5 自然语言修改

指令入口必须显示当前作用范围：当前页、多页或全局条件。服务端生成并校验结构化计划：

```json
{
  "workflowMode": "document_create|page_entry|pptx_improve",
  "targetScope": "single|multi|global",
  "affectedPageIds": ["page_004"],
  "changes": [
    {"kind": "preserve_fact", "factId": "fact_38"},
    {"kind": "rewrite_text", "target": "title", "constraint": "one_line"},
    {"kind": "layout_change", "target": "content", "value": "three_stage_flow"}
  ],
  "pageDelta": {"add": [], "remove": [], "split": [], "merge": []},
  "factImpact": {"added": [], "removed": [], "changed": []},
  "unsupported": [],
  "requiresConfirmation": false,
  "confirmationReasons": [],
  "estimatedUsage": {"imageUnits": 1, "amount": 0, "currency": "CNY"}
}
```

计划校验失败、目标不明确、事实冲突未解决、预算不足、模型输出越权或能力不支持时，必须停止执行并返回可操作原因。

### 6.6 图片角色与直接重建

用户图片至少区分：成品页、内容参考、视觉参考、布局参考、配色参考、编辑目标和局部素材。图片角色会改变流程且无法可靠判断时，必须询问用户。

只有同时满足以下条件才允许跳过新视觉预览并直接重建：

1. 图片明确是成品页面。
2. 用户明确要求转换为可编辑页面。
3. 用户没有要求丰富、优化、改版或重新设计。

直接重建仍需页面合同、原件保护、可编辑性报告、静态 QA 和 PowerPoint 渲染 QA。

## 7. 事实、来源与页面合同

### 7.1 基本原则

- 页面合同是文字、数字、日期、术语和来源的内容权威。
- 获批视觉预览是当前页面版本的视觉目标。
- 视觉模型不能反向修改锁定事实。
- 没有来源的部门、客户、金额、日期、人员和引用不得自动补写。
- 内容压缩默认保留事实锚点；删除或改写必须显示差异并确认。

### 7.2 事实记录

```yaml
fact_id: string
project_id: string
kind: number|date|person|organization|metric|claim|term|source
value: string
normalized_value: string
source_document_id: string
source_locator: string
confidence: number
locked: boolean
```

同一事实在不同文件中出现数值、单位、日期或结论冲突时，创建冲突记录。高风险冲突必须由用户选择来源、保留双重口径或明确忽略，不能由模型静默裁决。

### 7.3 页面合同

每个页面版本至少绑定：

- 页面目的、页面类型和核心结论。
- 必须保留的事实、数字、逐字文本和来源。
- 可压缩内容和禁止项。
- 视觉方向、布局意图、密度和可读性约束。
- 当前输入、参考资产和 SHA-256。
- Prompt 快照、模型、参数和估计成本。
- 预览、SVG、PPTX 页面和权威渲染 Artifact。
- 可编辑等级、局部位图区域和 QA 结果。

## 8. 预览、重建与质量真相

### 8.1 三类预览状态

| 状态 | 来源 | 用途 | 是否为最终视觉证据 |
| --- | --- | --- | --- |
| 快速预览 | SVG 或等效轻量渲染 | 快速反馈内容和布局 | 否 |
| 视觉预览 | 已登记的页面视觉版本 | 用户确认视觉方向 | 否 |
| 权威预览 | 同一 PPTX 页面经 PowerPoint 渲染的 PNG | 最终视觉检查 | 是 |

界面必须显示预览类型和对应 `version_id`。权威预览就绪前保留上一张有效预览，避免白屏或把旧版本误标为新版本。

### 8.2 可编辑重建

- 文本、数字、基础形状、线条、图标和规则表格优先使用原生或矢量对象。
- 复杂纹理、照片和暂不能稳定结构化的装饰可作为局部图片。
- 含有应编辑文字的区域不得直接栅格化。
- 每个局部图片区域记录位置、来源、哈希、原因和可编辑性说明。
- 物理页面尺寸、SVG `viewBox` 和 DrawingML 坐标映射是独立合同。
- 页面按 Manifest 顺序重建并逐页保存检查点，不并行写同一演示文稿。

### 8.3 ppt-master 适配边界

FastPPT 只能通过 `packages/ppt-master-adapter` 调用上游内核。业务代码不得直接依赖上游脚本内部路径、CLI 输出文本或临时目录结构。

适配层负责：

- 能力探测和上游版本兼容检查。
- 受控临时工作区和输入副本。
- SVG 输入、PPTX 输出和 QA 报告合同。
- Windows 子进程编码、超时和错误映射。
- 候选文件原子发布和失败产物归档。
- 禁止整页 Raster 进入最终 PPTX 的检查。

上游现有实现目录在 `v1.0.0` 中保持来源关系和许可证，不复制到多个业务目录。

### 8.4 PowerPoint 渲染

安装 Microsoft PowerPoint 的 Windows Render Worker 是权威渲染节点。它必须记录：

- 输入 PPTX 哈希。
- PowerPoint 版本和可获得的 Office 构建信息。
- 实际渲染页清单、尺寸、耗时和错误。
- 每页 PNG 哈希和对应页面版本。
- 联系表和视觉检查报告。

没有可用 PowerPoint Worker 时，系统仍可提供 SVG 回退和 PPTX 下载，但状态必须为 `degraded`，不能显示“权威渲染通过”。

## 9. 双部署架构

### 9.1 共享逻辑架构

```text
FastPPT Web
  -> API 与事件通道
  -> Edit Orchestrator
  -> FastPPT Core
       -> 文档解析
       -> 事实与页面合同
       -> Prompt 与模型适配
       -> 任务、预算与版本
  -> Worker Queue
       -> 视觉生成 Worker
       -> SVG/PPTX Worker
       -> PowerPoint Render Worker
  -> Metadata Store + Artifact Store
```

### 9.2 本机模式

目标是单个用户在一台电脑上完成项目生产和修改。

默认组件：

- 浏览器 Web UI。
- 只监听回环地址的本地 Runtime/API。
- SQLite 元数据存储。
- 本地文件 Artifact Store。
- 持久化本地任务队列。
- 同机 Python Worker。
- 可选的同机 PowerPoint Render Worker。

要求：

- 默认不要求登录，但仅允许回环访问。
- 若配置为非回环监听，必须显式配置认证，否则启动失败。
- 数据、临时文件和导出目录都可配置，不依赖仓库位置。
- 关闭或重启进程后，已持久化项目和任务可以恢复。
- 本地模式不能使用生产数据库不可用时的“静默回退”；当前后端必须在启动日志和健康接口中明确显示。

### 9.3 服务器模式

目标是为小范围多用户提供同一 FastPPT 产品。

必须组件：

- Web/API 服务。
- PostgreSQL 元数据存储。
- 持久任务队列与 Worker 租约。
- S3 兼容对象存储。
- 服务端模型适配器与密钥管理。
- 独立 PowerPoint Windows Render Worker，或明确的降级状态。
- 反向代理、TLS、认证、用户和项目隔离。

要求：

- 服务器模式缺少 PostgreSQL、对象存储或认证配置时启动失败。
- 多实例 API 写入必须使用数据库事务和并发版本检查。
- Worker 任务先持久化再领取，使用租约、心跳、有限重试和过期恢复。
- 页面级失败不阻断同批次其他页面；成功页不重复执行或重复计费。
- 浏览器只通过授权 Artifact 接口读取文件，不接触对象存储 Key、磁盘路径或服务端凭据。

### 9.4 配置装配

`apps/runtime` 是两种部署方式的统一配置入口。领域包不能读取任意环境变量或直接访问全局文件系统；Runtime 负责解析配置并通过明确接口注入：

```yaml
deployment_mode: local|server
metadata_store: sqlite|postgres
artifact_store: filesystem|s3
queue_backend: local|postgres
auth_mode: local_trusted|session
render_backend: powerpoint|unavailable
model_backend: configured_provider|deterministic_test
```

生产环境不得启用测试模型、开发登录、内存存储或自动生成的默认密钥。

## 10. 代码边界

目标目录职责：

```text
apps/
  web/                         # 本机与服务器共用 Web UI
  runtime/                     # 配置装配、进程入口和部署模式选择

packages/
  fastppt-core/                # 事实、页面合同、Prompt、视觉任务和 Provenance
  edit-orchestrator/           # 计划、确认、版本、回滚和并发控制
  ppt-master-adapter/          # 上游内核唯一适配层
  preview/                     # 快速、视觉和权威预览状态

services/
  api/                         # REST、认证、权限和事件
  worker/                      # 解析、生成、重建和持久任务执行
  render/                      # PowerPoint 渲染与视觉 QA

deploy/
  local/                       # 本机部署文件与说明
  server/                      # 服务器部署文件与说明

docs/
  architecture/               # ADR、接口与数据合同
  reuse-ledger.md              # 旧资产复用登记

tests/
  unit/
  integration/
  e2e/
  golden/
```

依赖方向：

```text
apps/services -> packages -> domain contracts
ppt-master-adapter -> upstream ppt-master
fastppt-core -X-> browser framework
fastppt-core -X-> concrete database
fastppt-core -X-> developer machine path
```

禁止在多个目录复制同一份页面合同、版本规则、模型计划 Schema 或 PPT 导出逻辑。

## 11. 核心数据模型

所有实体使用稳定 ID，所有时间使用 UTC，所有写操作包含创建者、版本和审计信息。

### 11.1 Project

```yaml
project_id: string
owner_id: string
name: string
status: draft|processing|ready|degraded|failed|archived
current_deck_revision_id: string|null
created_at: datetime
updated_at: datetime
```

项目不包含 `theme_id` 或风格包版本。

### 11.2 WorkSession

```yaml
session_id: string
project_id: string
workflow_mode: document_create|page_entry|pptx_improve
source_document_ids: string[]
plan_id: string|null
status: draft|parsing|planned|blocked|confirmed|running|completed|failed|cancelled
created_by: string
created_at: datetime
updated_at: datetime
```

### 11.3 DocumentSource

```yaml
document_id: string
project_id: string
file_name: string
media_type: string
sha256: string
size_bytes: integer
artifact_id: string
parse_status: queued|parsing|ready|warning|blocked|failed
created_by: string
created_at: datetime
```

### 11.4 Page

```yaml
page_id: string
project_id: string
current_version_id: string
order_index: integer
page_type: cover|toc|section|content|ending|other
locked: boolean
archived: boolean
fact_anchor_ids: string[]
```

### 11.5 PageVersion

```yaml
version_id: string
page_id: string
parent_version_id: string|null
operation_id: string|null
page_contract_artifact_id: string
prompt_snapshot_artifact_id: string|null
quick_preview_artifact_id: string|null
visual_preview_artifact_id: string|null
svg_artifact_id: string|null
pptx_render_artifact_id: string|null
editable_level: visual|text_native|native_partial|native_structure
status: draft|previewing|reconstructing|validating|ready|degraded|failed
created_at: datetime
```

### 11.6 EditOperation

```yaml
operation_id: string
project_id: string
session_id: string
target_scope: single|multi|global
requested_page_ids: string[]
resolved_page_ids: string[]
structured_plan: json
confirmation_required: boolean
confirmed_at: datetime|null
result_version_ids: string[]
status: planned|blocked|confirmed|running|completed|partial|failed|rolled_back
created_at: datetime
```

### 11.7 Artifact

```yaml
artifact_id: string
project_id: string
kind: source|contract|prompt|preview|svg|pptx|render|qa|export
storage_key: string
sha256: string
size_bytes: integer
media_type: string
created_at: datetime
```

`storage_key` 是服务端内部逻辑 Key，不是操作系统绝对路径，也不得直接返回浏览器。浏览器只接收短期授权的 Artifact URL 或通过认证的下载端点。

### 11.8 ExportJob 与 UsageLedger

导出任务必须锁定页面顺序和每页 `version_id`。账本记录模型、参数、价格快照、预计使用量、预留、结算、退回、重试和未知提交状态。价格未知时必须明确显示“未知”，不能伪造零成本。

## 12. API 与事件合同

### 12.1 REST

首版统一使用 `/api/v1`，不保留旧应用的双版本接口。

```text
GET    /api/v1/meta
GET    /api/v1/health

POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/session

GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
POST   /api/v1/projects/:projectId/copy
POST   /api/v1/projects/:projectId/archive
POST   /api/v1/projects/:projectId/restore

POST   /api/v1/projects/:projectId/sessions
GET    /api/v1/projects/:projectId/sessions/:sessionId
POST   /api/v1/projects/:projectId/documents
GET    /api/v1/projects/:projectId/documents
POST   /api/v1/projects/:projectId/plans
POST   /api/v1/projects/:projectId/plans/:planId/confirm
POST   /api/v1/projects/:projectId/plans/:planId/cancel

GET    /api/v1/projects/:projectId/pages
GET    /api/v1/projects/:projectId/pages/:pageId
POST   /api/v1/projects/:projectId/operations
POST   /api/v1/projects/:projectId/operations/:operationId/confirm
POST   /api/v1/projects/:projectId/operations/:operationId/cancel
POST   /api/v1/projects/:projectId/operations/:operationId/retry
POST   /api/v1/projects/:projectId/operations/:operationId/rollback
GET    /api/v1/projects/:projectId/pages/:pageId/versions
POST   /api/v1/projects/:projectId/pages/:pageId/versions/:versionId/restore

POST   /api/v1/projects/:projectId/exports
GET    /api/v1/projects/:projectId/exports/:exportId
GET    /api/v1/projects/:projectId/exports/:exportId/download
GET    /api/v1/projects/:projectId/artifacts/:artifactId
```

本机可信模式可以省略交互式登录，但 API 仍使用同一项目和资源授权中间件，避免形成第二套代码路径。

### 12.2 事件

事件通道至少支持：

```text
document.queued
document.ready
document.failed
conflict.detected
conflict.resolved
plan.created
plan.blocked
confirmation.required
operation.started
operation.progress
page.version.created
preview.quick.ready
preview.visual.ready
preview.pptx.ready
render.degraded
operation.completed
operation.failed
operation.rolled_back
export.completed
```

每个事件带单调递增 `seq`、服务器时间和适用的 `project_id`、`session_id`、`operation_id`、`page_id`、`version_id`、`export_id`。客户端断线重连后按 `afterSeq` 补发事件，并最终以 REST 状态为准。

长期认证令牌不得放在 WebSocket URL。使用同源安全 Cookie、受控 Header 或一次性握手凭证。

## 13. Web 体验要求

FastPPT 首屏直接进入可用工作台，不制作营销落地页。

### 13.1 信息架构

- 顶部：项目名称、当前状态、部署模式、保存状态和导出。
- 左侧：项目与页面列表、输入流程入口和页面作用范围。
- 中央：当前页面预览、前后比较和必要的确认界面。
- 右侧：资料、计划、操作记录、版本和 QA 信息，可折叠。
- 底部：自然语言指令和附件入口，明确显示当前作用范围。

“PPT 风格包”不出现在导航、设置或空状态中。

### 13.2 必备交互

- 页面缩略图显示页码、状态和当前版本；内部身份使用 `page_id`。
- 当前页、多页和全局条件使用清晰的范围控件，不能仅靠文本猜测。
- 确认界面展示影响页面、事实变化、页数变化、不可支持项、预计使用量和执行按钮。
- 操作记录显示进度、失败原因、重试、取消和回滚。
- 版本比较的标题、状态、预览、可编辑等级和 QA 必须全部绑定被比较版本。
- 预览区域明确区分快速预览、视觉预览、PPTX 权威渲染和降级状态。
- 桌面与常见窄屏下不得出现文字遮挡、按钮溢出和不可达操作。
- 图标优先使用项目既有图标库，并为不熟悉的图标提供 Tooltip 和无障碍名称。

## 14. 安全与隐私

### 14.1 通用要求

- 上传文件、文档文本、图片、模型输入和模型输出全部视为不可信数据。
- 模型计划只能调用白名单领域操作，不能执行 Shell、写任意路径或访问任意网络地址。
- 文件名与路径必须规范化并限制在部署配置的工作区内，拒绝绝对路径、路径穿越和符号链接逃逸。
- 解压 DOCX/PPTX 时限制文件数量、单项大小、总展开大小、压缩比和处理时间。
- 远程资源只允许受控 HTTPS，并防护重定向、DNS 重绑定和 IPv4/IPv6 特殊地址 SSRF。
- API Key、数据库密码、对象存储密钥和 PowerPoint 服务凭据只存在于服务端秘密存储。
- 密钥不得出现在 URL、CLI 参数、日志、异常、截图、测试夹具或 Git 历史中。
- 浏览器不得接收磁盘路径、对象存储 Key、长期下载 Token 或模型凭据。
- 原始输入、生成资产、导出和日志按项目隔离，并支持明确的数据保留和删除策略。

### 14.2 本机模式

- 默认只绑定回环地址。
- 本地可信身份只对当前实例有效，不能生成可跨机器复用的管理员凭据。
- 数据目录权限检查失败时给出明确错误，不自动改写系统目录权限。

### 14.3 服务器模式

- 使用 HttpOnly、Secure、SameSite 会话 Cookie 或等价的短期令牌方案。
- 每个请求校验用户、项目、页面、文档、版本、操作、Artifact 和导出权限。
- CORS 只允许显式配置的可信来源。
- 登录、资料访问、模型调用、事实解决、版本变化、导出和回滚写入审计日志。
- 生产模式禁用开发登录、默认口令、文件存储回退和内存任务队列。

## 15. 可靠性与恢复

- 所有长任务在执行前持久化，状态更新具备幂等键。
- Worker 使用租约和心跳；进程退出后，过期任务可由其他 Worker 恢复。
- 外部请求只在能证明已提交时增加提交次数；无法判断时记录 `submission_unknown`。
- 重试采用有限次数和有上限的退避；认证、权限、配置、预算和本地校验错误不自动重试。
- 已成功 Artifact 必须通过哈希复用；丢失或哈希不符时进入损坏或待修复状态。
- `.part`、临时文件和未通过校验的候选文件不得登记为成功。
- 导出先写候选文件，静态检查通过后再原子发布。
- 输出文件被占用时不强制覆盖，保留候选并提供新的可下载版本。
- 活动错误与历史错误分离；问题解决后记录 `resolved_at` 和解决方式。

## 16. 质量检查

### 16.1 输入与计划 QA

- 输入文件可解析、哈希稳定、原件未被移动或改写。
- 页面数量、页面类型和内容页预算明确。
- 锁定事实有来源，严重冲突已解决。
- 计划作用范围、页数变化、事实影响和预算通过 Schema 校验。

### 16.2 视觉预览 QA

- 文件可打开、非空白、尺寸和画幅正确。
- 不生成多页拼图冒充单页。
- 关键标题、数字和必须保留内容有足够空间。
- 页面无明显裁切、遮挡和不合理重复。
- 整套字体、色彩、标题层级和视觉语言一致。
- 代表页通过后才批量生成其余页面。

### 16.3 SVG QA

- `viewBox`、物理尺寸映射和页面编号正确。
- 禁用特性、外部引用和低分辨率素材可检测。
- 文本、图形、Stroke、旋转和装饰对象不越界。
- 不存在未解析占位符、乱码和意外问号污染。
- SVG QA 报告哈希进入后续导出报告。

### 16.4 PPTX 静态 QA

- ZIP 与 OOXML 结构可解析，关系目标完整。
- 页数、页面顺序、物理尺寸和 Manifest 一致。
- 文本框、形状、图片和图表数量合理。
- 没有未经登记的整页 Raster。
- 文本溢出、对象越界、字体缺失和中文编码有检查结果。
- 每页可编辑等级和局部图片区域可生成报告。

### 16.5 PowerPoint 渲染 QA

- 最终 PPTX 可由 PowerPoint 打开且没有修复提示。
- 所有页面成功渲染为指定尺寸 PNG。
- 检查换行、裁切、重叠、字体替换、图片加载和对象边界。
- 权威 PNG 与相同 `version_id`、PPTX 哈希绑定。
- 生成逐页结果和整套联系表。

## 17. 测试要求

### 17.1 单元测试

- 路径发现、相对路径解析、路径穿越和绝对路径拒绝。
- 稳定 `page_id` 与显示页码解耦。
- 事实抽取、规范化、冲突分类和锁定规则。
- 结构化计划 Schema、确认规则和页数变化。
- 版本创建、比较、恢复、整组回滚和并发冲突。
- 使用量预留、结算、退回、未知提交和幂等。
- Artifact 哈希、权限和短期访问。
- 本机与服务器配置校验。

### 17.2 集成测试

- Markdown、DOCX、PDF、PPTX 从上传到解析、事实、计划和版本的链路。
- 代表页确认后复用，不重复生成或计费。
- 多页部分失败、失败页重试和整组回滚。
- 快速预览、视觉预览、SVG、PPTX 和 PowerPoint PNG 的事件顺序。
- SQLite/本地文件模式重启恢复。
- PostgreSQL、任务租约和 S3 兼容对象存储模式重启恢复。
- 模型超时、HTTP 错误、空响应、错误尺寸和未知提交。
- PowerPoint 不可用时的降级行为。

### 17.3 浏览器 E2E

- 本机模式：新建项目、导入 Markdown、确认计划、生成代表页、导出 PPTX。
- 文档生成：多文件资料、事实冲突解决、页数确认和完整生成。
- 逐页录入：新增、排序、生成，并验证模型未自行加页。
- PPT 改进：上传 PPTX、修改当前页、比较版本、恢复和导出。
- 多页与全局操作：影响范围确认、部分失败、重试和整组回滚。
- 断网、重连、`afterSeq` 事件补发和刷新恢复。
- 快速预览、权威预览和降级状态不会混淆。
- 常见桌面和窄屏尺寸下无关键控件遮挡或溢出。

### 17.4 Golden Deck

固定测试集至少包含：

- 封面。
- 普通图文双栏。
- 时间线。
- 密集数据页。
- 表格或基础图表。
- 含照片与局部图片页。
- 复杂流程页。
- 中文长标题与多数字页。
- 自定义物理页面尺寸。

复杂流程页在 `v1.0.0` 只验证不破坏、可编辑边界披露和局部回退，不把完整语义重绘作为通过条件。

### 17.5 可移植性与仓库卫生

- 在包含空格和非 ASCII 字符的不同工作区路径下完成安装、构建和测试。
- 扫描 FastPPT 自有源码、配置、测试和文档，阻止盘符路径、用户主目录、真实密钥和个人域名进入提交。
- 中文文件按 UTF-8 读取验证关键字段，并检查替换字符和异常问号。
- 不扫描上游许可证允许保留的历史文档内容来误报 FastPPT 自有配置，但新代码不得新增机器路径。
- `.gitignore` 覆盖运行数据、导出、缓存、日志、虚拟环境和秘密文件。

## 18. 非功能要求

### 18.1 性能

- 除模型、文档解析和渲染任务外，服务器模式常规 API 在目标负载下 P95 小于 500 ms。
- 任务开始后 1 秒内产生可见状态事件；长任务至少每 10 秒产生进度或心跳。
- 页面级修改只重建受影响页面；完整导出时再执行整套合并和全 Deck QA。
- 大文件限制、批次大小、并发数和超时均来自服务端配置。

### 18.2 可观测性

- 日志使用结构化格式并携带 request、project、session、operation 和 job 标识。
- 健康接口区分 API、元数据存储、Artifact Store、队列、模型和 Render Worker 状态。
- 指标至少覆盖任务成功率、各阶段耗时、重试、失败分类、队列深度和渲染可用性。
- 日志与指标不得包含文档正文、密钥、绝对文件路径或可直接访问的对象地址。

### 18.3 可访问性与响应式

- 关键操作可通过键盘完成，焦点状态可见。
- 图标按钮有可访问名称，触摸目标至少 44 px。
- 状态不能只通过颜色表达。
- 文本、按钮和标签在支持的视口中不溢出或互相遮挡。

## 19. 实施顺序

所有阶段都在 `main` 完成。每个阶段结束时保持仓库可构建、可测试，并提交独立证据。

### Phase 0：基线与复用审计

- 固定 `v1.0.0` 的单一版本源和仓库元信息。
- 建立 workspace、构建、格式化、测试和 CI 骨架。
- 建立 `docs/reuse-ledger.md`，逐项评估旧资产。
- 实现绝对路径、秘密和生成产物扫描。
- 验证 `ppt-master-adapter` 的最小能力探测，不修改上游内核。

通过条件：干净检出后可按相对路径安装和运行基础检查；旧代码尚未复制也不影响骨架成立。

### Phase 1：本机最小闭环

- 实现 Runtime、SQLite、本地 Artifact Store 和持久任务队列。
- 实现项目、页面、版本、操作和 Artifact 基础模型。
- 接通 SVG 到 PPTX 适配层、静态 QA 和 PowerPoint 渲染。
- 建立最小 Web 工作台和本机启动流程。

通过条件：本机可从固定页面合同生成独立 PPTX，完成版本登记、静态 QA 和权威渲染或明确降级。

### Phase 2：输入与新演示文稿

- 实现 Markdown、DOCX、PDF 解析和资料池。
- 实现事实、来源、冲突、页面预算和逐页合同。
- 实现文档生成和逐页录入。
- 实现代表页生成、确认和全量生成。

通过条件：从真实中文文档完成新 PPTX，页数、事实、来源和成本可审计。

### Phase 3：PPT 改进与自然语言操作

- 实现 PPTX 输入保护、解析和原始版本。
- 实现当前页、多页和全局结构化计划。
- 实现不可变页面版本、比较、恢复、重试和整组回滚。
- 完善快速、视觉和权威预览切换。

通过条件：Golden Deck 可执行单页和批量修改，页面身份、事实、版本和导出绑定正确。

### Phase 4：服务器部署

- 接入 PostgreSQL、持久任务租约和 S3 兼容对象存储。
- 实现认证、用户与项目隔离、审计和生产配置校验。
- 部署独立 Worker 与 PowerPoint Render Worker。
- 完成 API 多实例和 Worker 重启恢复测试。

通过条件：服务器模式在不使用本地回退的情况下完成与本机模式相同的核心流程。

### Phase 5：发布硬化

- 完成单元、集成、E2E、Golden Deck、路径可移植性和安全测试。
- 完成依赖许可证、第三方声明、部署文档、备份恢复和升级说明。
- 统一所有 FastPPT 自有版本字段和用户界面版本。
- 从干净环境分别执行本机部署和服务器部署验收。

通过条件：满足第 21 节全部完成定义后，在 `main` 验收提交创建 `v1.0.0` Tag。

## 20. 开发禁令

- 不创建或使用 `main` 之外的 FastPPT 开发分支。
- 不向旧个人 Fork、旧归档仓库或旧功能分支提交新实现。
- 不整体复制旧应用目录后直接宣称迁移完成。
- 不把旧测试、旧截图和旧 smoke 结果作为新主线通过证据。
- 不把 FastPPT 实现为 Skill，或把 Skill 宿主当作启动方式。
- 不按本机和服务器拆成两个产品、两个代码库或两个长期目录副本。
- 不硬编码任何盘符、用户目录、开发者工作区、个人域名或真实凭据。
- 不在浏览器中暴露服务端路径、对象 Key、密钥或 PowerPoint 凭据。
- 不静默改变页数、锁定事实、来源结论或批量作用范围。
- 不允许模型直接执行命令、写文件或决定任意工具调用。
- 不用整页图片加 OCR 文本层冒充原生可编辑 PPTX。
- 不把 SVG、浏览器截图或第三方渲染标为 PowerPoint 权威预览。
- 不在 `v1.0.0` 增加 PPT 风格包、主题市场或相应占位入口。
- 不使用单行 JSON、进程内状态或浏览器状态作为生产任务的唯一真相。
- 不在测试缺失时大规模改写上游 `ppt-master` 内核。

## 21. v1.0.0 完成定义

只有同时满足以下条件，FastPPT `v1.0.0` 才算完成：

1. 正式实现全部位于 `FastR-D/FastPPT` 的 `main`，发布提交带 `v1.0.0` Tag。
2. FastPPT 自有产品、构建、API 元信息、导出报告和文档版本统一；技术清单按 SemVer 要求使用 `1.0.0`。
3. 干净检出后，不依赖开发者绝对路径即可完成安装、构建、测试和启动。
4. 旧资产的每项复制都有复用登记、许可证结论、代码审查和新主线测试证据。
5. 本机模式可以创建项目、导入资料、生成或修改页面、恢复任务并导出 PPTX。
6. 服务器模式具备认证、隔离、PostgreSQL、持久队列、对象存储和独立 Worker，且不使用开发回退。
7. 文档生成、逐页录入和 PPT 改进三种流程均通过端到端测试。
8. 当前页、多页和全局操作范围正确；批量操作有确认、部分失败恢复和整组回滚。
9. 稳定页面 ID、不可变版本、事实来源、使用量、Prompt、Artifact、QA 和导出版本可审计。
10. 视觉预览先于可编辑重建；最终 PPTX 不含未经登记的整页 Raster。
11. PPTX 通过静态结构、尺寸、边界、字体、中文、事实和可编辑性检查。
12. 至少一套 Windows PowerPoint 环境完成权威渲染回归；无 PowerPoint 的实例正确显示降级状态。
13. 单元测试、集成测试、浏览器 E2E、Golden Deck、安全与路径可移植性测试全部有可复核结果。
14. 本机和服务器部署文档从干净环境验证，配置示例不含真实密钥或机器路径。
15. 产品中没有 Skill 入口、PPT 风格包入口或旧产品名称残留。

满足以上条件之前，只能报告具体阶段或范围完成，不能宣称 FastPPT `v1.0.0` 已发布或项目已完成。
