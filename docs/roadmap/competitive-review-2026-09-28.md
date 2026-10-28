# FastPPT 项目与竞品调研

调研日期：2026-09-28。代码基线：`4e761c7`。

本轮方向更新：优先完善 PPTX 功能导出、themes 转换生成和动画样式。已补充三个参考项目的源码核查、固定 commit、工程切片和验收标准，见 [PPTX / Theme / Motion 深化计划](pptx-theme-motion-evolution.md)。以下保留产品调研结论，近期实施顺序以深化计划为准。

本次阅读 README、架构与演进规划、Gateway、工作台、IR/编译器、图表引擎、PPTX 导入和 Slidewave 导出代码，并核查官方文档及上游仓库。竞品能力是公开文档所述，没有对各产品做同题实测；本地结论区分代码观察与实际复现。

## 判断

FastPPT 已有可继续发展的产品基础：本地工作区、双 Agent Harness、托管 Skill/MCP、主题注册、Slidev 预览、可编辑 PPTX、字体嵌入、导出审查，以及动画/备注/图表/主题导入的工作台入口。

建议定位为“面向专业内容作者的、本地优先、修改可控、交付可验证的 AI 演示工作台”。优先验证技术讲师、研究人员和咨询/汇报作者这类既要代码自由度、又要交付 PPTX 的用户。这个目标人群选择是产品假设，需要用户访谈验证。

关键竞争变化：Slidev 官方在线文档已记录 `pptx-editable`，本轮进一步核实 commit `30a0a54c8739b4b395d9b336a6304cc8ebcc3947` 中已有分层实现；Presenton 已同时覆盖本地部署、可编辑导出、模板生成和 MCP。因此，“本地 + Agent + 可编辑 PPTX”这个组合本身已不足以构成持久差异。应以中文排版、复杂对象、品牌复用、受控修改和质量证据建立可测量优势。未核实上游该能力对应的发布版本，也不代表当前锁定的 Slidev 52.19.0 已支持它。本地 `references/slidev` 副本没有新入口，参考时需区分版本。

## 当前项目：哪些已经有，哪些需要补齐

| 能力 | 代码观察 | 下一步 |
| --- | --- | --- |
| 本地工作台与 Agent | Gateway/SPA、Claude/Codex 适配、审计、审批、会话恢复、事件重连、文件 revision 等均有实现 | 保留边界，完善新用户诊断和失败恢复 |
| 可编辑 PPTX | DOM 捕获、原生对象转换、字体嵌入、告警与 OOXML 结构检查均已存在 | 建立实际 PPTX 回渲染对照和应用兼容矩阵 |
| 页面定向编辑 | 已有单页编辑对话框、分支会话和保留策略 | 加项目检查点、逐页差异、接受/撤销和约束校验 |
| 备注与演示 | 已有备注、cue/SRT、演示面板和 notes 导出 | 先完善同步与回归，音频 provider 留在后续 |
| 创建向导 | 已保存决策和 digest；普通新建会话会记录 profile | 独立向导还需连到实际创建、Agent 输入和导出设置 |
| 图表 | 已有 schema、UI、SVG 和 PPTX 原生形状路径 | 统一预览与导出布局，补齐各类型实际语义 |
| 母版 | 已有快照、默认占位符、可选择 layout 与主题 token 输出 | 将真正的布局几何和继承关系映射到 PPTX |
| PPTX 主题导入 | 已有提取、草稿、决策、确认注册流程 | 增加可信的保留/丢失报告和来源预览 |

### 已复现的两项问题

1. `packages/presentation-compiler/src/index.ts` 的新编译器对下面普通三页输入抛出 `TypeError: Cannot read properties of null (reading 'transition')`：

   ```markdown
   ---
   theme: test
   ---
   # A

   ---

   # B

   ---

   # C
   ```

   这是直接调用 `compileDeck` 的复现，未宣称所有 UI 路径都会崩溃。应复用经过验证的 Slidev 解析体系，合并编辑器导航和 IR 编译器中的重复分页逻辑，覆盖代码块、frontmatter、CRLF 和备注等场景。

2. `packages/diagram-engine/src/index.ts` 的 `renderDiagram` 接收 `kind: gantt`、空 nodes 和一项有效 tasks 后，返回 SVG 中没有任务文字和条形。浏览器渲染只消费 nodes/edges；`packages/slidewave/src/server/presentation.ts` 的 `addDiagram` 则独立处理 gantt/timeline 的 tasks。两条渲染路径语义不一致。

### 代码中可见的闭环缺口

- 创建向导最后一步直接 commit，未先保存当前 delivery 输入；`WorkspaceView.vue` 没有订阅独立 `CreationWizardPanel` 的 `committed` 事件；Gateway commit 主要保存状态和 digest。这里应与已经有效的普通新建会话路径打通，不能把“保存向导”当成“完成创作启动”。
- `compileDeck` 按位置生成 `slide-1` 等 ID；默认对象 anchor 包含位置与文字摘要。插页、排序或改文案后的 notes/animation 绑定需要稳定身份和迁移机制；当前代码不足以支持“跨修改稳定”承诺。
- `materializeMasterLayouts` 复制一个 seed layout 并更名，不能等同于还原每种主题布局的占位符几何。capability endpoint 又可能根据快照不存在 unsupported 项将 master 标为 supported。应按具体能力和验证结果报告。
- `pptx-import` 新分析器只直接读取 `theme1.xml`，使用正则提取部分信息；候选布局 confidence 是按索引递减的启发值。该数值不应被解释为保真度测量。项目另有主题提取管线，不能据此说整个导入系统只有这些能力。
- Gateway `app.ts` 约 3,600 行，且新领域代码较为压缩。随以上功能修正按领域拆分，便于独立验收；不建议为重构而整体重写。

## 相似项目与值得借鉴的内容

以下为官方公开说明，并非本次实测成绩。

| 项目 | 已公开的相关能力 | 对 FastPPT 的启发 |
| --- | --- | --- |
| [Slidev](https://sli.dev/guide/exporting) | 已记录可编辑 PPTX；文本与部分形状可编辑，SVG/公式/复杂效果会局部栅格化，存在逐页降级，文档说明不嵌入字体 | 必须用同题基准比较；字体与复杂矢量对象是值得验证的差异点 |
| [qiulishang/slidev-editable-pptx](https://github.com/qiulishang/slidev-editable-pptx) | 已核查导出脚本：浏览器几何提取、CJK/Latin 字体分段、背景面板约束、媒体/链接和布局审计 | 引入可配置字体与结构化审计；不照搬固定字体和自动居中，原生表格等另行验证 |
| [Presenton](https://github.com/presenton/presenton) | 本地/桌面、自托管、文档生成、PPTX 设计导入、手动编辑、MCP/API、多 provider | 借鉴低门槛启动、资料输入、人工编辑到导出的连续流程 |
| [PPT Master](https://github.com/hugohe3/ppt-master) | 原生形状、母版、动画、讲稿；可选数据图表/表格、OMML 公式和原生 PPTX 修改路线 | 交付深度应包含改数据和改模板，不止移动文本框 |
| [PPTAgent](https://github.com/icip-cas/PPTAgent) | 当前主分支提供编码 Agent Skill、可编辑输出、视觉审查和报告；历史研究提出内容/设计/连贯性评价 | 将生成、审查、修复和回看交付物连起来；区分当前 Skill 和旧研究 runtime |
| [open-kimi-ppt-skill](https://github.com/Binaryify/open-kimi-ppt-skill) | 仓库说明其非官方 Skill、PPTD/PPTX 输出和本地浏览器编辑器；项目已有本地参考副本 | 借鉴项目可携带性和人工编辑入口，FastPPT 继续保留自己的 Slidev 源格式 |
| [Gamma 导入](https://help.gamma.app/en/articles/11047840-how-can-i-import-slides-or-content-into-gamma)、[API](https://developers.gamma.app/) | 文档说明导入时可选择保留或改善样式，支持品牌主题与自动生成 API | 把来源、保留意图和大纲确认做成清楚的产品操作 |
| [Beautiful.ai](https://www.beautiful.ai/bunny-migration/brand-controls) | 锁定主题、共享资产、可复用页面、全局更新 | 从“更多主题”走向“团队反复复用的品牌和页面资产” |

## 建议按这个顺序推进

成本为相对工程规模，不是排期承诺；先测用户需求再确定负责人和工期。

| 优先级 | 交付切片 | 成本 | 可验收结果 |
| --- | --- | --- | --- |
| P0 | 修复编译器、向导提交、图表预览/导出一致性；收紧能力声明 | 小—中 | 普通多页可编译；最后一步不丢；向导启动实际会话；预览和 PPTX 表达同一内容 |
| P0 | 建质量基准库与 PPTX 回渲染审查 | 中 | 固定样例报告内容完整度、可编辑对象、字体/布局偏差与耗时；故障可定位到页 |
| P1 | 稳定 slide/object ID、检查点与改动审查 | 中—大 | 插页/排序后备注和动画仍跟随原页；单页修改可撤销，其他页可校验未变 |
| P1 | 资料 → 可确认大纲 → 逐页生成流程 | 中 | 首批支持 PDF/Markdown/网页；论断绑定出处；改大纲后只重做受影响页 |
| P1 | 接通数据图表和表格到工作台及主导出链路 | 中—大 | 导入 CSV/Excel 后生成图表；在 PPTX 中使用“编辑数据”；数据更新可重绘 |
| P1 | 品牌包和可复用页面库 | 中—大 | 统一 logo/字体/颜色/页脚；保存批准页面；新 deck 可检索复用、继承品牌 |
| P2 | 页面缩略图、拖拽排序、局部属性编辑 | 中—大 | 非技术用户可完成常见改字、换图、重排；修改安全写回源文件 |
| P2 | 项目打包、评审导出、批量生成与无界面运行 | 中—大 | 另一台机器可打开包；可分享静态审查材料；无活动浏览器时可完成批处理 |
| P2 | 原生 PPTX 受控填充与增强 | 大 | 先支持替换占位符、更新数据、增加备注；逐项报告保留和丢失，不承诺任意 PPTX 无损转换 |

### 三项最有价值的产品深化

**质量证据。** 现有 `validateEditablePptx` 已校验包结构、关系、页数、原生文本和全页栅格，不应重新发明。下一层是在实际 PPTX 回渲染图像上检查字体、换行、遮挡和内容缺失，并和浏览器预览对照。LibreOffice 可承担持续回归的一部分，但不能代替 PowerPoint/WPS 的真实兼容验收。照片封面等合理栅格应按对象用途处理，避免质量规则误报。

**修改可控。** 用户应看见“哪些页会变、为什么变、如何撤销”。源文件、sidecar、资产和主题摘要应成为一个可恢复的检查点。现有 revision 和会话恢复不等于演示项目级撤销。先做逐页差异和受控 patch，再做任意对象拖拽编辑。

**原生数据交付。** Slidewave 的 `slide.ts` 已有 `addChart`/`addTable`，可以复用；目前需重点打通数据模型、工作台与 DOM 捕获后的服务端转换链路。流程图 SVG、可移动形状和可在 PowerPoint 中“编辑数据”的图表是不同能力，应分别命名和验收。

### 后续的技术边界

- 将图表布局计算抽成共享模型，由 SVG/PPTX 消费同一几何结果，减少两套逻辑漂移。
- 模板导入先保证品牌 token、少量明确布局与字体映射，不做无边界的全量逆向。
- 事实来源与图片 provenance 分开建模。现有图片来源记录是基础，但正文数字、结论和资料页码需要自己的引用链。
- 无界面导出需要独立 capture adapter/runner。当前架构明确依赖浏览器 iframe 捕获，不能把“已有 HTTP API”视为“已支持无人值守生成”。
- 本地优先包含不同层次：文件本地、UI 本地、模型本地。当前 README 默认托管 Web 和 Claude/Codex，不应把文件本地宣传为整个工作流完全离线；若有明确需求，再交付本地静态 UI 和模型适配。

## 建议的三个发布里程碑

1. **可信交付版**：修复已复现问题、打通向导、稳定页面身份、引入一组黄金样例和准确的 capability report。
2. **可控创作版**：资料与大纲确认、逐页生成、检查点、可视差异、局部修复；选择两个真实场景验证完成率。
3. **重复生产版**：品牌包、页面库、数据图表、项目打包和批量工作流。根据使用数据选择桌面封装或服务化方向。

建议第一组基准覆盖中文密集页、中英混排、公式、复杂 SVG、图表、照片封面、品牌母版、备注和动画；同时跑 FastPPT 与上游可编辑导出。优先记录“获得可接受交付物所需时间”“用户手工修改次数”“导出回渲染通过率”“来源覆盖率”，而非只统计生成页数。阈值应先测基线再定。

本轮资源集中在可验证的导出、真正的主题转换生成和动画样式体系；优先完成共同语义模型、真实母版与可播放效果，再扩展主题/效果数量。完整多人实时协作、任意 PPTX 双向无损编辑保留为后续方向。

## 本次验证范围

- 执行 presentation-ir、presentation-compiler、diagram-engine、pptx-import 四包测试：共 15 项通过。
- 用只读脚本直接调用编译器和图表渲染器，复现上述两个边界问题；没有修改产品代码。
- 未运行全仓测试、真实模型生成、完整浏览器 E2E 或 PowerPoint/WPS 实机验收。因此不能将现有单测通过解释为产品所有能力已可用。
- 原有 `docs/roadmap/full-product-evolution.md` 仍有参考价值，但建议以后给每项标明“协议/UI 已有、闭环已通、实机已验收”的独立状态，按可完成的用户任务组织发布。
