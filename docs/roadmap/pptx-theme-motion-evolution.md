# PPTX 导出、主题转换生成与动画样式深化计划

更新日期：2026-09-28。状态：待实施设计；本文不表示新增能力已经交付。

本计划落实本轮产品方向：参考 Slidev 官方实现、PPT Master、slidev-editable-pptx，优先深化 PPTX 功能导出、themes 转换生成和动画样式。它是[总体路线图](full-product-evolution.md)中相关阶段的实施细化与优先级依据，补充[项目调研](competitive-review-2026-09-28.md)。其他产品方向保留，但不挤占这三条主线的首批交付。

2026-10-20 补充：[结构化内容原生导出计划](native-structured-export.md)明确表格优先保留为真正的 PPT 表格对象，再扩展原生数据图表与图示连接关系；细化当前链路缺口、版本迁移、语义降级规则及 N0–N4 验收。本段为新增规划，下面 09-28 的调研与差距保留历史语境。

## 1. 参考实现与采用边界

本次直接核查 GitHub 源码，以下 commit 为调研快照；没有运行上游导出器或做跨软件实测。实现前应再次检查相应版本与许可证，记录采用的代码、测试样例和修改来源。

| 参考 | 核查版本 | 已读实现入口 | FastPPT 采用方式 |
| --- | --- | --- | --- |
| Slidev 官方 | `30a0a54c8739b4b395d9b336a6304cc8ebcc3947` | [export.ts][s1]、[pptx/index.ts][s2]、[walker.ts][s3]、[normalize.ts][s4]、[capture.ts][s5]、[build.ts][s6] | 对齐页面/点击步选择、DOM 测量与捕获分离、归一化、局部栅格降级与报告 |
| PPT Master | `680de11f1bef4628b68d5daad9dffec569fbd51f` | [template_structure.py][p1]、[pptx_animations.py][p2]、[pptx_transitions.py][p3]、[animation_config.py][p4] | 借鉴结构化母版/占位符契约、效果注册表、时序构造与 sidecar 校验；映射到现有 TypeScript IR |
| qiulishang/slidev-editable-pptx | `1e462feca835d97d12773cd33debd917bf493e1f` | [export-editable-pptx.mjs][q1] | 借鉴文本分段、背景面板约束、重叠/越界/留白检查和 JSON 审计报告 |

具体边界：

- 官方 Slidev 当前源码已包含 `pptx-editable`，按 walker → normalize → capture → build 分层；捕获阶段暂停动画，报告降级、缺失图片和字体。当前 `references/slidev` 副本没有该入口，不能用旧副本代表上游现状；尚未核实发布版本与项目锁定版本的升级兼容性。[源码][s2]
- qiulishang 的 `splitByFont` 将 CJK/Latin 硬编码为宋体/Times New Roman，`fitSlide` 包含重新居中等排版策略。FastPPT 借鉴机制，字体取主题配置；默认保留源几何，布局调整作为可预览的修复建议。其说明提及表格，但本次脚本中没有 `addTable` 路径，不能据此宣称原生数据表格已验证。[源码][q1]
- PPT Master 的原生动画和结构编译可作为格式正确性参考，不整体移植 Python 工作流。FastPPT 保留 Slidev 创作、版本化 snapshot、浏览器 iframe 捕获和服务端转换边界。[结构源码][p1]、[动画源码][p2]
- 引用上游实现不等于引入新运行时依赖。逐能力决定复用、适配或自行实现；若增加 headless capture，放入独立 runner，不让 Gateway 或 Slidewave 转换器隐式启动浏览器。

## 2. 当前差距与先行修正

本地代码观察基于 `4e761c7`。前次调研已复现普通多页编译失败、甘特图浏览器预览与 PPTX 渲染不一致；本轮进一步阅读主题与动画实现。

| 当前实现 | 需要修正的边界 | 首个验收点 |
| --- | --- | --- |
| 编译器和导航各自拆分页；页面 ID 与位置相关 | 统一解析语义，持久化 slide/object ID | 插页、排序、改文案后 notes/animation 不串页 |
| SVG 图表与 PPTX 图表各自计算几何 | 两端消费同一布局结果 | tasks、文字和节点在预览/导出中一一对应 |
| `scripts/extract-theme.mjs` 读取 theme1、首个 master，并用布局列表推断背景 | 按 presentation/slide/layout/master 的真实关系解析 | 多母版、多主题、不同页面背景不混用 |
| 确定性提取生成通用 cover/default/section/end；已有 `ThemeDesignSpec` 扩展生成路径 | 扩展已有设计契约和生成器，保存源布局结构与提案来源 | 生成主题体现来源的层次、布局和组件，而非仅替换颜色 |
| 导出将 seed layout 复制更名 | 按每个布局生成占位符、固定对象和继承关系 | 切换布局、新建页面、修改母版均可验证 |
| `server/index.ts` 以字符串在 `p:cSld` 前插入 transition/timing，并以 `<p:morph/>` 表示 Morph | 用命名空间感知的 XML 构造与 schema 顺序校验，参考实际格式实现 | 包关系与节点顺序通过校验，PowerPoint 打开无需修复；播放另行实测 |
| capability 主要按 kind/快照判断支持 | 按对象、应用版本、导出模式与证据报告能力 | 没有验证证据时显示 partial/未验收，不默认 supported |

其中动画 XML 问题是代码与参考实现对照发现的结构风险，本次未做 PowerPoint 播放复现。PPT Master 为 Morph 使用扩展命名空间，并显式校验 transition 在 cSld/clrMapOvr 之后的位置。[参考实现][p3]

## 3. PPTX 功能导出

### 3.1 统一管线与可解释降级

沿用现有 capture/snapshot/render 分层，按以下职责补齐：

1. **解析与标识**：统一 Slidev 分页、frontmatter、notes、clicks；创建持久化 slideId/objectId；建立源位置 → DOM → IR → PPTX shapeId 的映射。缺少显式 ID 时首次生成并保存；摘要用于变更检测，不能替代持久身份。
2. **捕获**：等待字体、图片与异步组件就绪；明确捕获点击步和动画状态；统一 canvas、缩放、裁剪、坐标系和层叠顺序。按页范围捕获，保留来源页和点击步映射。
3. **归一化**：生成统一对象模型，保留文本 run、段落、字体、边界、层级、链接、可访问性描述、母版角色、图表数据和动画锚点。图表布局只计算一次。
4. **能力规划**：逐对象选择原生对象、保留矢量资源、局部栅格或阻断；记录理由和受影响能力。不能把插入 SVG 图片称为“内部节点均可编辑”。
5. **输出与验证**：通过 PptxGenJS/受控 OOXML writer 写出，并做结构读回、内容核对、视觉回渲染和应用验证。

拟增三个导出策略，均需显式报告结果：`editable` 优先原生、允许已声明局部降级；`strict-editable` 阻断所需可编辑对象的降级；`visual-fidelity` 优先视觉保真，允许报告后的图片回退。原始照片属于图片对象，不属于编辑性损失。保持旧 API 行为，通过版本化选项逐步引入。

点击步策略独立于动画策略：`final-state`、`steps-as-slides`、`native-animation`。默认不自动改变既有导出行为；不能同时把点击步重复成多页又为同一内容附加重复的原生入场。

### 3.2 能力清单与落点

| 能力 | 实施内容 | 可验收交付 |
| --- | --- | --- |
| 文本与中文排版 | 主题指定 CJK/Latin/复杂文字字体；保留混合 run、项目符号、段落、行距和链接；覆盖粗斜体、上下标和代码文本 | 源文本与 PPTX 读回文本匹配；指定字体缺失/替换可见；长中文不被静默删减 |
| 字体 | 复用 `fonts/embedFonts.ts`，报告实际使用、替代、嵌入和限制；连接主题字体映射 | 换机器打开的代表性样例验证字体与换行；无法嵌入有说明 |
| 形状与 SVG | 补全支持范围内的路径、group、connector、变换、填充与边框；复杂效果按最小对象降级 | 可移动、改色、编辑连接器；矢量图片与原生形状分别计数 |
| 图片、链接与媒体 | 保留裁剪、透明度、图层、图片链接；区分本地媒体、在线链接和 iframe | 支持的媒体可播放；无法嵌入的 iframe 提供标明用途的封面/链接或阻断 |
| 原生图表与表格 | 按[结构化导出计划](native-structured-export.md)先贯通 table 捕获、版本化 snapshot、服务端 writer 与回读，再接 chart/workbook；底层 `slide.ts` API 已存在不等于工作台已支持 | 表格可编辑行列与合并，图表可“编辑数据”；形状/文本碎片须报告语义损失，不能冒充原生表格 |
| 公式 | 建立可支持的公式子集到 OMML 的转换与能力诊断；其余保留矢量/图片回退 | 原生公式可编辑；未转换公式不被误标为可编辑文本 |
| 母版、备注、动画 | 使用第 4/5 节的共同模型；注入后统一校验关系、名称空间与节点顺序 | 备注内容正确；真实布局可选；目标对象与动画关系可读回 |

`ExportCapabilityReport` 扩展为按页/对象的报告：导出模式、支持级别、native/vector/raster 数量、源对象引用、降级原因、字体结果、目标应用、验证器版本与验证状态。用户可从警告定位源页；丢失内容是错误，不能仅统计成功导出的对象。

### 3.3 质量与布局审计

复用现有 `validateEditablePptx`；新增文本与媒体边界、背景面板约束、遮挡、空白页、页数和密度审计。信息密度阈值由页面角色/主题决定，避免把封面留白判为正文缺陷。重叠检测区分设计性叠放与文字冲突。审计先诊断，未经选择的自动缩字/居中不能改变交付。

建立浏览器预览、PPTX 回渲染和对象清单的对照。CI 可用 LibreOffice 做部分视觉回归；PowerPoint/WPS/Keynote 的能力分开记录，静态图片通过不能证明动画通过。采用上游同题样例与新增中文样例比较，不宣称未经测量的保真率。

## 4. 更完善的 themes 转换与生成

### 4.1 主题模型

扩展已有 `ThemeDesignSpec`/manifest，按职责描述品牌、视觉风格、页面结构和动画样式；不强迫重建主题注册体系。

- **Brand**：语义颜色、CJK/Latin 字体、logo、安全区和页脚规则。
- **Visual style**：字号层级、间距、网格、密度、圆角/边框/阴影、图片处理及组件变体。
- **Layout/master**：画布比例、真实 master/layout 标识、父子关系、固定对象、占位符 type/idx/几何和语义槽位。
- **Motion style**：默认过渡、持续时间、交错间隔、方向、缓动意图、静态角色和可降级策略；映射到第 5 节注册表。

字段标明 `extracted / inferred / generated / user-overridden` 及 source part/shape。置信信息要关联提取证据，禁止按布局顺序生成“保真度”。所有锁定字段在 AI 提案应用前后校验。

### 4.2 PPTX → 分析 → 候选主题 → 注册

1. **关系解析**：按 `presentation.xml` 和 `.rels` 的实际页面顺序遍历；解析每页可达 layout/master/theme，处理颜色映射、字体方案、背景继承、资源裁剪和占位符继承。支持多 master，而非从文件名或目录顺序推断关系。
2. **语义提取**：结合原始 XML 与源页预览，分离固定框架和内容；识别标题/正文/图表/页码等槽位；提取页面类型、组件和重复样式。保留源几何、局部覆写及无法映射对象的清单。
3. **转换策略**：提供“仅品牌 token”“保留来源布局”“按来源生成可复用设计系统”三条路线。保留布局不等同于保证任意 PPTX 无损逆向；AI 新生成布局必须标为 proposal，不覆盖来源事实。
4. **候选生成**：复用 `theme-design.ts` 生成 Vue layouts、组件、CSS tokens、manifest、主题 Skill、真实样例 deck 和 motion presets。源布局的保真重建与内容自适应布局分别生成、分别验收，避免硬编码一个模板族冒充源主题。
5. **可视审查**：展示来源页与候选页、字体映射、master/layout 树、对象保留/降级、用户锁定项与动画预设；用户可以调整单个 token/layout 并局部重生成。
6. **原子注册**：隔离目录构建、格式/注册表校验、逐布局预览、溢出检查和 PPTX 回导出通过后，按现有确认流程注册。失败保留草稿且不破坏旧主题；保存版本、来源摘要和迁移信息。

### 4.3 FastPPT theme → PPTX theme/master/layout

从同一布局模型生成浏览器布局和 PPTX 结构：字体/颜色写 theme；重复框架和品牌固定项写 master/layout；页面内容按占位符 idx/type 与所属布局绑定。需要允许页面级覆写，但不能把所有继承内容拍平为普通页面对象。

验收必须包含：两种不同几何布局在 PowerPoint 中确实不同；新增页面继承主题；修改母版固定项影响使用它的页面；切换布局后内容槽位仍正确；源页面数量超过 9、混合母版和混合主题的关系仍正确。原有 seed layout 复制更名只视为过渡实现。

生成主题的评审样例应覆盖其每种注册布局，以及中文长标题、密集正文、中英混排、图片裁剪、表格/图表和开关动画。主题质量报告随版本保存，避免“构建成功”替代设计与导出验收。

## 5. 动画样式、预览和原生导出

### 5.1 效果注册与主题预设

将页面过渡、对象生命周期和主题动效风格分开：

| 层次 | 第一批交付 | 后续扩展 |
| --- | --- | --- |
| 页面过渡 | none、fade、push、wipe、split；明确方向、时长和自动翻页 | Morph 以跨页对象匹配和应用验证为准入条件，再增加 cover/uncover 等效果 |
| 对象入场/退场 | appear、fade、fly、wipe、zoom 的受支持方向/子集 | 按 registry 扩展效果，不堆叠未经验证的枚举 |
| 强调与路径 | pulse；直线路径及已验证的基础曲线路径 | 更复杂路径、重复、反向和更多 emphasis 效果 |
| 主题样式 | 静态、克制商务、逐步教学、产品揭示 | 用户保存预设和有依据的角色自动推荐 |

每个 registry entry 包含参数 schema、默认值、语义类别、浏览器实现、OOXML writer、目标应用能力与 fallback。`appear/fly/zoom/teeter` 等现有键通过明确的 V1 → V2 别名迁移保留；本计划的显示名称不直接成为不兼容的新协议。

默认对象静态；选择主题预设后按语义角色产生建议。背景、页码、logo 和继承框架保持静态，除非用户明确指定。动效样式支持“仅本页/全局”、预览、恢复默认和减少动态效果；主题更新不覆盖用户覆写。

### 5.2 身份、点击步与时间轴

- 使用持久 group/object ID 和语义角色绑定，映射至最终 shapeId；一个视觉组拆成多个 PPTX 对象时保留组映射。删对象后显示孤立动画，不能静默绑定到其他对象。
- 对齐 Slidev `v-click`、`v-after`、`v-clicks`、显式/相对点击步和 hide 状态；先声明支持子集，再覆盖更多语法。原生导出保留时间轴语义，打印模式的可见性不能代替动画模型。
- 区分 `on-click`、`with-previous`、`after-previous`；计算点击组、并行组、依赖、delay、duration 与结束时间。不能把三种 trigger 都变成同一种 delay。
- 时间线支持效果排序、参数编辑、播放/暂停、跳到指定步骤、初态/终态与静态预览；预览和导出共用事件调度结果。
- 讲稿 cues、自动翻页与动画时间轴对齐；交互模式和录播模式的冲突进入诊断，保留原始备注。

### 5.3 OOXML 与 Morph

建立专用 XML writer，维护节点顺序、关系、唯一 timing ID、初始可见性和结束状态；从最终对象映射生成 `spTgt`。读取和写回已有 timing 时使用明确的合并/替换策略，避免重复节点。

Morph 使用目标 Office 版本对应的扩展表达与兼容分支；以稳定的跨页对象身份、支持属性和成对校验为前提。无法匹配时报告并按用户策略使用 fade/静态或阻断，不能只写一个 transition 标签就宣称 Morph 已完成。

验收分三层：结构解析与引用有效；浏览器时间轴在初态/中间关键帧/终态正确；PowerPoint 实际播放的顺序、点击触发和对象匹配正确。WPS/Keynote 单独建立兼容状态，不把 PowerPoint 的结果外推。

## 6. 包职责、协议与迁移

| 位置 | 主要改动 |
| --- | --- |
| `packages/presentation-ir` | 扩展持久身份、结构化 master/layout、对象能力、motion registry 与导出策略；明确 V1/V2 迁移 |
| `packages/presentation-compiler`、`packages/markdown` | 对齐 Slidev 解析、源位置映射、点击步和 notes；避免三套分页逻辑 |
| `packages/pptx-import`、`scripts/extract-theme.mjs` | 合并关系图解析与来源分析，脚本逐步成为领域包调用入口 |
| `packages/fastppt-mcp/src/theme-design.ts`、`packages/theme-registry` | 扩展已有设计契约、主题预设、布局输出、隔离构建与注册校验 |
| `packages/diagram-engine` | 输出共享布局模型，SVG/PPTX 复用 |
| `packages/slidewave` | 扩展版本化 snapshot、能力规划、原生对象/结构/动画 writer、验证与字体报告 |
| Gateway / Web / MCP | 复用现有 API 和任务生命周期，增加能力详情、主题对照与动效预设操作 |

拟新增/扩展的文档为 `object-map`、`theme-analysis`、`theme-design`、`motion-presets`、`export-report`；沿用当前实际路径约定，由 Workspace 服务负责读写。它们是设计项，并非现有文件或 HTTP 接口承诺。已有 themes/notes/animations 必须可读；缺失新增字段时按 V1 兼容规则处理。

导出冻结 deck revision、资产/sidecar 摘要和 theme digest；主题重生成、用户锁定和候选预设写入同一修订模型。导出完成后如源已变化，标记产物对应的旧版本。schema 升级、旧 deck 迁移与缓存失效一并验收。

## 7. 发布切片与验收门槛

每个切片交付代码、样例、报告和兼容状态，状态分别记录“协议完成 / 预览完成 / PPTX 完成 / 实机验收”，不以面板存在或 XML 节点存在作为完成标准。以下为依赖顺序，不是工期承诺。

| 切片 | 前置 | 交付范围 | 验收门槛 |
| --- | --- | --- | --- |
| E0 基线修正 | 无 | 分页、稳定身份、共享图表几何、动画 XML 风险修正、上游基准固定 | 已复现问题加入回归；旧 deck 可打开；报告不夸大支持 |
| E1 导出底座 | E0 | 捕获/归一化、文本字体、局部降级、对象报告、布局审计 | 中文/混排与复杂对象样例无静默丢失；不支持项可定位 |
| T1 主题解析生成 | E0 | 关系图、多母版分析、来源字段、候选设计和逐布局样例 | 至少 3 个不同来源的 fixture，包括多母版样例；来源与生成内容可区分 |
| T2 真正母版导出 | E1、T1 | 独立 layout 几何、占位符绑定、主题字体颜色 | 新建页、换布局、改母版三个实机操作均通过 |
| A1 动画基础与样式 | E1 | 基础过渡/对象效果、三类 trigger、时间线、主题预设 | 点击、并行、顺序三组样例播放正确；首帧/终态一致 |
| A2 高级动画 | A1、稳定跨页身份 | Morph、路径、更多已验证效果和导入动画分析 | 对象成对匹配与播放通过；不支持效果有降级报告 |
| E2 原生复杂对象 | E1、共享语义模型 | 数据图表、表格、公式和媒体子集 | 编辑数据/单元格/公式可验证；媒体兼容范围明确 |
| R1 发布收口 | 对应切片完成 | 导出选项、主题审查、motion UI、文档和回归 | 至少 5 个主题黄金样例；结构/视觉/实机报告可追溯 |

第一批黄金样例覆盖：中文长标题、混合字体与代码、多点击步、流程图/甘特图、原生数据图表、多布局多母版、透明/裁剪/渐变、notes、动画分组和 Morph 对象对。对齐 Slidev 与 qiulishang 的输入条件，记录字体、画布、应用版本、导出模式、时间和降级情况。

必须通过的硬门槛：没有静默丢失的正文和数据；没有悬空关系/shape 引用；受支持流程打开不触发修复；notes/布局/动画与来源页绑定正确。视觉误差和密度阈值先建立基线，再按样例类型固定，不能用未测量的百分比替代验收。

## 参考源码

[s1]: https://github.com/slidevjs/slidev/blob/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/export.ts
[s2]: https://github.com/slidevjs/slidev/blob/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/pptx/index.ts
[s3]: https://github.com/slidevjs/slidev/blob/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/pptx/walker.ts
[s4]: https://github.com/slidevjs/slidev/blob/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/pptx/normalize.ts
[s5]: https://github.com/slidevjs/slidev/blob/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/pptx/capture.ts
[s6]: https://github.com/slidevjs/slidev/blob/30a0a54c8739b4b395d9b336a6304cc8ebcc3947/packages/slidev/node/commands/pptx/build.ts
[p1]: https://github.com/hugohe3/ppt-master/blob/680de11f1bef4628b68d5daad9dffec569fbd51f/skills/ppt-master/scripts/svg_to_pptx/pptx_package/template_structure.py
[p2]: https://github.com/hugohe3/ppt-master/blob/680de11f1bef4628b68d5daad9dffec569fbd51f/skills/ppt-master/scripts/pptx_animations.py
[p3]: https://github.com/hugohe3/ppt-master/blob/680de11f1bef4628b68d5daad9dffec569fbd51f/skills/ppt-master/scripts/pptx_transitions.py
[p4]: https://github.com/hugohe3/ppt-master/blob/680de11f1bef4628b68d5daad9dffec569fbd51f/skills/ppt-master/scripts/animation_config.py
[q1]: https://github.com/qiulishang/slidev-editable-pptx/blob/1e462feca835d97d12773cd33debd917bf493e1f/scripts/export-editable-pptx.mjs
