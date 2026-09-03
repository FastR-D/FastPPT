# FastPPT 交互系统实施规划

> 状态：方案草案，供产品设计、工程拆分和后续实现使用。
>
> 本文不是 `ppt-master` 的运行时权威，不新增顶层路线，也不替代
> `skills/ppt-master/SKILL.md`、`workflows/routing.md` 或各路线工作流。
> 实现完成前，现有 Skill、确认门、质量门和导出流程保持不变。

## 一、目标

为 `ppt-master` 增加一个由 Skill 启动的本地项目交互界面，暂定名称为
**PPT Master Project Studio**。它以聊天为主要入口，把现有项目文件、SVG
页面编辑、Agent 修改、质量检查、PPTX 导出和事后经验提炼连接成一个可恢复、
可审计的闭环。

首要用户结果如下：

- 左侧是持续可见的聊天界面，用户不必在浏览器和外部聊天之间来回复制标注。
- 每张页面拥有独立聊天上下文，可针对元素、区域或整页发起修改。
- 整套文稿拥有全局聊天上下文，可让一个 Agent 事务化修改多页。
- 所有修改都绑定基础版本，能识别过期页面和并发冲突。
- 修改、检查、提交和导出状态在同一界面可见。
- 成功任务结束后提炼项目记忆和可复用经验，经过用户确认后再长期使用。

## 二、非目标

本规划不把 PPT Master 扩展为以下产品：

- 独立的托管式演示 SaaS。
- 完整替代 PowerPoint 的浏览器编辑器。
- 实时多人协同编辑平台。
- 在浏览器或本地服务中保存模型 API Key 的聊天服务。
- 绕过 Strategist、确认门、质量检查或路线合同的快捷修改入口。
- 自动把一次项目经验写入 `skills/ppt-master/references/` 的自修改系统。
- 引入 PPTD 作为 PPT Master 的第二套页面权威。

Studio 是现有对话式 Skill 的本地控制面，不是新的演示文稿生命周期。

## 三、现有基础与差距

### 3.1 可复用能力

| 现有能力 | 当前文件 | Studio 中的用途 |
| --- | --- | --- |
| 页面与元素编辑 | `skills/ppt-master/scripts/svg_editor/` | 复用 SVG 读取、元素选择、暂存编辑、撤销、标注和安全写入能力。 |
| 预览生命周期 | `skills/ppt-master/workflows/stages/live-preview.md` | 继续拥有启动时机、应用标注和重新导出的交接规则。 |
| 强确认门 | `skills/ppt-master/scripts/confirm_ui/` | 以聊天卡片或模态视图呈现，但继续使用原服务端校验与 receipt。 |
| 项目与质量工具 | `project_manager.py`、`svg_quality_checker.py`、`svg_to_pptx.py` | 继续分别拥有项目结构、SVG 质量和 PPTX 交付结果。 |
| 本地文件桥参考 | `references/open-kimi-ppt-skill/editor/local-bridge.js` | 借鉴项目根隔离、路径校验、外部保存回调和浏览器内存暂存。 |
| FastPPT 修改约束 | `fastppt-project-workflow.md` | 正式化页号、修改目标、`baseRevision`、修改意图和导出失效。 |

### 3.2 当前缺口

- `svg_editor` 的 AI 标注仍需用户返回外部聊天才能执行。
- 页面编辑历史与聊天历史没有统一的任务标识和版本关系。
- 现有临时元素 ID 只适合一次编辑会话，不能直接承担跨版本引用。
- 多页修改缺少影响分析、批量锁定、隔离执行和整批回滚合同。
- `workflow.log` 是审计证据，不是可驱动界面的结构化任务状态。
- 当前没有项目记忆、页面记忆和跨项目经验的提升边界。
- `fastppt-project-workflow.md` 中“非 FastPPT PPTX 不支持直接编辑”的描述已
  落后于当前 `Edit Native PPTX` 路线，Studio 不应复制该旧判断。

## 四、总体设计原则

1. **项目文件仍是权威**：Studio 不建立只有数据库中才存在的隐藏演示文稿状态。
2. **聊天只表达意图**：确定性工具、Agent、Checker 和 Exporter 分别承担自己的职责。
3. **先绑定范围再修改**：每个请求明确元素、区域、页面、页面集合或整套文稿范围。
4. **版本先于写入**：所有持久化修改都验证 `baseRevision`。
5. **批量修改事务化**：多页作业要么整体提交，要么保持原项目不变。
6. **失败停在拥有故障的层**：页面问题修页面，规格问题修 Plan 工件，导出问题修导出层。
7. **确认门不可弱化**：Studio 负责承载确认交互，不替用户确认。
8. **推理与凭据外置**：Studio 通过 Agent 适配器工作，不保存 API Key，也不保存模型内部推理。
9. **经验先成为候选**：只有被验证、被接受的结果才可提升为长期经验。
10. **兼容现有命令**：已有预览、检查和导出命令在迁移期间保持可用。

## 五、用户界面

### 5.1 桌面布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ 项目 · 路线 · 当前阶段 · 质量状态 · 导出状态 · 导出/下载入口    │
├────────────────┬──────────┬────────────────────┬────────────────┤
│ 左侧聊天       │ 页面栏   │ SVG 主画布         │ 上下文面板     │
│                │          │                    │                │
│ 本页 / 整套    │ P01      │ 元素选择与框选      │ 元素属性       │
│ 会话列表       │ P02      │ 修改前后对比        │ Agent 修改计划 │
│                │ P03      │ 页面生成进度        │ 检查与导出     │
│ 作用域标签     │ ...      │                    │ 版本历史       │
│ 消息与附件     │          │                    │ 记忆候选       │
└────────────────┴──────────┴────────────────────┴────────────────┘
```

窄屏时，上下文面板变为抽屉；页面栏可折叠为底部胶片条。左侧聊天始终保持一级入口。

### 5.2 聊天类型

**本页会话**绑定一张页面，随页面切换自动切换线程。会话保留本页目标、已接受修改、
最近选择和当前页面版本。用户可以继续追问“再大一点”“恢复上一版”，而无需重复页号。

**整套会话**用于以下任务：

- 选择若干页面批量修改。
- 全局颜色、字体、术语或图片策略调整。
- 跨页叙事、顺序、页面角色或内容一致性调整。
- 一次性检查、导出和经验总结。

整套会话不能把“当前页”的隐式指代自动扩大为所有页面。

### 5.3 作用域

输入框上方始终显示一个可检查的作用域标签：

| 作用域 | 含义 | 默认行为 |
| --- | --- | --- |
| `selection` | 当前一个或多个元素 | 只修改所选对象。 |
| `region` | 当前页面上的框选区域 | Agent 可重排区域内部，不得越界影响其他区域。 |
| `page` | 当前页面 | 允许重排当前页，但不改变其他页面。 |
| `pages` | 明确选择的页面集合 | 生成多页影响计划并事务化执行。 |
| `deck` | 整套文稿 | 先判定拥有该修改的工作流层，再决定执行范围。 |

选择元素后默认进入 `selection`；没有选择时，本页会话默认 `page`，整套会话必须由
用户明确选择 `pages` 或 `deck`。

### 5.4 消息卡片

除普通文本消息外，聊天区支持以下结构化卡片：

- 路线与项目状态卡片。
- Default Generate Stage 1 / Stage 2 确认卡片。
- 多页影响分析与确认卡片。
- 修改前后差异卡片。
- Checker 问题与修复状态卡片。
- 导出结果和 material warning 卡片。
- “本次学到”记忆候选卡片。

卡片只是现有工作流和服务端 receipt 的可视化，不创建第二套权威字段。

## 六、系统架构

```text
浏览器 Studio
  ├─ React 聊天、页面栏、SVG 画布和任务状态
  ├─ REST：查询与命令
  └─ SSE：消息增量和任务事件
          ↓
Studio 本地服务
  ├─ Project Service       项目发现与状态聚合
  ├─ Conversation Service  页面/整套会话
  ├─ Revision Service      哈希、快照、冲突与恢复
  ├─ Job Orchestrator      单页/多页作业状态机
  ├─ Slide Service         复用 svg_editor 能力
  ├─ Workflow Adapter      路线、确认门和阶段交接
  ├─ Validation Adapter    Checker 与报告摘要
  ├─ Export Adapter        PPTX 导出与 postflight
  ├─ Memory Service        候选提炼、批准和检索
  └─ Agent Gateway         外部 Agent Host 适配器
          ↓
项目文件、现有 ppt-master 工具与 Agent Host
```

### 6.1 Studio 本地服务

服务只绑定回环地址，默认延续 `live_preview/lock.json` 的项目发现能力。它负责：

- 读取项目工件并聚合只读状态。
- 校验浏览器命令和项目内相对路径。
- 管理聊天、作业、版本和事件文件。
- 调用现有确定性工具。
- 把 Agent 请求交给已配置的 Agent Gateway。

服务不负责：

- 自行决定顶层路线。
- 在缺少确认时继续跨越阻塞门。
- 把 Checker 警告自动解释成设计结论。
- 在浏览器或项目目录保存模型凭据。

### 6.2 Agent Gateway

Agent Gateway 是边界接口，不把某一 Agent Host 写死为产品依赖。建议至少支持：

1. **当前 Host 会话适配器**：由正在运行 Skill 的 Agent 消费 Studio 作业。
2. **本地 Agent CLI 适配器**：可选调用用户已经登录的本地 CLI，不读取其凭据。
3. **文件交接适配器**：不支持直连的 Host 使用 inbox/outbox 结构化文件继续工作。
4. **未来协议适配器**：在稳定协议存在时接入 MCP、ACP 或等价会话协议。

首版只需实现一个可用适配器和文件交接回退，但浏览器 API 不应暴露特定 Host 字段。

## 七、项目状态与文件结构

建议在项目根目录增加 `interaction/`，保存可审计、可迁移的交互状态：

```text
<project>/
├── interaction/
│   ├── project_state.json
│   ├── events.jsonl
│   ├── conversations/
│   │   ├── deck.jsonl
│   │   └── pages/
│   │       ├── P01.jsonl
│   │       └── P02.jsonl
│   ├── jobs/
│   │   └── <job_id>/
│   │       ├── request.json
│   │       ├── plan.json
│   │       ├── events.jsonl
│   │       ├── receipts.json
│   │       └── staging/
│   ├── revisions/
│   │   └── P01/
│   └── memory/
│       ├── candidates.jsonl
│       └── accepted/
│           ├── project.jsonl
│           └── recipes/
└── live_preview/
    ├── lock.json
    ├── edits.jsonl
    └── annotations.jsonl
```

约束如下：

- `interaction/` 是 Studio 交互状态；`svg_output/` 或 round-trip 工作区仍是页面权威。
- `live_preview/*.jsonl` 保持兼容，逐步由统一事件记录引用，不原地迁移历史。
- 对话记录、任务记录和记忆记录使用 JSONL，便于追加和人工审计。
- 大型 SVG 快照可按内容哈希去重，不在 JSONL 内嵌完整页面。
- 数据库可以作为运行时索引，但不能成为唯一状态源；删除索引后应可从项目文件重建。

## 八、版本模型

### 8.1 四类版本

| 版本 | 计算依据 | 用途 |
| --- | --- | --- |
| `pageRevision` | 页面作者源的规范字节哈希 | 检测页面过期和定位修改基础。 |
| `deckRevision` | 有序页面版本和影响交付的 sidecar 汇总哈希 | 判断整套文稿是否变化。 |
| `exportRevision` | 最近成功导出对应的 `deckRevision` | 判断 PPTX 是否过期。 |
| `conversationRevision` | 当前会话摘要和消息位置 | 支持会话压缩、恢复和 Agent 重连。 |

不同路线的页面作者源不同：

- Generate 项目以 `svg_output/` 为页面作者源。
- Edit Native PPTX 以其 round-trip 工作区和 `page_plan.json` 合同为准。
- Create Template 不使用 Studio 的页面修改循环，除非该路线的审阅阶段以后明确接入。

### 8.2 导出失效

任一影响交付的源文件提交后：

1. 更新 `pageRevision` 或相关 sidecar 哈希。
2. 重新计算 `deckRevision`。
3. 若 `exportRevision != deckRevision`，下载区标记为“已过期”。
4. 导出成功后写入新的 `exportRevision` 和 postflight receipt。
5. 导出失败时保留已经验证并提交的作者源，但禁止把旧 PPTX 标记为最新。

### 8.3 元素引用

当前 `_edit_N` ID 继续用于一次页面加载，但不能单独作为跨版本元素身份。请求保存：

```json
{
  "revision": "sha256:...",
  "elementId": "_edit_17",
  "tag": "text",
  "structuralPath": "/svg/g[3]/text[1]",
  "bbox": [120, 86, 420, 72],
  "textDigest": "sha256:..."
}
```

在同一 `pageRevision` 下，`elementId` 是精确引用。版本变化后，Revision Service 使用
结构路径、标签、几何框和内容摘要尝试重定位，并返回置信度。存在多个候选或置信度不足时，
请求进入 `conflict`，由用户重新选择，不能由 Agent 猜测。

## 九、修改请求合同

所有聊天修改在进入执行前归一化为 `ModifyRequest`：

```json
{
  "schemaVersion": 1,
  "requestId": "req_01J...",
  "conversationId": "conv_01J...",
  "scope": "selection",
  "targets": [
    {
      "slide": "P03",
      "elementRefs": [
        {
          "revision": "sha256:...",
          "elementId": "_edit_17"
        }
      ]
    }
  ],
  "baseRevisions": {
    "P03": "sha256:..."
  },
  "intent": "标题更突出，副标题缩短",
  "mode": "auto",
  "exportAfter": true
}
```

必填语义：

- `scope`：允许影响的最大范围。
- `targets`：明确页面和可选元素引用。
- `baseRevisions`：执行前必须仍然匹配的作者源版本。
- `intent`：用户可见的修改意图，不存储内部推理。
- `mode`：`direct`、`agent` 或 `auto`。
- `exportAfter`：作业成功后是否立即进入所属路线的导出步骤。

若 Agent 认为需要扩大作用域，它只能返回影响分析，不能直接改写 `ModifyRequest.scope`。

## 十、任务状态机

### 10.1 通用状态

```text
queued
  → analyzing
  → awaiting_approval
  → executing
  → validating
  → committing
  → exporting
  → summarizing
  → completed
```

旁路终态为：

- `conflict`：基础版本、元素引用或文件状态不再匹配。
- `failed`：执行、检查或导出失败，附拥有故障的层和恢复入口。
- `rolled_back`：提交中断后已恢复原项目。
- `canceled`：用户取消且没有未恢复的写入。

每次状态变化追加到任务 `events.jsonl` 和项目 `events.jsonl`，浏览器通过 SSE 接收同一事件。

### 10.2 单页修改

```text
绑定当前页和选区
→ 校验 baseRevision
→ 归类 direct 或 agent
→ 生成修改预览
→ 在 staging 中执行
→ 运行所属路线要求的质量检查
→ 写入提交 journal
→ 原子替换页面作者源
→ 按 exportAfter 决定是否导出
→ 生成结果摘要和记忆候选
```

属性面板和拖拽产生的确定性编辑仍可在浏览器中即时预览，但只有用户选择“应用到项目”后
才进入上述提交流程。未应用编辑只存在于当前会话内存，不创建 revision。

### 10.3 多页修改

多页作业在修改前生成 `plan.json`，至少包含：

- 目标页面清单。
- 每页修改目标。
- 是否触及 Design Spec、Spec Lock、页面 roster、备注、动画或其他 sidecar。
- 预期保持不变的内容。
- 需要执行的 checker 和 exporter。
- 是否需要用户确认。

当用户已经明确给出准确页集合和修改目标，且 Agent 不扩大范围时，可以直接执行。以下情况
必须进入 `awaiting_approval`：

- 页面范围扩大。
- 修改目标存在互斥解释。
- 页面局部请求需要改变整套规格、顺序或故事结构。
- 修改会改变用户已经确认的沟通合同。

执行时锁定目标页面的基础版本，在隔离 staging 项目中修改全部目标页。全部检查通过后才提交。
提交使用 journal 和原页面快照；进程在多文件替换中崩溃时，下次启动必须完成提交或整体恢复，
不能留下部分新页和部分旧页。

首版使用一个 Agent 事务化处理多页。未来即使增加并行 Agent，计划、锁、检查和提交仍以一个
多页事务为边界。

## 十一、工作流集成

### 11.1 不新增顶层路线

Studio 是三个现有顶层路线的交互表面：

| 当前路线 | Studio 行为 |
| --- | --- |
| Generate PPTX | 展示生成进度、确认门、已完成页面和导出状态；按 live-preview 规则处理后续修改。 |
| Edit Native PPTX | 展示 round-trip 页面和 `page_plan.json` 选择；只重建计划修改的对象或页面。 |
| Create Template | 首版只展示路线进度和审阅产物，不复用 Generate 的页面编辑循环。 |

Studio 收到一个新项目请求时，仍先由 `workflows/routing.md` 决定路线。对于既有 PPTX 的
含糊请求，只询问“重做视觉”还是“保留原生并编辑”这一条必要判别问题。

### 11.2 Default Generate

- Stage 1 和 Stage 2 继续是阻塞确认门。
- Studio 可以把 Confirm UI 渲染为聊天卡片或模态视图，但提交必须调用共享服务端验证。
- Step 6 启动 Studio 后，页面可随生成逐步出现。
- Step 7 完成前，用户可浏览页面并记录修改请求，但 Agent 修改进入等待队列，不能跨过主流程。
- Step 7 成功后，等待队列按确认顺序进入修改事务。

### 11.3 Quick Generate

Quick 不补造 Strategist、确认 receipt、Design Spec 或 Spec Lock。Studio 只展示当前 Agent
决定、资源准备、SVG 状态、质量门和导出结果。若用户请求生成期交互预览，而现行路由要求
回到 Default，Studio 必须呈现该路由结果，不能静默保留 Quick。

### 11.4 Edit Native PPTX

页面聊天必须知道当前页面是源引用页、部分编辑页还是重建页。未修改页面继续按路线合同恢复，
不能因为 Studio 展示了 SVG 预览就把整页标记为重建。备注、旁白、转场和动画修改继续走其
sidecar 与 package 叠加路径。

### 11.5 修改拥有层

| 修改类型 | 拥有层 |
| --- | --- |
| 某页文字、图片、几何和局部布局 | 页面作者源。 |
| 支持范围内的整套颜色或字体替换 | Generate 的 spec 更新工具和后续质量门。 |
| 页面拆分、合并、增删、重排或故事重构 | 所属路线的 Plan 工件与 roster。 |
| 讲稿、旁白、转场和动画 | 对应 sidecar 与支持阶段。 |
| PPTX package 或资源错误 | Exporter 或产生该资源的工具。 |

Job Orchestrator 先判定拥有层，再准备 Agent 上下文和工具调用；不能把所有请求都降级为直接
编辑 SVG。

## 十二、检查与导出

### 12.1 检查策略

- 浏览器即时预览只证明页面可渲染，不代表通过 PPT Master 合同。
- 持久化 Agent 修改必须在 staging 中运行所属路线规定的质量检查。
- 检查失败时保留 staging、问题摘要和可重试入口，不修改正式作者源。
- 多页修改合并检查问题后一次修复，不在每个小改动后重复运行完整 checker。
- 现有 checker report 仍是质量权威，Studio 事件只是其摘要和链接。

### 12.2 导出策略

- 单页 Agent 作业默认 `exportAfter: true`，成功提交后重新导出一次。
- 多页作业在全部页面提交后只导出一次。
- 连续的确定性手动编辑可以先保持 staged，由用户一次应用并导出。
- 导出使用所属路线的现有命令和 postflight，不在 Studio 内重新实现 PPTX 打包。
- 下载入口只把 `exportRevision == deckRevision` 的文件标记为“最新”。

## 十三、记忆与经验

### 13.1 四层记忆

| 层级 | 内容 | 生命周期 |
| --- | --- | --- |
| 工作记忆 | 当前选择、最近消息、未完成作业和临时计划 | 当前会话。 |
| 页面记忆 | 本页沟通目标、已接受修改和不能破坏的局部约束 | 当前项目页面。 |
| Deck 记忆 | 受众、风格、统一术语、跨页模式和项目偏好 | 当前项目。 |
| 经验库 | 可复用的修改模式、失败条件和检查器修复经验 | 用户批准后跨项目。 |

会话摘要用于控制上下文长度，不等同于长期经验。摘要可以自动更新；长期经验必须经过提升流程。

### 13.2 提炼触发

任务同时满足以下条件后才生成记忆候选：

- 修改已经提交。
- 必需质量门通过。
- 导出成功，或用户明确接受不立即导出的作者源结果。
- 结果没有随后撤销。

提炼输入只包括可观察证据：用户请求、修改计划、文件差异摘要、Checker 结果、导出 receipt、
用户接受或撤销行为。不得保存模型内部推理。

### 13.3 候选结构

```json
{
  "schemaVersion": 1,
  "candidateId": "mem_01J...",
  "scope": "project",
  "trigger": "页面标题层级偏弱且正文密度不变时",
  "lesson": "优先扩大标题与正文的字号差，并保持既有左边界",
  "evidence": {
    "jobId": "job_01J...",
    "beforeRevision": "sha256:...",
    "afterRevision": "sha256:..."
  },
  "exceptions": [
    "标题已经接近安全区上限时不适用"
  ],
  "confidence": 0.82,
  "status": "proposed"
}
```

### 13.4 提升规则

- 页面和项目记忆可在“本次学到”卡片中接受、编辑或拒绝。
- 跨项目经验必须明确选择“保存为可复用经验”。
- 项目事实、客户数据和一次性内容不提升为全局经验。
- 经验必须描述适用条件和反例，不能只保存“以后都这样做”。
- 全局经验先进入独立本地经验库；不得自动修改 Skill prompt、workflow 或 reference。
- 若要把成熟经验变成仓库规则，走单独的维护和评审任务，并按 prompt layers 确定唯一所有者。

## 十四、服务 API 与事件

### 14.1 建议 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/project` | 项目、路线、阶段、版本、质量和导出摘要。 |
| `GET /api/slides` | 页面清单、缩略状态、revision 和待办数量。 |
| `GET /api/slides/<id>` | 页面内容、元素引用、标注和当前版本。 |
| `GET /api/conversations/<scope>/<id>` | 读取页面或整套会话。 |
| `POST /api/conversations/<scope>/<id>/messages` | 发送用户消息并创建或继续作业。 |
| `POST /api/jobs` | 用结构化 `ModifyRequest` 创建作业。 |
| `GET /api/jobs/<id>` | 获取计划、状态、问题和 receipts。 |
| `POST /api/jobs/<id>/approve` | 批准作用域扩大或阻塞计划。 |
| `POST /api/jobs/<id>/cancel` | 取消未提交作业。 |
| `GET /api/events` | SSE 任务和消息事件流。 |
| `POST /api/export` | 对当前 deckRevision 发起所属路线导出。 |
| `GET /api/memory/candidates` | 获取待处理记忆候选。 |
| `POST /api/memory/candidates/<id>/accept` | 编辑并接受候选。 |
| `POST /api/memory/candidates/<id>/reject` | 拒绝候选。 |

现有 `svg_editor` API 在兼容期保留。新 API 应通过共享 Slide Service 调用相同的路径校验和
SVG 编辑逻辑，不复制实现。

### 14.2 事件类型

首版至少包括：

- `message.created`
- `message.delta`
- `job.created`
- `job.plan_ready`
- `gate.required`
- `job.execution_started`
- `validation.started`
- `validation.failed`
- `validation.passed`
- `revision.committed`
- `export.stale`
- `export.started`
- `export.completed`
- `memory.candidate_created`
- `job.completed`
- `job.failed`

事件携带 `eventId` 和项目内单调序号，浏览器断线后可从最后事件续传。SSE 用于服务端推送，
所有改变状态的操作仍使用 REST，避免把命令和事件混在 WebSocket 消息中。

## 十五、安全与恢复

### 15.1 文件安全

- 所有浏览器输入路径先归一化为项目内相对路径。
- 服务端以解析后的绝对项目根执行 `relative_to` 或等价边界检查。
- 浏览器不能提交任意本地绝对路径。
- 作者源写入使用临时文件、刷新、原子替换和 journal。
- 图片和附件只从所属项目的允许目录提供。
- HTML、SVG 属性和用户文本在进入预览时按上下文转义。

### 15.2 冲突与恢复

- `baseRevision` 不匹配时返回 `409 conflict`，不自动覆盖。
- 服务启动时扫描未完成 commit journal，完成提交或从快照恢复。
- Agent 进程中断不影响正式作者源；作业可从 staging 重试。
- Checker 或 Exporter 中断后保留完整命令 receipt 和有限错误摘要。
- Studio lock 继续是单项目服务发现源，重复启动复用或明确拒绝端口冲突。

### 15.3 隐私

- Studio 不存储 API Key。
- Agent Gateway 只接收任务需要的页面上下文和权威工件，不默认上传整个项目。
- 对话与记忆默认保存在当前项目本地。
- 跨项目经验提升前显示将被保存的完整文本和适用范围。
- 不在日志中保存模型内部推理或未脱敏的凭据。

## 十六、代码与文档落点

建议实现目录：

```text
skills/ppt-master/
├── scripts/
│   ├── studio/
│   │   ├── server.py
│   │   ├── project_service.py
│   │   ├── conversation_service.py
│   │   ├── revision_service.py
│   │   ├── job_orchestrator.py
│   │   ├── workflow_adapter.py
│   │   ├── agent_gateway.py
│   │   ├── memory_service.py
│   │   ├── schemas/
│   │   ├── web/                 # Vite + React 源码
│   │   └── static/              # 安装包携带的构建产物
│   └── docs/
│       └── project-studio.md
└── workflows/
    └── stages/
        └── project-studio.md
```

文档责任划分：

- `workflows/stages/project-studio.md` 只说明何时启动、阻塞门、路线交接和重入位置。
- `scripts/docs/project-studio.md` 说明服务命令、API、状态机、文件协议、恢复和远程访问。
- `scripts/studio/schemas/` 定义服务端强制执行的 JSON grammar。
- `references/` 只在需要新的设计判断 craft 时增加内容，不存放 API 或状态机复述。
- 本文保留为规划与决策记录，运行时文件不能依赖本文。

`svg_editor/server.py` 在迁移期继续作为兼容入口。最终可由它启动共享 Studio 服务或跳转到
新界面，但 `visual_review.py` 使用的健康检查和 `live_preview/lock.json` 发现合同不能突然失效。

## 十七、实施阶段

### 阶段 0：冻结合同

交付：

- `ModifyRequest`、Job、Event、Revision、Memory schema。
- 路线与 Studio 的交接矩阵。
- 项目文件结构和恢复规则。
- 现有 `svg_editor` API 的复用边界。

退出条件：在不写 UI 的情况下，可以用 fixtures 验证请求、版本冲突和任务事件序列。

### 阶段 1：Studio 外壳与只读项目视图

交付：

- Vite + React 三栏界面。
- 页面列表、SVG 画布、项目状态、质量和导出状态。
- REST + SSE 基础设施。
- 兼容 `live_preview/lock.json` 的启动与发现。

退出条件：生成过程中新页面可以出现；刷新或重启后仍能恢复项目状态。

### 阶段 2：单页聊天修改

交付：

- 本页线程和选区上下文。
- 结构化修改请求。
- `baseRevision` 冲突检查。
- direct/agent 路由、差异预览、staging、检查、提交和导出。
- 失败后保留 staging 并可重试。

退出条件：完成“选中标题→聊天修改→质量通过→新 PPTX→刷新后会话仍在”的完整链路。

### 阶段 3：多页 Agent 作业

交付：

- 页面多选与整套会话。
- 影响分析和确认卡片。
- 多页 revision 锁定、事务 staging、journal 提交和整批恢复。
- 一次质量检查修复循环和一次导出。

退出条件：任一目标页故障时正式项目零部分写入；全批成功时一次性获得新 deckRevision。

### 阶段 4：工作流与确认门整合

交付：

- Default Stage 1 / Stage 2 卡片或模态视图。
- Quick、Edit Native 和 post-export 修改状态展示。
- 生成期修改等待队列。
- owning-layer 判定和正确重入点。

退出条件：Studio 不创建伪造 receipt，不跨越阻塞门，不把 Edit Native 页误转为普通 Generate 页。

### 阶段 5：记忆与经验

交付：

- 页面、Deck 和经验候选提炼。
- “本次学到”卡片。
- 接受、编辑、拒绝和撤回。
- 按作用域检索和 Agent 上下文注入。

退出条件：失败或撤销任务不产生可用经验；跨项目经验未经确认不会被检索。

### 阶段 6：兼容与产品化

交付：

- 现有预览入口迁移。
- 远程 SSH 端口转发说明。
- 大项目性能、断线续传和崩溃恢复。
- Agent Gateway 的第二个适配器。
- 用户文档与路线文档同步。

## 十八、首版验收场景

首版至少通过以下端到端场景：

1. 选择一个文字元素，通过本页聊天修改文字和字号，检查并重新导出。
2. 框选一个区域，要求 Agent 重排区域内容，不影响区域外对象。
3. 页面文件在消息发送后被外部修改，作业返回冲突且不覆盖新版本。
4. 选择三页统一标题样式，预览计划后一次提交和一次导出。
5. 三页作业中一页未通过 checker，正式项目保持全部旧版本。
6. Agent 在执行中断，重启 Studio 后能够重试或取消，没有部分页面写入。
7. 页面提交后旧 PPTX 显示过期；新导出成功后状态恢复为最新。
8. Default Generate 在 Step 7 前收到修改请求，任务排队而不提前修改页面。
9. Edit Native PPTX 修改一页后，未改页面仍按 round-trip 合同恢复。
10. 成功任务提出记忆候选；拒绝后不再检索，接受后只在声明作用域生效。
11. 用户撤销已接受修改，相应经验候选失效或降低置信度。
12. 浏览器尝试访问项目根之外的路径，服务端拒绝且不泄露文件内容。

## 十九、关键决策

本规划预先固定以下方向，避免实施中反复分叉：

- 使用现有受约束 SVG 与 round-trip 作者源，不采用 PPTD 中间层。
- Studio 是本地 Skill 控制面，不成为独立 SaaS 或桌面壳。
- 左侧聊天、本页线程和整套线程是核心交互，不把聊天藏在标注弹窗中。
- 多页修改首版采用单 Agent 事务，不默认并行生成页面。
- 使用 REST 命令与 SSE 事件，不在首版引入双向 WebSocket 状态协议。
- 项目文件是可恢复权威，数据库只做可重建索引。
- 长期经验必须用户批准，不能自动修改仓库 prompt。
- Studio 复用现有确认、检查和导出权威，不复制业务规则。

## 二十、后续文档同步

进入实现后，需要在同一变更中处理以下文档关系：

- 更新 `fastppt-project-workflow.md`，删除“不支持非 FastPPT PPTX 原生编辑”的旧边界，改为指向
  当前 `workflows/routing.md`。
- 在 `scripts/docs/svg_editor.md` 中说明旧编辑器与 Studio 的兼容关系。
- 在 `workflows/stages/live-preview.md` 中只增加 Studio 的启动和交接指针，不复制 API 细节。
- 在 `docs/technical-design.md` 及中文译本中增加本地交互控制面，但保持“Skill 而非 SaaS”的定位。
- 在 `docs/roadmap.md` 及中文译本中按实际交付阶段更新状态，不能把本规划当作已实现能力。

在上述同步完成前，本文只作为实施规划存在。
