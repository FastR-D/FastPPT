# FastPPT 全阶段产品演进规划

本文把七项目标拆成可以连续交付的工程路线。规划基于当前仓库的真实边界：Vue SPA、Gateway、SQLite、Harness/Skill 注册表、SlidevHost、Slidewave 可编辑 PPTX 导出，以及已有的 PPTX 主题导入管线。

2026-09-28 更新：下一阶段优先深化 **PPTX 功能导出、themes 转换生成、动画样式**。具体参考版本、实现入口、能力矩阵、迁移和验收见 [PPTX / Theme / Motion 深化计划](pptx-theme-motion-evolution.md)。本文 Phase 编号保留领域划分，原工期仅为早期估算；实际实施顺序以第 8 节和深化计划为准。下文各领域已有部分实现，应增量补齐，不能将规划描述或已有 UI 视为完成验收。

## 0. 目标和原则

最终产品应让用户在一个 IDE 式工作台中完成：选择创作意图和主题、生成或编辑页面、控制页面与对象动画、编写讲稿备注、生成可编辑图表、从 PPTX 建立主题、预览质量、导出带母版/备注/动画的 PPTX。

核心原则：

- Markdown/Slidev 是页面内容的可审计源文件；导出的 PPTX 是交付物，不反向替代源文件。
- 每个 AI 决策都变成可见的“建议 + 影响 + 接受/修改/跳过”步骤；自动执行仅限低风险、可回滚操作。
- 动画、备注、图表和主题都使用版本化中间表示（IR），先校验再渲染，避免把能力埋在提示词或单个导出器里。
- 预览、PPTX 导出和质量检查共享同一份语义模型；不允许导出悄悄改变页面内容。
- 保留现有 Harness、Skill 快照、revision 检查、事件序列和导出队列等安全边界。
- 参考实现固定到 commit，并区分原生可编辑对象、矢量图片、局部栅格和未支持能力；任何降级必须可定位，不能静默丢失内容。
- 主题的品牌 token、视觉风格、母版/布局结构和动画样式使用同一设计契约；浏览器预览与 PPTX 输出消费共同语义和几何结果。

## 1. 当前能力盘点与参考项目结论

现有项目已经具备：

- `SessionDeckProfile`：受众、意图、叙事模式、语言、主题、保留策略、审查策略。
- `ImportPptxTheme*`：上传 PPTX、提取、后台设计、同步 Skill、验证、状态轮询。
- Slidewave：浏览器捕获 DOM 快照，服务端生成可编辑对象；支持文本、形状、图片、SVG 等对象。
- 导出任务生命周期：排队、审查、完成/失败/取消、质量报告和下载。
- Vue 工作区：文件树、CodeMirror 编辑器、会话对话、预览、主题目录和主题导入。

参考项目应吸收的边界：

- [Slidev 官方当前实现](https://github.com/slidevjs/slidev/tree/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/pptx)：walker/normalize/capture/build 分层、页面与点击步映射、局部降级和导出诊断。当前本地 `references/slidev` 副本较旧，不能据此判断官方没有可编辑导出。
- [qiulishang/slidev-editable-pptx](https://github.com/qiulishang/slidev-editable-pptx/blob/1e462feca835d97d12773cd33debd917bf493e1f/scripts/export-editable-pptx.mjs)：CJK/Latin 文本分段、背景面板约束、越界/重叠/留白检查与结构化布局报告。采用可配置字体与诊断机制，不照搬固定字体或自动居中策略。

- `references/ppt-master` 的动画模型：页面 transition 与对象 entrance/emphasis/path/exit 分层；动画用稳定的顶层 group ID 作为目标；sidecar 支持触发方式、顺序、延迟、时长、效果参数、音频和校验；默认静态，只有有沟通目的时才启用。
- `references/ppt-master` 的讲稿模型：备注是纯口语文本；可按语言选择 TTS；讲稿时间轴可以驱动自动播放和动画，但原始备注必须保留。
- `references/ppt-master` 的模板/母版模型：主题、布局、组件和母版分层，导出时保持结构化对象而不是整页图片。
- `references/open-kimi-ppt-skill` 的编辑器体验：导入、主题生成、页面编辑、导出和可视化预览应形成连续工作流；`.pptd`/项目文件思路可借鉴，但 FastPPT 仍以 Slidev Markdown 和受控 sidecar 为源。
- `references/slidev` 的原生语义：`transition`、`clicks`、`v-click`、notes 和主题配置应作为兼容层，而非重新发明页面语法。

## 2. 目标架构

深化以下四个已有领域层：

1. `packages/presentation-ir`：动画、备注、图表、主题母版和导出能力的 Zod schema、归一化和诊断；浏览器/Gateway/Slidewave 共用。
2. `packages/presentation-compiler`：从 Markdown/frontmatter/sidecar 生成 IR；从 IR 生成 Slidev 注入数据、DOM data attributes 和 PPTX 渲染输入。
3. `packages/pptx-import`：OOXML 解包、主题/母版/布局/字体/颜色/占位符/备注提取，输出可审查的 Import Analysis。
4. `packages/diagram-engine`：结构化图表 schema 到 SVG 的确定性渲染，AI 只负责提出 schema，不直接输出不受控 SVG。

Gateway 增加四类服务：

- `ProjectService`：创建向导、决策记录、草稿/提交、回滚。
- `PresentationAssetService`：notes、animation sidecar、diagram SVG 和 provenance 的读写。
- `PptxImportService`：导入任务、预览候选主题、用户确认、注册主题。
- `ExportPolicyService`：检查母版、备注、动画和 SVG 的兼容性，生成 warnings/blocks。

## 3. 版本化数据模型

在 `packages/protocol` 增加以下 schema，并把 JSON 原文放在 deck 目录，SQLite 只保存索引和状态：

```text
.fastppt/decks/<deck>/
  slides.md
  notes.json                 # slideId -> spokenText, cues, language
  animations.json            # page transitions + anchored object effects
  diagrams/<id>.json         # editable diagram source
  assets/generated/...       # SVG/raster and provenance
  theme-lock.json            # theme/master/layout snapshot digest
```

关键类型：

- `AnimationDocumentV1`：`slideId`、`transition`、`groups[]`、`trigger`、`effects[]`、timing modifiers、`source`、`diagnostics`。
- `SpeakerNotesDocumentV1`：slide id、spoken text、plain text/SSML、language、estimated seconds、cue ranges、status。
- `MasterSnapshotV1`：theme id/digest、slide master、custom layouts、fonts、colors、placeholders、unsupported features。
- `DiagramDocumentV1`：`flowchart | gantt | timeline | matrix | org-chart`、nodes/edges/tasks/style/constraints、source prompt、accepted revision。
- `CreationDecisionV1`：step id、question, options, selected value, rationale, actor (`user|agent|system`), timestamp。
- `ImportAnalysisV1`：source hash、extracted features、candidate layouts/components, confidence, unsupported OOXML, user overrides。

所有 schema 带 `version` 和 `digest`。导出 payload 必须携带 deck revision、IR digests 和 theme snapshot digest，防止陈旧导出覆盖新内容。

## 4. 分阶段交付路线

### Phase 0：基线和契约（2 周）

目标是先固定跨模块契约，避免后续每个功能各写一套状态。

- 建立 `presentation-ir`、`CreationDecision`、`ExportCapabilityReport` schema。
- 记录当前 Slidev/Slidewave 支持矩阵：文本、SVG、渐变、裁剪、字体、notes、transition、clicks、母版。
- 为 deck 增加 sidecar 目录和 revision/digest 规则；旧 deck 没有 sidecar 时解析为空文档。
- 增加 Gateway 端 capability endpoint 和 CLI 诊断命令。
- 修正已复现的普通多页编译失败和图表预览/导出差异；复用统一 Slidev 解析，持久化 slide/object 身份。
- 建立固定版本的上游导出比较样例和 FastPPT 黄金样例；能力报告区分实现状态、视觉验证与应用实测结果。
- 验收：旧项目行为不变；所有新文档可 round-trip parse/serialize；协议、数据库迁移、包边界测试通过。

### Phase 1：全面动画（4-6 周）

交付顺序：页面过渡 -> 点击分步 -> 对象动画 -> 预览时间轴 -> 原生 PPTX。

1. 编译器读取 Slidev `transition`、`clicks`、`v-click`，生成统一 IR；原有语法继续有效。
2. 为可动画 DOM 顶层节点生成稳定 `data-fastppt-group`，优先使用显式 id，缺省时生成并持久保存；结构路径和内容 digest 仅用于变更检测与匹配提示。背景、页码、母版和占位符默认 static；插页、排序和改文案不能重绑动画。
3. 实现 transition registry 和对象效果 registry。先验收 `none/fade/push/wipe/split`、基础入场/退场、强调和路径子集；Morph 以稳定跨页对象匹配和实机播放为准入条件。现有动画键保留版本迁移；每个效果记录参数、预览实现、OOXML 表达、应用兼容性和 fallback。
4. 预览增加播放/暂停、上一效果/下一效果、时间线、触发方式（on-click/with-previous/after-previous）和“仅本页/全局默认”编辑。编辑操作只改 `animations.json`。
5. Slidewave capture snapshot 增加 anchors 和 animation metadata；server renderer 使用命名空间感知的 XML writer，校验 transition/timing 节点顺序、唯一 ID 和 shape 引用。不能表达的效果必须进入 warning，不得静默变成静态。
6. 增加静态检查：目标不存在、结构节点被动画化、循环触发、负时长、录制讲稿使用 on-click、跨 slide anchor 不稳定。
7. 主题增加 motion presets：静态、克制商务、逐步教学、产品揭示；支持仅本页/全局、预览、减少动态效果和用户覆写。三类 trigger 使用统一调度模型，区分点击、并行和顺序，不能只转换成 delay。
8. 导出区分终态、点击步展开为多页和原生动画三种策略；预览和导出共用点击步与初态/终态语义。

验收：同一 deck 在浏览器预览和 PowerPoint 的首帧、关键帧和终态语义一致；首批注册效果与三种 trigger 可播放；动画导出后读回验证；动画关闭时 PPTX 与现有导出等价。WPS/Keynote 单独记录，静态回渲染不能证明动画兼容。

### Phase 2：备注讲稿和演示模式（3-4 周）

- Markdown 中允许 `<!-- notes: ... -->` 作为轻量输入，同时提供 `notes.json` 作为完整编辑格式；解析后统一到 `SpeakerNotesDocumentV1`。
- 预览右侧新增 Notes 面板：按页编辑、字数/预计时长、语言、朗读顺序、cue 标记；支持从页面内容生成草稿，但必须由用户接受。
- 导出 Slide Notes 到 PPTX notes slide；保留原始备注，不能只导出 TTS 文本。
- 演示模式提供 speaker view：当前页、下一页、计时器、讲稿、动画进度；Presenter window 与投影窗口使用同一 deck revision。
- 后续接入 TTS 时建立 provider adapter、声音建议、逐页音频和 SRT；云服务失败不影响普通 PPTX 导出。

验收：备注可编辑、可搜索、可导出和 round-trip；没有备注的页不会出现伪造文本；估时与实际 TTS 时长偏差可见；演示窗口断线后可恢复。

### Phase 3：母版/主题导出（4-6 周）

- 从当前主题 manifest 扩展 `master` 能力描述：主题级字体/颜色、slide master、layout master、title/content/section layouts、页眉页脚和占位符。
- Slidewave 增加 `MasterSnapshot` 输出与 PPTX 渲染器：先写 theme1.xml、slideMaster、slideLayout、关系和 placeholders，再写页面对象。
- 把主题 token 映射到 OOXML theme colors；字体无法嵌入时报告安装要求；渐变/滤镜等不支持项输出明确 warning。
- 导出对话框拆为“页面对象 / 母版 / 备注 / 动画 / 质量检查”选项，保存为 export profile；默认选择与主题兼容的安全组合。
- 读回检查：母版数量、layout 关系、占位符、备注页、transition 节点和对象数量。
- 从统一布局模型生成真实 master/layout 几何、固定对象和 placeholder idx/type 绑定，淘汰复制 seed layout 更名作为完整母版支持的做法。
- 将导出策略细化为可编辑优先、严格可编辑和视觉保真；复用已有字体嵌入、`addChart`/`addTable`，接通原生图表/表格的数据模型和主导出链路，并分期增加公式、媒体和链接支持。
- 以实际导出对象生成逐页能力与降级报告，包含字体替换、内容缺失、原生/矢量/栅格分类；增加 PPTX 回渲染与浏览器预览对照。

验收：导出的 PPTX 在 PowerPoint 中可选择布局、修改母版文字/颜色；新建页面能继承主题；页面对象仍可编辑；不支持能力不会被伪装成成功。

### Phase 4：PPTX 导入创建主题（5-7 周）

这是一个用户参与的决策流程，不应是上传后一次性黑盒生成。

流程状态：`upload -> inspect -> propose -> decide -> generate -> preview -> revise -> approve -> register`。

1. `pptx-import` 解包并提取 theme colors、font schemes、masters/layouts、placeholder 类型、常见组件、图表/SVG/图片统计、备注和动画能力。
2. UI 展示分析报告和三类候选：保留源主题、注册为可编辑 FastPPT 主题、只提取 token。每个候选列出保真度、可编辑性和丢失项。
3. 用户逐项决策：页面比例、字体替代、颜色 token 命名、哪些 layout 注册、哪些组件转为 primitive、是否保留源 PPTX 作为 reference、是否允许 AI 设计新布局。
4. Harness 只生成候选 manifest/Skill/布局代码，必须在隔离目录构建、渲染样例并给出 diff；用户确认后才原子注册到 theme registry。
5. 记录 `ImportAnalysis` 和 `CreationDecision`，允许从任意阶段返回修改，不重复上传和提取。
6. 对源 PPTX 中无法映射的 master、SmartArt、图表动画和字体，标记 `unsupported`，提供手工替代建议。
7. 以 `.rels` 和实际页面顺序解析 slide → layout → master → theme，支持多母版、多主题和字段继承；不能仅依赖 theme1、首个 master 或布局文件顺序。
8. 扩展已有 `ThemeDesignSpec` 为品牌、视觉风格、结构布局和动画样式的共同契约；标明字段 extracted/inferred/generated/user-overridden 及来源，锁定项不得被候选生成覆盖。
9. 生成 Vue/CSS、组件、manifest、Skill、逐布局样例与 motion presets；保留源布局和自适应生成布局分别评审。提供来源/候选对照、字体映射、对象丢失项和局部重生成。

验收：用户未确认时不会污染注册表；用户能看到并修改候选 token/layout；失败只保留可删除的草稿；导入主题能创建 deck、预览并导出。

### Phase 5：扩展 PPT 创建向导和决策系统（持续 4 周首版）

把当前 `NewSessionDialog` 从表单升级为可恢复的向导：

1. 任务：从零创建、基于现有 deck、填充 native PPTX、增强 native PPTX、创建主题。
2. 目标：受众、意图、叙事模式、语言、时长、页数范围、演示场景。
3. 内容：资料来源、事实核查级别、引用策略、是否允许联网研究、敏感内容限制。
4. 视觉：主题、比例、密度、图片策略、diagram 策略、品牌资产、母版保留策略。
5. 行为：动画默认、备注/演示模式、自动播放、审查策略、是否生成备选页。
6. 交付：PPTX 兼容级别、是否包含 notes/master/animations、输出文件名。

每一步都生成可编辑的 `CreationDecision`，AI 可提出推荐值和理由；用户可锁定某项，后续 agent 不得覆盖。向导草稿放在 Gateway/SQLite，提交时生成不可变 profile digest 并复用现有 session profile。

验收：中断后可恢复；修改早期决策会显示受影响页面/资产；profile digest 能复现同一运行条件；对话模式和表单模式产生同一 profile。

### Phase 6：SVG 图像生成 Skill 和图表引擎（4-6 周）

这里的“图像生成”分成两条路径：照片/插画继续使用现有 image-production；流程图、甘特图等信息图必须使用可编辑 SVG 管线。

- 新增 `fastppt-editable-visuals` 的 diagram 子流程和 Harness tool：AI 选择 `flowchart/gantt/timeline/matrix`，输出 `DiagramDocumentV1`，不能直接写任意 SVG。
- `diagram-engine` 用 deterministic renderer 生成 SVG，保留 text、lines、shapes、groups、accessible labels 和 source JSON；SVG 导入 Slidewave 后作为可编辑 vector，必要时同时展开为 PPTX shapes。
- 共享布局计算结果给 SVG 与 PPTX，尤其是甘特图/时间线任务几何；区分矢量图片、原生形状与可“编辑数据”的图表，分别报告可编辑级别。
- UI 提供 schema 表单和画布预览，用户可改节点、任务日期、依赖、颜色、方向和密度；接受后才写入 deck。
- 图表质量检查：文本溢出、边交叉、日期非法、循环依赖、颜色对比、页面边界、SVG 安全（禁止脚本/外链）。
- provenance 记录 prompt、模型、schema revision、accepted asset digest；支持重新渲染而不丢失手工修改。

验收：流程图和甘特图在浏览器/PPTX 中清晰、无脚本、可移动；同一 JSON 在不同机器生成相同 SVG digest；AI 生成失败时用户仍可手工编辑。

### Phase 7：现代 IDE 工作台（与 Phase 1 起并行，最终收口 3-5 周）

- 采用三栏可折叠布局：文件/页面导航、代码与 AI 工作区、预览/备注/时间线；保留现有可拖拽宽度和移动端折叠。
- 顶部 command bar：创建、运行、预览、动画、备注、导出、主题、问题；所有按钮显示当前 revision/dirty/运行状态。
- 页面 navigator 显示缩略图、notes/animation/quality badges；支持多选、拖拽排序和批量设置。
- 编辑器增加 Markdown、frontmatter、notes、animations、diagram source 的 tabs；CodeMirror diagnostics 与预览双向定位。
- 右侧 inspector 按选中对象显示布局、文本、token、动画、可访问性和来源；修改通过 patch 写回 source/sidecar。
- 统一 command palette、快捷键、undo/redo、toast、错误抽屉和运行日志；颜色从当前单一深色绿系扩展为中性层级、语义色和高对比模式。
- 以工作流为中心做 Playwright：创建向导、主题导入决策、动画时间线、备注编辑、图表接受、导出审查。

验收：常用操作可键盘完成；窄屏不遮挡编辑/预览；长文本不溢出；状态和错误有明确归属；旧路由和 API 兼容。

## 5. API、数据库和事件清单

协议新增：

- `GET/PUT /decks/:id/notes`
- `GET/PUT /decks/:id/animations`
- `GET/PUT /decks/:id/diagrams/:diagramId`
- `GET /decks/:id/export-capabilities`
- `POST /decks/:id/export` 扩展 `options`（master, notes, animations, diagrams, review）
- `POST /pptx-import/jobs`、`GET /pptx-import/jobs/:id`、`POST /pptx-import/jobs/:id/decisions`、`POST /pptx-import/jobs/:id/approve`
- `POST /creation-wizards`、`PATCH /creation-wizards/:id/steps`、`POST /creation-wizards/:id/commit`
- `POST /diagrams/validate`、`POST /diagrams/render`

SQLite 新表/迁移：`deck_documents`、`speaker_notes`、`animation_documents`、`diagram_documents`、`creation_wizards`、`creation_decisions`、`pptx_import_jobs`、`export_capabilities`、`asset_provenance`。大文本保存在 workspace 文件，表中保存 revision、digest、status 和路径。

事件 topic：`deck-documents`、`animation`、`notes`、`diagram`、`creation-wizard`、`pptx-import`、`export:<id>`。所有事件带 sequence、revision 和 actor，客户端断线后以 HTTP 状态刷新。

## 6. 测试和质量门槛

- 单元：schema、归一化、digest、动画 registry、OOXML 读写、图表布局、notes 估时。
- 契约：Gateway API 与 Zod schema、事件顺序/重连、旧 API payload。
- 集成：Markdown -> IR -> preview -> snapshot -> PPTX -> read-back round-trip。
- Golden fixtures：至少 5 个主题、复杂 master、notes、动画、SVG 图表、中文/英文/混排字体。
- 浏览器：向导恢复、决策锁定、时间线操作、备注编辑、图表编辑、主题导入审查、导出 review。
- 每次导出都运行：语法、缺失资产、文本溢出、SVG 安全、字体、母版/备注/动画 read-back；warning 必须显示在导出审查页。
- 发布前按固定样例运行 PPTX 回渲染与 PowerPoint 实机操作；验证修改母版、切换布局、编辑图表数据、备注绑定和动画播放。WPS/Keynote 分应用记录；LibreOffice 只承担适用的持续回归部分。
- 参考 qiulishang 的布局审计，补充背景面板约束、媒体越界、设计性重叠识别、按页面角色区分的密度/留白检查；默认诊断，不静默改排版。

## 7. 关键风险和取舍

- PPTX 原生动画与跨应用兼容性有限：先支持可验证的 registry，未知效果保持诊断，不承诺 Keynote/WPS 等价播放。
- 母版导出会引入 OOXML 关系复杂度：先覆盖常见 master/layout/placeholder，再扩展 SmartArt、图表和媒体。
- PPTX 导入不是完美逆向：产品承诺“可审查的候选主题”和保真度报告，不承诺逐像素、逐动画还原。
- AI 生成 SVG 不能直接信任：schema + deterministic renderer + 用户接受是安全和可维护性的边界。
- 备注/TTS 涉及外部服务和隐私：普通备注完全离线可用，TTS 需显式 provider、语言、数据处理提示和失败降级。
- UI 重构不能阻断创作：保留现有路由、API 和 Markdown 文件入口，按 feature flag 分批启用。

## 8. 推荐执行顺序和发布切片

本轮优先按 [深化计划](pptx-theme-motion-evolution.md) 的发布切片推进：

1. E0：修正解析与预览/导出一致性，稳定身份，补齐动画 XML 验证和能力基线。
2. E1：完善捕获/归一化、文本字体、局部降级、布局审计和对象报告。
3. T1：实现关系图与多母版分析，扩展 themes 契约和候选设计生成。
4. T2：导出真实 master/layout/placeholder，验证主题转换的完整流程。
5. A1：补齐基础动画、三种 trigger、时间线和主题动画样式预设。
6. A2：在稳定对象身份和兼容验证基础上增加 Morph、路径与高级效果。
7. E2：接通原生数据图表、表格、公式和媒体的受支持子集。
8. R1：导出/主题/动画 UI 收口，发布逐主题、逐应用可追溯的验收报告。

T1 可在 E0 后与 E1 独立推进；T2 依赖 E1/T1，A1 依赖 E1。创建向导、备注、演示模式和 IDE 通用体验继续按需补齐；已有功能不重建。切片状态分别记录协议、预览、PPTX 和实机验收，不能仅按 API/UI 是否存在标记完成。

每个切片都必须通过现有 `format_slides`、`validate_slides`、preview/overflow、导出 read-back 和相应 Playwright/单元测试后再扩大范围。
