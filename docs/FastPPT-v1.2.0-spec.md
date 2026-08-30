# FastPPT v1.2.0 产品与工程 Spec

- 文档版本：`v1.2.0`
- 产品版本：`v1.2.0`
- 技术版本：`1.2.0`
- 数据合同版本：`1.2.0`
- 日期：2026-08-24
- 状态：v1.2.0 开发与验收唯一依据
- 正式仓库：`https://github.com/FastR-D/FastPPT`
- 开发分支：`main`
- 计划发布标签：`v1.2.0`

## 0. 文档地位与阅读规则

本文件是 FastPPT v1.2.0 的唯一必要背景、产品、工程、实施和验收依据。下一位开发者或 AI 只需要阅读本文件即可开始 v1.2.0 工作，不得要求先阅读 v1.1.0 Spec、旧交接记录、旧 Skill 文档或历史建议。仓库中的 `AGENTS.md` 和用户当前对话中的明确指令仍然优先于本文件。

优先级如下：

1. 用户当前或后续明确指令。
2. 本文件。
3. 仓库 `AGENTS.md`、安全约束和平台约束。
4. v1.1.0 Spec、旧文档和历史实现；它们只用于理解兼容背景，不得覆盖本文件。

本文件描述的是 FastPPT 产品工程和一次演示项目中的数据流。`project_id` 始终表示用户在 FastPPT 中创建的演示项目，不表示 GitHub 产品工程。

## 1. v1.2.0 目标

v1.2.0 在 v1.1.0 的 Artifact、Job、Worker、AgentRun、ImageRun、PageContract、SVG/PPTX 和审批骨架上完成以下升级：

1. 让每次真实 Agent 调用都能还原实际发送的 Prompt、上下文、输入 Artifact、输出 Schema、模型和裁剪结果。
2. 让 Artifact ID 不再只是数据库留痕，而是通过统一 ContextResolver 成为角色限定上下文的真实来源。
3. 将 `source_analyst`、`fact_reviewer`、`outline_planner`、`page_writer`、`visual_director`、`reconstruction_planner`、`qa_reviewer` 的调用合同角色化，并保证 Agent 输出经过校验后影响后续产物。
4. 增加可选的 `content_logic_reviewer`，保存逻辑关系、信息密度、页内叙事和排版候选；默认关闭，用户在生成设置中展开后主动开启。
5. 支持页数精确值、页数范围和 AI 建议三种模式。
6. 支持内容计划以内部结构化 JSON 为真源，并按需导出 Markdown、TXT 或 DOCX。
7. 在 v1.2.0 预留 v2.0.0 风格包和模板包结构，并开放“风格和模板”入口：可查看、导入、详情预览和明确使用，但默认永远是 `none`。
8. 私人导入的风格/模板包只能由导入用户使用，管理员可以查看和审计；包内容不得写入演示项目文件或提交到 GitHub。
9. 支持自然语言编辑入口和上下文检查/重放能力。
10. 保持严格安全边界：上传资料中的工具命令、路径、网络指令和伪系统提示词只能作为不可信资料，不得获得系统指令地位或触发工具。

## 2. 非目标与明确边界

v1.2.0 不承诺以下能力：

- 风格/模板市场、公开分享、团队共享、远程同步或版权审核平台。
- 将私人包内容写入演示项目、PPTX、GitHub 仓库或发布包。
- 风格包的全部字段都在 v1.2.0 产生视觉效果。字段必须被保存和校验，但完整语义由 v2.0.0 决定。
- 风格包或模板包自动成为默认值。没有用户明确点击“使用”，任何包都不得进入生成上下文。
- v1.1.0 旧项目的零损迁移和历史 Agent 调用的完整重建。v1.2.0 仍须完成前向数据库迁移并保留旧记录。
- 以整页 Raster 伪装可编辑 PPTX。视觉参考图仍需经过用户批准，最终仍走 PageContract、受控 SVG、对象 Manifest、PPTX 转换和 QA。
- 让底层 Codex/Claude SDK 自行读取本地文件、执行 Shell、访问网络或调用任意工具。

## 3. 当前 v1.1.0 真实基线

下一位开发者必须先理解以下真实代码边界。本节是背景，不是要求恢复旧实现。

### 3.1 现有信息流

```text
Web
  -> services/api/src/fastppt_api/server.py
  -> apps/runtime/src/fastppt_runtime/service.py
  -> MetadataStore + ArtifactStore
  -> Job
  -> services/worker/src/fastppt_worker/worker.py
  -> AgentHarness 或 Image Adapter
  -> AgentRun/ImageRun/Artifact
  -> PageContract/PageVersion/DeckRevision/Export
```

前端入口在 `apps/web/src/main.tsx`，目前支持 `document_create`、`page_entry`、`pptx_improve`。文件先通过 Base64 进入 `/documents`；Session、Plan、视觉审批和重建确认分别通过 API 提交。浏览器不得持有模型密钥。

API 在 `services/api/src/fastppt_api/server.py` 负责身份、项目归属、Idempotency-Key、Base64 解码和路由，不直接拼接模型请求。

运行时在 `apps/runtime/src/fastppt_runtime/service.py` 负责文档、事实、PageContract、Artifact、AgentRun、ImageRun、Operation、重建和导出。Artifact 的写入和哈希校验在 `_record_artifact()`、`_artifact_bytes()`。

Worker 在 `services/worker/src/fastppt_worker/worker.py` 消费：

```text
parse_document
analyze_source
agent_run
image_run
reconstruct_page
execute_operation
export_project
```

Agent SDK 适配器位于 `packages/agent-harness/src/fastppt_agent_harness/harness.py` 和 `packages/agent-harness/bridges/codex.mjs`；图片适配器位于 `packages/agent-harness/src/fastppt_agent_harness/image.py`。

### 3.2 v1.1.0 的上下文缺口

v1.1.0 允许 `AgentRun.input_artifact_ids` 记录源文件、PageContract 或视觉 Artifact，但 Codex/Claude bridge 实际只收到 `AgentRequest.prompt` 和 `output_schema`。`metadata` 不会自动序列化到 Prompt，Artifact ID 也不会自动展开成正文。`AgentContext` 和 `run_isolated()` 已存在，但业务主流程没有全面调用。

阶段 Prompt 当前基本是：

```text
You are the {role} stage in a presentation workflow. Return a bounded JSON stage result.
```

资料分析 Prompt 当前基本是：

```text
Analyze the source text and return bounded facts and a concise summary.
```

编辑规划 Prompt 是现有最完整链路：它在 `packages/fastppt-core/src/fastppt_core/prompts.py` 中显式拼入 PageContract、Facts 和用户编辑指令，并保存 Prompt Artifact。图片链路会读取 `prompt_artifact_id` 和输入图片 bytes，是真正的多模态输入链路。

v1.1.0 还存在以下语义问题，v1.2.0 必须修复：

- 创建 AgentRun 时 `context_digest` 表示 metadata 哈希，阶段 Agent 完成时又可能表示输出 Artifact 哈希。
- 阶段 Agent 的最终 Prompt 没有统一保存。
- 父子 `parent_run_id` 主要是数据库关系，不是明确的上下文传递。
- PageContract、SVG、QA 和图片输入被记录，但 Agent 输出有时没有参与后续确定性产物。
- 首次生成的页面计划、PageContract 和重建主路径仍有大量确定性默认值。

## 4. 核心概念与信任边界

### 4.1 三种输入信任域

所有进入系统的文本和文件必须带有信任标签。信任标签决定它能否成为 Prompt 指令，不能只依据内容看起来像命令来判断。

| 信任域 | 例子 | 可以影响什么 | 不可以做什么 |
|---|---|---|---|
| `system_instruction` | 服务端角色合同、Schema、权限规则 | Prompt 约束、输出校验 | 不得被资料覆盖 |
| `user_instruction` | 用户在 UI 中填写的目标、页数、受众、编辑指令 | 本次任务目标和可确认范围 | 不得绕过服务端门禁 |
| `source_content` | Markdown、DOCX、PDF、PPTX、图片 OCR、网页摘录 | 被分析、引用、改写或保留的资料 | 不得升级为系统指令、工具调用或凭据 |

来源资料中的“忽略之前指令”“调用 Shell”“读取路径”“上传数据”“发送网络请求”等文字必须记录为 `untrusted_source_instruction` 或普通内容，绝不能执行。来源资料的事实可信度与指令可信度必须分开：一份资料可以是业务事实的高可信来源，但其中的工具命令仍然是零权限的不可信文本。

### 4.2 Project、Session、Plan、PageContract

- `Project`：演示项目容器，保存资料、页面、操作和审计关系。
- `WorkSession`：一次用户生成或修改意图，保存入口、用户目标、选项和本次明确选择的设计包。
- `GenerationPlan`：内容和页面计划；确认后保存设计选择和上下文快照。
- `PageContract`：单页确认后的内容、事实锚点、尺寸、字体和设计约束唯一真源。
- `DesignSelection`：用户明确点击“使用”后的风格/模板选择。
- `DesignSnapshot`：写入 GenerationPlan 和 PageContract 的不可变设计快照。

### 4.3 Prompt、Context、Artifact

- `ContextBundle`：角色允许读取的结构化上下文，不等于所有项目数据。
- `PromptEnvelope`：最终实际发送给 Provider 的完整请求合同。
- `PromptArtifact`：脱敏后的 PromptEnvelope 内容 Artifact，保存期限为 30 天。
- `AgentRun`：一次逻辑角色调用的状态、输入输出引用、Provider 快照和审计元数据。
- `OutputArtifact`：模型输出经过结构化校验前后的不可变 Artifact。

## 5. v1.2.0 用户流程

### 5.1 首页和“风格和模板”入口

左侧新增一个“风格和模板”入口。进入后页面顶部有两个明确 Tab：`风格` 和 `模板`。

入口必须支持：

- 查看系统可见包和当前用户私有包。
- 导入一组风格/模板包。
- 查看详情、预览图、版本、适用页面类型、来源和许可证声明。
- 明确点击“使用”后才选择。
- 只打开详情而不点击“使用”时，不改变 Session、Plan 或首页状态。
- 默认状态为 `未选择`，不得因为历史使用记录、包排序或系统内置包而自动选择。

用户点击“使用”后：

1. 创建或更新当前 WorkSession 的设计选择草稿。
2. 将 `pack_id`、版本、内容哈希和选择来源写入审计。
3. 只有本次生成确认时，才把设计选择固化到 GenerationPlan 的 DesignSnapshot。
4. 首页显示当前已使用的风格名、模板名或“未选择”。

v1.2.0 可以让已选包影响允许的视觉方向、色彩、字体、密度和版式参考，但未实现的字段必须保留并在能力矩阵中标记为 `reserved_not_applied`。未选择时不得注入任何风格包 Prompt 内容。

### 5.2 私有包导入

导入包由用户上传 zip 或目录。一个导入包可以是单个风格/模板包，也可以是一次包含多个 StylePack、TemplatePack 及其资源的 `PackBundle`。服务端必须先验证 Bundle，再以原子方式登记其成员并复制到运行时私有目录，例如：

```text
runtime-data/private-packs/{owner_id}/{pack_id}/{version}/
```

组包必须有根级 `bundle_manifest.json`，至少包含 `bundle_id`、`schema_version`、`display_name`、`version`、`content_hash` 和 `members`。`members` 中每个成员都必须拥有独立的 `pack_id`、`pack_kind`、版本、哈希和 Manifest。用户在“风格”或“模板” Tab 中选择的是成员，不是隐式选择整个 Bundle；成员之间的依赖必须在 Manifest 中声明并在使用时校验。Bundle 内任一成员校验失败时，整次导入失败，不得留下半套可使用内容。

该目录必须加入 Git 忽略规则，不得位于提交到 GitHub 的产品源码、演示项目目录或发布 Artifact 中。Project 只保存 Bundle/Pack 的 ID、版本、内容哈希、来源和选择快照，不复制完整包内容。项目文件不得嵌入包内图片、字体、Prompt 片段或其他原始资源；需要进入生成请求的资源仍通过私有运行时目录按授权读取，并在 PromptEnvelope 中记录引用哈希。

权限规则：

- 导入用户可以查看、使用、归档自己的包。
- 其他普通用户不能枚举、读取、使用该包。
- 管理员可以查看包元数据、Manifest、审计状态和安全校验结果；管理员查看不等于自动获得使用权。
- API、Artifact 下载和 Worker 读取都必须校验 `owner_id`、包范围和项目归属。

导入校验至少包括：Manifest 存在且版本有效、路径不能越界、拒绝符号链接、拒绝可执行文件、资源大小和总大小有限制、媒体类型与内容一致、哈希匹配、Prompt 字段不能包含系统密钥或未脱敏 Provider 配置。

### 5.3 输入选项

页面生成设置中，页数控件旁边提供可展开的高级输入。以下字段不是强制用户填写：

```json
{
  "language": "zh-CN",
  "audience": "",
  "purpose": "",
  "page_count": {"mode": "exact|range|auto", "exact": null, "min": null, "max": null},
  "content_mode": "strict_preserve|assisted",
  "improvement_mode": "redesign|high_fidelity",
  "logic_diagnosis_enabled": false,
  "output_formats": ["markdown"],
  "user_instruction": ""
}
```

语言缺省时根据源资料推断；受众和目的缺省时由系统生成“待确认推断”，在内容确认页显示。页数支持精确值、范围和 AI 建议。`logic_diagnosis_enabled` 默认关闭，只有用户在展开区域主动打开才执行 `content_logic_reviewer`。

### 5.4 内容确认门禁

内容确认页一次展示：

- 整体大纲和页间叙事。
- 页数和页数推断理由。
- 每页标题、核心观点、正文、事实锚点和视觉配图建议。
- 逻辑诊断摘要（仅在用户打开该选项时显示）。
- 用户填写或系统推断的语言、受众、目的。

用户可以逐页修改，最后一次性确认内容计划。内容计划的内部真源始终是结构化 JSON；用户选择的 Markdown、TXT、DOCX 只是导出格式，不是模型直接决定的文件格式。

### 5.5 内容变更和设计变更

内容确认后修改标题、正文、事实、页数或逻辑结构时，服务端必须显示二次确认和提醒：修改可能导致已生成视觉稿、审批和重建结果失效，建议重新开始。用户可以继续，但必须明确确认。

变更规则：

- 设计选择保留。
- 尚未生成的页面采用新内容和当前设计选择。
- 已生成页面保持原样。
- 计划状态允许 `mixed_design` 或 `mixed_content`，首页和导出报告必须明确显示。
- 需要整套统一时，用户必须选择“从头重新生成”。

### 5.6 视觉和重建门禁

沿用 v1.1.0 的顺序：设计确认、图片/视觉稿生成、代表页或逐页视觉审批、重建前披露、可编辑重建、SVG/PPTX QA、导出。

选择风格或模板不得跳过内容确认和视觉审批。视觉参考图中的文字、数字、专名不得覆盖 PageContract；PageContract、锁定事实和用户确认逐字文本仍是页面文字唯一真源。

## 6. 风格包与模板包合同

### 6.1 包类型

风格包和模板包分开建模，均可为空，也可以同时选择。

`StylePack` 主要描述视觉系统：色彩、字体、密度、图形语言、图片处理和渲染约束。

`TemplatePack` 主要描述结构系统：页面角色、版式蓝图、母版参考、固定资源、模板图片和适用页面类型。

### 6.2 Manifest 最低字段

两种包都必须支持以下字段，v1.2.0 未使用的字段也必须保存，不得导入后静默丢弃：

```json
{
  "schema_version": "1.0",
  "pack_id": "pack_...",
  "pack_kind": "style|template",
  "display_name": "",
  "description": "",
  "version": "",
  "status": "active|archived|invalid",
  "scope": "system|private",
  "owner_id": "",
  "license": "",
  "manifest_artifact_id": "",
  "content_hash": "sha256:...",
  "preview_artifact_ids": [],
  "color_palette": {},
  "typography": {},
  "density": {},
  "visual_language": {},
  "layout_blueprints": [],
  "image_treatment": {},
  "rendering_constraints": [],
  "prompt_fragments": [],
  "supported_page_types": [],
  "asset_ids": [],
  "capability_matrix": {}
}
```

`capability_matrix` 必须标明每个字段在 v1.2.0 的状态：`applied`、`reference_only`、`reserved_not_applied` 或 `rejected`。

### 6.3 选择快照

```json
{
  "design_selection_id": "designsel_...",
  "style_pack_id": null,
  "style_version": null,
  "style_content_hash": null,
  "template_pack_id": null,
  "template_version": null,
  "template_content_hash": null,
  "selection_scope": "session|plan|page",
  "selected_by": "user_id",
  "selection_source": "private|system|none",
  "status": "draft|used|superseded|mixed",
  "created_at": "",
  "used_at": ""
}
```

进入详情不创建 `used` 记录；点击“使用”才创建。GenerationPlan 确认时复制不可变 DesignSnapshot。PageContract 保存最终采用的设计快照引用和能力矩阵，保证未来包被归档或删除后历史仍能解释。

### 6.4 GitHub 和项目卫生

- 私有包、源文件、完整 Prompt、原始响应和用户内容不得进入 GitHub。
- `.gitignore` 必须覆盖 `runtime-data/private-packs/` 和本地审计导出目录。
- 发布检查必须扫描包路径、日志和 release evidence，发现私有包或密钥即阻断发布。
- 项目文件只保存引用、快照、哈希和必要的非敏感设计约束。

## 7. PromptEnvelope 与上下文装配

### 7.1 PromptEnvelope

所有真实 Agent 和图片模型请求在发送前必须生成统一 Envelope：

```json
{
  "envelope_id": "envelope_...",
  "prompt_id": "source_analysis|fact_review|outline|logic_review|page_write|visual_direction|image_prompt|reconstruction|qa|edit_plan",
  "prompt_version": "1.2.0",
  "input_contract_version": "1.2.0",
  "output_schema_version": "1.2.0",
  "role": "",
  "task_id": "",
  "session_id": "",
  "parent_run_id": null,
  "system_prompt": "",
  "user_prompt": "",
  "rendered_context": {},
  "input_artifact_ids": [],
  "input_artifact_hashes": [],
  "input_trust_labels": [],
  "output_schema": {},
  "token_budget": {},
  "truncation_report": {},
  "input_context_digest": "sha256:...",
  "prompt_digest": "sha256:...",
  "provider_snapshot": {},
  "created_at": ""
}
```

`metadata` 仍可用于本地运行记录，但不得再被误认为模型上下文。模型真实看到的唯一内容是 Envelope 渲染出的 `system_prompt`、`user_prompt`、`rendered_context` 和 Provider 结构化输出约束。

### 7.2 ContextResolver

新增统一 `ContextResolver`，职责是：

1. 校验 Artifact 属于当前 Project、用户和角色允许范围。
2. 读取 Artifact bytes 并验证 SHA-256。
3. 根据角色合同筛选字段，不复制整个项目。
4. 将源正文、Facts、PageContract、图片元数据和父 Agent 输出转换为结构化 ContextBundle。
5. 进行分片、摘要、预算和裁剪，并生成 TruncationReport。
6. 按 Prompt 版本渲染最终文本或多模态输入。
7. 计算 `input_context_digest` 和 `prompt_digest`。
8. 保存脱敏 PromptEnvelope Artifact，并将其 ID 写入 AgentRun/ImageAttempt。

不能只把 Artifact ID 放入 Prompt 让模型自行猜测内容；不能让 Agent SDK 通过临时目录、Shell 或网络自行读取 Artifact。

### 7.3 父子 Agent 上下文

父 Agent 输出必须先保存为 OutputArtifact。子 Agent 通过 ContextResolver 读取父输出中允许的字段，并记录 `parent_run_id` 和父输出哈希。父子关系不是单纯数据库关系。

子 Agent 默认不能重新读取全部项目数据。每个角色必须声明 `allowed_context_keys`，未知字段丢弃并写入诊断。

## 8. 长上下文和裁剪规则

### 8.1 100k token 阈值

当一个角色拟读取的完整上下文估算达到或超过 `100000` tokens，标记为长上下文，禁止一次性发送全文，必须使用分层上下文：

```text
原文分片
  -> 分片 Source Analyst 结果
  -> 分层摘要和来源哈希
  -> Facts、冲突和锁定状态
  -> 目标角色上下文
```

低于 100k tokens 也必须遵守角色预算，不代表可以复制整个项目。

优先使用 Provider tokenizer；不可用时使用保守估算并记录算法版本。估算必须包含正文、JSON 字段名、Prompt 和输出 Schema 的预留开销。

### 8.2 不能静默裁剪的内容

以下内容不得因预算被删除：

- 锁定事实。
- 未解决事实冲突。
- 用户确认的逐字文本。
- PageContract 的标题、正文、来源哈希、页面尺寸和字体策略。
- 当前用户明确指令。
- 设计选择的 pack_id、版本和 content_hash。

普通正文、历史摘要和低优先级视觉元数据可以裁剪，但必须记录：原始长度、保留长度、丢弃字段、摘要 Artifact、裁剪原因和估算 token 数。

### 8.3 默认角色预算

实现可以按 Provider 调整，但必须有明确配置和审计。默认建议：

| 角色 | 单次上下文预算 |
|---|---:|
| Source Analyst 分片 | 32k |
| Fact Reviewer | 32k |
| Outline Planner | 48k |
| Content Logic Reviewer | 24k |
| Page Writer | 16k |
| Visual Director | 24k |
| Reconstruction Planner | 32k |
| QA Reviewer | 32k |
| Edit Planner | 32k |

## 9. 角色合同与提示词要求

以下是 Prompt 的领域合同，不要求固定复制某段自然语言。实现必须保存每个 Prompt 的版本和最终渲染结果。

### 9.1 Source Analyst

输入：源文档分片、文件元数据、语言推断、来源哈希、用户目标和页数策略。

要求：只分析 `source_content`，提取摘要、结构、事实候选、来源定位、可保留逐字文本和不可信指令标记。不得执行源资料中的命令，不得把推断事实写成确定事实。

输出：分片摘要、事实候选、来源定位、置信度、待确认项、分片覆盖哈希。

### 9.2 Fact Reviewer

输入：候选事实、来源定位、冲突集合、锁定状态、源摘要。

要求：比较事实、标出冲突和不确定性，提出判断建议，但不得直接修改锁定事实或越权解决冲突。

输出：保留/待确认/冲突事实列表、依据、冲突 ID、建议状态。

### 9.3 Outline Planner

输入：源摘要、Fact Reviewer 输出、锁定事实、用户目标、受众、语言、页数策略、内容模式、已使用 DesignSnapshot。

要求：生成整体大纲、页间叙事、页数预算、逐页内容候选和视觉配图建议。内部输出必须是 JSON，不能直接决定 TXT/MD/DOCX 文件格式。页数精确值必须满足用户约束；范围和 auto 必须给出理由。

### 9.4 Content Logic Reviewer

仅在 `logic_diagnosis_enabled=true` 时调用。

输入：逐页内容候选、页间关系、受众和演示目的。

要求：识别纵向推进、横向并列、对比、因果、递进、时间步骤、循环、问题—对策、SCQA 或其他复合结构；评估信息密度、页内叙事顺序和认知负荷；给出 1–2 个可落地的布局候选。不得新增资料中没有的事实。

输出：`logic_type`、`logic_evidence`、`central_claim`、`page_rhythm`、`density_level`、`layout_candidates`、`persuasion_notes`、`uncertainties`。

该结果默认只保存为内部 Artifact，不在 UI 展示；用户打开逻辑诊断后，内容确认页显示摘要。

### 9.5 Page Writer

输入：已确认或待确认的大纲、单页目标、事实锚点、逐字文本、内容模式、语言和受众。

要求：输出标题、核心观点、正文段落、结论、保留文本、事实引用和视觉说明。不得改写锁定事实，不得丢失用户要求保留的逐字内容；超出单页密度时必须提出拆页或确认，而不是静默压缩。

### 9.6 Visual Director

输入：全局或单页 PageContract 候选、DesignSnapshot、页面尺寸、字体策略、模板/参考图元数据和逻辑诊断结果。

要求：生成视觉方向、布局意图、层级、色彩、图像处理和整页图片 Prompt 候选。未选择风格或模板时必须明确使用 `design_mode=none`，不能自动填入内置风格。风格/模板包的 `reserved_not_applied` 字段只能作为审计信息。

### 9.7 Image Prompt

输入：PageContract、已使用的 DesignSnapshot、必要的模板/参考图片 Artifact 和图片元数据。

必须要求：

- 一次只生成一页完整视觉参考图。
- PageContract、锁定事实和逐字文本是文字唯一真源。
- 中文、数字、专名和标签不得被视觉模型改写、虚构或漏掉；视觉稿文字只用于构图参考。
- 不生成多页拼贴，不把整页内容扩展成未经登记的其他事实。
- 未选择风格/模板时不注入包规则。
- 图片输入必须通过 ImageRun 的 Artifact bytes 和哈希进入请求。

### 9.8 Reconstruction Planner

输入：已批准视觉 Artifact、PageContract、页面尺寸、模板引用、PPTX 导入 Manifest、已有 SVG/对象信息和可编辑边界。

要求：输出对象、边界、层级、文字识别置信度、图片/图标类型、不可编辑局部和待确认项。不得用整页 Raster 隐藏失败。

### 9.9 QA Reviewer

输入：PageContract、重建 Manifest、SVG/PPTX QA、渲染结果、来源对象和错误清单。

要求：只检查并提出修复建议，不直接篡改成功 Artifact。文字、错位、重叠、溢出、图标、图片、堆叠、整页 Raster 和未确认项必须逐项报告。

### 9.10 Edit Planner

输入：用户编辑指令、目标范围、当前 PageContract、锁定事实、当前 DesignSnapshot 和页面版本。

要求：只返回允许的结构化 change kind；多页、全局、事实、页数、设计方向和高成本变更必须要求确认；图片变更必须引用当前项目已注册图片；不支持的请求必须显式声明。

## 10. 角色参与矩阵

不是每条入口都需要调用全部角色，但每条实际调用必须留下 AgentRun、PromptEnvelope 和 OutputArtifact；调用结果必须经过校验并影响下一阶段。

| 入口/操作 | 最低角色链 |
|---|---|
| `document_create` | Source Analyst -> Fact Reviewer -> Outline Planner -> Page Writer -> Visual Director -> Image Prompt -> Reconstruction Planner -> QA Reviewer |
| `page_entry` | Outline Planner -> Page Writer -> Visual Director -> Image Prompt -> Reconstruction Planner -> QA Reviewer；用户开启逻辑诊断时插入 Content Logic Reviewer |
| `pptx_improve` 重设计 | Source/Import Analyst -> Fact Reviewer（有事实或冲突时） -> Outline Planner -> Page Writer -> Visual Director -> Image Prompt -> Reconstruction Planner -> QA Reviewer |
| `pptx_improve` 高保真重建 | Import Analyst -> Visual Director -> Image Prompt（需要视觉稿时） -> Reconstruction Planner -> QA Reviewer |
| 自然语言编辑 | Edit Planner；若影响视觉方向则 Visual Director；若影响视觉稿或重建则 Image Prompt、Reconstruction Planner、QA Reviewer |

如果某角色不适用于当前路线，AgentRun 记录中必须写明 `not_required` 的理由，而不是伪造一次无意义调用。

## 11. AgentRun、ImageRun 和审计字段

### 11.1 AgentRun 新增/统一字段

保留 v1.1.0 字段，并新增或统一：

```text
prompt_artifact_id
prompt_id
prompt_version
input_contract_version
output_schema_version
input_context_digest
prompt_digest
output_digest
context_manifest_artifact_id
truncation_report_artifact_id
parent_output_artifact_ids
design_selection_id
status
provider_snapshot
provider_request_id
usage_request_id
retry_of_run_id
```

`context_digest` 不再承担多重语义。兼容读取旧记录时可显示为 `legacy_context_digest`，新记录必须分别保存三个 digest。

### 11.2 ImageRun/ImageAttempt

ImageRun 必须保存 PromptArtifact、输入图片 Artifact ID 和输入哈希。ImageAttempt 还必须保存实际 Provider、模型、请求 ID、输入尺寸/媒体类型摘要、输出 Artifact 哈希、重试关系和未知提交状态。图片输入可以传 bytes，但必须由服务端在发送前从已授权 Artifact 读取。

### 11.3 输出影响证明

每次 Agent 输出必须有以下之一：

- 被写入并校验的下一阶段 Artifact。
- 被用于构造 PageContract、GenerationPlan、Operation 或 ReconstructionManifest 的字段映射记录。
- 被明确判定为建议未采纳，并保存理由和用户确认记录。

仅保存 AgentRun 不算“Agent 参与了产物生成”。

## 12. Prompt 检查、重放和保留

### 12.1 检查接口

新增项目级接口或等价 CLI：

```text
GET  /api/v1/projects/:projectId/agent-runs/:agentRunId/context
GET  /api/v1/projects/:projectId/agent-runs/:agentRunId/prompt
POST /api/v1/projects/:projectId/agent-runs/:agentRunId/replay
GET  /api/v1/projects/:projectId/design-packs
GET  /api/v1/projects/:projectId/design-packs/:packId
```

CLI 等价命令：

```text
fastppt context inspect <agent_run_id>
fastppt prompt replay <agent_run_id> --dry-run
fastppt prompt replay <agent_run_id> --execute
```

项目用户只能检查自己项目的上下文；管理员可以查看 Provider、模型、预算、裁剪和包审计信息。API Key、Authorization、Secret Reference 的真实值、环境变量值和凭据永不显示。

检查结果至少显示：Prompt 版本、最终 Prompt、渲染上下文、输入 Artifact/哈希、信任标签、输出 Schema、父子 AgentRun、上下文预算、裁剪报告、Provider 快照、输出 Artifact 和错误。

### 12.2 重放规则

默认 `--dry-run` 只按历史输入、Prompt 版本和 Provider 快照重新装配并比较 digest，不调用供应商。

真实重放必须显式 `--execute` 或 UI 二次确认：

- 新建独立 AgentRun/ImageAttempt。
- 不覆盖旧记录。
- 重新计算 Usage、费用风险和幂等键。
- 若历史输入 Artifact 已过期或被删除，进入 `replay_unavailable`，不得伪造成功。

### 12.3 保留期限

完整 PromptEnvelope、渲染上下文、原始模型响应以及可还原用户正文的临时上下文副本最多保留 30 天，之后全部删除。保留的最小运行元数据仅限于状态机、时间、角色、模型、Provider 非敏感快照、输入/输出不可逆哈希、错误代码和 Usage 统计，用于审计状态，不得由它们还原正文或密钥。

用户可以在 30 天内导出脱敏审计包。导出包不得包含 API Key、Authorization、Secret Reference 真实值或私有风格/模板包原始文件。

## 13. 内容计划和导出

AI 始终返回结构化 JSON，至少包含：

```json
{
  "workflowMode": "",
  "pageCount": {"mode": "exact|range|auto", "value": null, "min": null, "max": null},
  "audience": "",
  "purpose": "",
  "language": "",
  "storyline": [],
  "pageDrafts": [],
  "factImpact": {},
  "logicAnalysisArtifactIds": [],
  "visualDirection": {},
  "requiresConfirmation": true,
  "confirmationReasons": []
}
```

服务端根据这个 JSON 生成 `outline.md`、`outline.txt` 或 `outline.docx`。导出格式不能改变内容合同。DOCX 生成必须使用项目已有文档处理约束，并进行渲染检查；不能把 DOCX 生成权限交给 Agent。

## 14. 安全和权限要求

- Agent Harness 默认无 Shell、无任意文件系统、无任意网络、无工具调用。
- Codex/Claude 只接收 PromptEnvelope 生成的文本和明确的结构化输出 Schema。
- 图片模型只接收授权 Artifact bytes，不接受任意本地路径。
- 所有用户上传文本、OCR、文档 XML、PPTX XML、图片元数据和模型输出均视为不可信。
- Prompt injection 测试必须覆盖：伪系统提示词、Shell 命令、路径穿越、网络请求、密钥索取、角色升级和跨项目 Artifact ID。
- 风格/模板包导入必须防止 zip slip、符号链接、恶意 MIME、超大文件和脚本注入。
- 私有包查询必须按用户过滤；管理员查看必须进入审计日志。
- 不允许通过风格包的 `prompt_fragments` 覆盖系统安全规则、事实保护规则、输出 Schema 或用户确认门禁。

## 15. 数据库和兼容边界

v1.2.0 不以 v1.1.0 旧项目零损迁移作为发布条件，但启动时必须执行版本化前向迁移。旧记录不得删除；无法填充的新字段使用 `legacy`、`unknown` 或空值，并在 UI/检查工具中标明。

至少新增或扩展：

```text
design_packs
design_pack_versions
design_pack_membership
design_selections
prompt_envelopes
context_manifests
truncation_reports
logic_analysis_artifacts
```

迁移规则：

- 迁移必须幂等，可重复执行。
- 不能把私有包文件复制进 Project 数据目录。
- 不能删除旧 AgentRun、ImageRun、Artifact、PageContract、Operation 或 Export。
- 旧 AgentRun 允许没有 PromptEnvelope，只能标记 `legacy_context_unavailable`。
- 新代码必须同时支持新字段和旧记录读取。
- 从 v2.0.0 起再考虑更严格的历史数据完整迁移门槛。

## 16. 实施顺序

### P0：上下文真实性和安全边界

1. 新增 PromptEnvelope、ContextBundle、ContextResolver 和统一 digest。
2. 让源文本、Facts、PageContract、父输出和图片元数据按角色真实注入。
3. 所有 Agent/图片调用保存 PromptEnvelope Artifact 和裁剪报告。
4. 修复信任域，阻断资料中的工具调用和路径指令。
5. 阶段 Agent 输出必须进入下一阶段或产生明确未采纳记录。

### P1：可检查性、长上下文和用户流程

1. 实现 100k token 长上下文分层和不可裁剪字段。
2. 实现项目用户/管理员上下文检查、脱敏导出和 dry-run 重放。
3. 增加自然语言编辑入口和二次确认/失效规则。
4. 增加内容逻辑诊断开关和结构化 Artifact。
5. 增加页数 exact/range/auto、受众、目的、语言和输出格式选项。

### P1：风格/模板包预留和私有导入

1. 实现 StylePack、TemplatePack、DesignSelection、DesignSnapshot 和能力矩阵。
2. 实现左侧“风格和模板”入口、风格/模板 Tab、详情和明确“使用”按钮。
3. 实现私有包导入、Manifest 校验、哈希、权限和管理员审计。
4. 将选择快照注入 PageContract 和视觉 Prompt；未选择时严格保持 `none`。
5. 只对 v1.2.0 已声明 `applied` 的字段产生视觉影响，其他字段保留为 `reserved_not_applied`。

### P2：质量、文档和验收硬化

1. 前向迁移、旧记录读取和 GitHub/包卫生检查。
2. 脱敏 Prompt 回放和 30 天清理任务。
3. 真实 Codex 中转站、GPT-image-2 文生图和图生图证据。
4. 完成 Windows、本地 Worker、服务器模式和 PPTX QA 回归。

## 17. 测试和验收矩阵

### 17.1 单元测试

- PromptEnvelope 版本、digest、脱敏和字段完整性。
- ContextResolver 的 Artifact 归属、哈希、角色白名单和父子筛选。
- 100k token 阈值、分片、摘要和不可裁剪字段。
- 资料中伪工具命令不会进入系统指令或触发工具。
- 风格/模板 Manifest、哈希、路径穿越、符号链接、媒体类型和大小限制。
- 私有包跨用户不可见，管理员只能查看并产生审计。
- `none` 设计选择不会注入任何风格或模板 Prompt。
- 选择、取消、换包、mixed_design 和二次确认状态机。
- 内容计划 JSON 到 Markdown/TXT/DOCX 导出的确定性校验。

### 17.2 集成测试

- 三种入口均能形成正确的角色链和输入上下文。
- 每次 AgentRun 均能查到 PromptEnvelope、输入哈希和输出 Artifact。
- Agent 输出影响 PageContract、Plan、Operation 或重建 Manifest。
- 图片请求包含正确 Prompt、输入图片 bytes、媒体类型和哈希。
- 真实重放不会覆盖旧 AgentRun，也不会绕过 Usage 和确认。
- 30 天清理删除完整内容，但不破坏状态元数据。

### 17.3 真实供应商验收

必须保留脱敏证据：

1. Codex 中转站至少一次完整结构化 Agent 调用。
2. GPT-image-2 中转站至少一次文生图。
3. GPT-image-2 中转站至少一次带参考图的图生图。
4. Claude 官方站和中转站完成配置合同测试；不强制新增付费真实调用。

每次证据必须绑定 PromptEnvelope、输入/输出 Artifact 哈希、AgentRun/ImageAttempt、Provider 快照和 Usage Ledger，且不得包含密钥或私有包原始内容。

## 18. v1.2.0 发布阻断项

出现任一情况不得发布：

- 未选择风格/模板时仍自动注入内置风格。
- 详情页打开或历史选择自动改变当前 Session。
- 私有包可被其他普通用户枚举、读取或使用。
- 私有包、完整 Prompt、原始响应或密钥进入 GitHub、发布 Artifact 或日志。
- AgentRun 只能看到 Artifact ID，无法还原实际发送上下文。
- `context_digest` 继续混用 metadata、Prompt 和 output 语义。
- 上传资料中的工具命令、路径、网络请求或伪系统提示词获得执行能力。
- 长上下文静默丢弃锁定事实、冲突、逐字文本或当前用户要求。
- Agent 只留下记录，输出没有进入任何后续产物，也没有明确未采纳记录。
- 用户未批准视觉参考图就开始可编辑重建。
- 视觉参考图文字覆盖 PageContract，或最终 PPTX 使用未经登记的整页 Raster。
- 内容/设计变更没有二次确认、失效说明或 mixed 状态。
- dry-run 重放改写旧记录或直接产生未确认的供应商调用。
- `submission_unknown` 被当作普通失败自动重试。
- 真实 Codex 中转站或 GPT-image-2 中转站证据缺失。
- 前向迁移不可重复执行、删除旧记录或把私有包复制进项目文件。
- 工作树不干净、私有包未被忽略、标签不指向验收提交或发布证据缺失。

## 19. 完成定义

只有同时满足以下条件，才能宣称 FastPPT v1.2.0 完成：

1. 本文件已提交到正式仓库，且是下一位开发者可独立执行的唯一 Spec。
2. 三种入口、自然语言编辑和图片链路均有真实或明确降级边界的 Web 闭环。
3. PromptEnvelope、ContextResolver、输入哈希、PromptDigest、OutputDigest 和裁剪报告可查询。
4. 角色级上下文隔离和父子 Artifact 传递可审计。
5. 内容逻辑诊断默认关闭，开启后结果可追踪且不虚构事实。
6. 页数策略、受众、目的、语言和内容计划导出可用。
7. “风格和模板”入口、详情、导入、私有权限、明确使用、首页状态和默认 `none` 全部通过测试。
8. 设计选择被固化为 GenerationPlan/PageContract 快照；换包只影响未生成页面并正确显示 mixed 状态。
9. 完整 Prompt、原始响应和临时上下文按 30 天规则清理，密钥始终不落盘。
10. v1.1.0 旧记录未被删除，前向迁移可重复执行。
11. Codex 中转站、GPT-image-2 文生图和图生图真实证据完整且脱敏。
12. Windows、本地 Worker、服务器模式、SVG/PPTX QA、GitHub 卫生和发布检查通过。

## 20. 给下一位 AI 的执行要求

开始开发前必须：

1. 阅读本文件和仓库 `AGENTS.md`。
2. 检查当前分支、工作树、Python 虚拟环境和现有测试。
3. 先实现数据合同、ContextResolver、PromptEnvelope 和迁移，再接 UI，最后接真实 Provider 验收。
4. 修改前精读调用方和测试，不重写无关模块。
5. 每个阶段完成后运行对应单元/集成测试，并在继续下一阶段前检查实际 Prompt 与 AgentRun 是否一致。
6. 不把用户导入的私有风格/模板包、API Key、完整源文档或原始响应写入 GitHub。
7. 如果真实 Provider、图片模型、Worker 或 PowerPoint 环境不可用，必须报告准确 blocker 和证据路径，不得用确定性夹具冒充真实验收。
