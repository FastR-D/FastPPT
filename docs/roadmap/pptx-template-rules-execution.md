# PPTX 转模板与模板规则：执行版路线

更新日期：2026-10-09。本文是对 `pptx-template-rules-next.md` 的执行拆解，回答“下一步改什么、何时算完成、哪些结论不能提前宣布”。

## 本轮复核：当前执行队列优先于下方历史顺序

本轮复核的基线提交为 `4e761c7`，大量能力存在于未提交改动中。下面的差距表与 V0 失败记录是当时的复核快照；当前进度以紧接的开发进度和执行队列为准。下方历次“下一项”保留历史语境，不作为并行生效的待办。

### 当前开发进度与下一队列

V0 已修复合法编辑夹具，完整浏览器 25/25。G0 已固定 `single-master` 源包并跑通 source → theme → 独立 Slidev → native export → XML readback → LibreOffice render；45 项产物可验证，整体仍 `partial`。CLI 分发包的提取器、writer、MCP stdio 也已用保留运行冒烟通过。R1.3 的机器规则读取接口已返回摘要、状态和证据需求；Landing、Academy、whu-class 的条件布局位置 warning 已接入，自动提取建议带 `generated` 来源且不阻断自定义布局。当前覆盖为 **3/23** 个内置主题，发布级品牌值规则及渲染测量仍未实现。

下一步先修复 Gateway 通用导出测试夹具与真实 PPTX 回读的契约冲突，再完成 R1.3 的阶段／来源契约和其余 20 套主题的逐条审查迁移；实现 R1.4 的实际 PPTX 渲染证据适配器与文件哈希、页序、环境绑定门禁；再推进 T2.3 复杂 body、T2.4 字段可见性、T2.5 媒体，并扩为五组黄金样例和 PowerPoint／WPS／Keynote 应用矩阵。没有相应证据时继续报告 `partial` 或 `unverified`。LibreOffice 当前只读段落与 PDF 输出不能直接提供准确行数或内容密度。

### 下一迭代施工单（2026-10-09 复核）

| 顺序 | 实施与参考边界 | 完成判据 |
| --- | --- | --- |
| 0. 恢复 Gateway 回归基线 | `apps/gateway/tests/app.test.ts` 的 `FakeExporter` 仍写普通文本，但 Academy 现已加载机器规则，`export-jobs.ts` 会对实际字节执行 ZIP 回读。将夹具改为结构有效、符合该测试快照的 PPTX，或把此通用任务测试改为无机器规则的主题；保留真实规则回读的独立测试。不得跳过生产回读。 | 定向用例与 Gateway 全套通过；失败产物与成功产物各有断言。本轮复现的任务错误为 `EXPORT_FAILED` / `Can't find end of central directory`，属于夹具不满足新增输入契约。 |
| 1. 固定规则阶段和来源语义 | 在 `theme-registry/rules.ts` 中显式定义每种规则于 catalog approval、authoring quality、PPTX XML readback、PPTX render 的适用性及证据类型。`provenance` 与 `severity` 独立：生成建议保持 warning，只有来源事实或人工确认才可形成强制规则。保留现有同一 evaluator、摘要失效和例外机制。 | 对每种规则验证合规、违规、缺证据三态；catalog 阶段不以未来页序/排版阻断安装，readback 不使用浏览器 token/行数/密度冒充产物证据；MCP 与 Web 显示同一 ruleId、阶段、来源和缺失证据。 |
| 2. 审查内置主题而非批量填规则 | 逐一核对剩余 20 套主题的 `rulesFile`、布局定义和来源证据，建立审查清单。只将可测的布局、母版、槽位或固定对象约束写入 `machineRulesFile`；无可验证约束的主题记录 `absent` 与原因。借鉴 PPT Master 的 Brand/Layout 所有权，但继续编译到现有 ThemeDesignSpec。 | 每套主题有“规则/仅指导/缺证据”的审查结果；新增规则各有通过和反例。覆盖率按真实可执行规则计数，不能以空 JSON、CSS 变量存在或固定对象名称替代品牌值、字体与 logo 几何检查。 |
| 3. 增加产物绑定的品牌和渲染门禁 | 先为品牌颜色/字体/logo 明确源 token 到导出 Theme、Master、Layout、shape 的映射，再增加相应规则。渲染适配器绑定 PPTX SHA-256、页序/身份、渲染器与版本、字体/区域配置、逐页图像摘要和测量算法；在 `single-master` 上先做可重放的几何/换行差异诊断。参考 pptx-renderer 的属性分层，但它的浏览器布局不能当成独立 Office 证据。 | 篡改文件、换页、缺页、换字体或过期报告均失效；浏览器通过而实际 PPTX 渲染违规的反例能被检出。若渲染器无法可靠给出行数/内容密度，该规则保持 `unverified`，不从 PDF 文本或 XML 猜测。 |
| 4. 扩展导入保真与交付样例 | 逐项完成复杂 body、动态字段、图片/裁剪/背景/线条，每项保留来源 → 模板契约 → 浏览器捕获 → 原生导出/回读 → 应用探针。借鉴 open-kimi-ppt 的可携带项目加成品交付，但保留 FastPPT 母版关系。 | 保留 `single-master`，新增多母版、多脚本/RTL 与复杂 body、字段、媒体四组，共五组黄金样例；每组保存源/产物/降级清单与摘要。PowerPoint、WPS、Keynote 分别记录打开、改字/切布局、保存重开；未测应用只标 `unverified`。 |

以上是执行顺序，不把所有格式支持视为规则上线的前置条件。每项能力只在其对应的结构、编辑、视觉和应用证据齐备后提升支持等级；同一来源问题不能通过改写生成建议或人工例外伪装成验证通过。

### 新确认的差距

| 观察 | 代码证据 | 后续影响 |
| --- | --- | --- |
| 仓库 `themes/*/agent/theme-manifest.json` 共 23 个，声明 `machineRulesFile` 的为 0 个 | `packages/theme-registry/src/index.ts` 将机器规则设为可选；新提取器和设计生成器已经会输出 JSON | 已有 evaluator 不等于所有内置主题已经使用机器门禁。先覆盖代表主题，再逐个迁移；此计数不包含用户目录中的导入主题。 |
| MCP `get_theme_rules` 只返回 Markdown | `packages/fastppt-mcp/src/server.ts` 的 `getThemeRules` | Agent 创作前缺少直接读取结构化约束及其摘要的统一入口。保留现有字段，增量返回机器规则和证据需求。Skill 安装状态不能证明规则已遵循。 |
| token 规则检查变量名存在，固定对象规则检查名称、归属和覆写 | `packages/theme-registry/src/rules.ts` | 这些规则不能证明颜色值、字号、logo 资产或位置正确。规则命名和用户说明保持现有含义；新增品牌检查需要独立 schema 和测量。 |
| 实际产物规则证据仍只有 XML | `apps/gateway/src/theme-rule-readback.ts`、`packages/protocol/src/index.ts` 的 `themeRules.readback` | CSS 变量不会存在于 PPTX；行数和密度也不能从 XML 推断。应先明确规则适用阶段，再接独立渲染器。 |
| 普通 RTL 已贯通，复杂 body 和动态字段未贯通 | `native-text-body.ts` 仅接受 `autoFit: none`；`source-layouts.mjs` 阻断其他 body 属性；`objects.ts` 的 field 保存缓存文字和 source XML | 按属性逐项开放。`fld` 的原始 XML 保留不等于已有可用的字段类型、更新与可见性契约。 |
| 尚无 `tests/golden/pptx-template/` 完整产物库 | 现有证据集中于单元夹具、E2E 和 `docs/validation/`，应用产物多位于 `/tmp` | 先固化一个最短完整样例，随后累积五组；不能把报告中的临时路径当作可长期重放的交付。 |

新生成主题默认的 `source.first-cover`／`source.last-end` 来自生成器建议，并非从源 PPTX 证明的顺序要求。后续规则来源应显式标注 `generated`，只有明确源证据或用户决策才升级为强制规则；通用 cover/end 建议不能覆盖已锁定的源布局选择。

### 本次验证及首个待办 V0

三项类型检查通过：Slidewave `tsconfig.build.json`、E2E、PPTX Import；`git diff --check` 通过。两个浏览器 spec 合跑为 **24/25 通过**，其中独立生成主题（包含 RTL）通过。Tab 专项单独重跑仍失败：

```text
tests/e2e/specs/fastppt.spec.ts:1250
invalid-snapshot: Capitalization defaults require projected text leaves.
```

该用例在 1248 行直接向带 capitalization defaults 的段落追加裸 DOM Text；`text-capitalization.mjs` 的新契约明确拒绝这种节点。用例前面的 Markdown 更新和重新捕获已通过。因此当前已定位到“旧 DOM 编辑夹具与新叶节点契约冲突”，尚不能据此宣称普通源文件编辑损坏。

V0 首先明确并验证合法编辑路径：通过 Markdown/API 更新生成新叶节点，或编辑已有受校验叶节点，再验证 Tab 自动折行；直接插入裸 Text 保留为应阻断的反例。若产品承诺支持任意 DOM 文本编辑，则先补投影归一化及来源验证。不得删除 capitalization 校验或靠等待掩盖冲突。修正后跑失败专项和两个完整 spec；再执行受影响包类型、lint、构建及打包冒烟。本轮没有重跑全仓单元、lint/build 或 packaged smoke，不能沿用历史全绿结论。

### 参考项目的本轮采用决定

| 参考与版本 | 本轮核查 | 采用到 FastPPT | 适配边界 |
| --- | --- | --- | --- |
| PPT Master `be8089296767d3e8cf012e07ea31c8716591bad8`，MIT | 本地 `docs/templates-architecture.md`、`template_validation.py` | 区分品牌、风格、布局和场景职责；保留来源所有权；对实际导出的 Master/Layout 关系做回读；发布先预检再原子安装 | 继续使用现有 ThemeDesignSpec 和 Slidev，不为对齐名词而拆成四套注册表；已有原子安装和回读不重建。 |
| pptx-renderer `2e8cd2222a889451bc872df50941f927cc79c7a2`，Apache-2.0 | 本地 `TextRenderer.ts`、`ShapeRenderer.ts` | 把文字继承、`fontScale`／`lnSpcReduction`、横纵溢出拆成可独立验证的属性及反例 | 不采用经验缩字、隐式标题 fit 或隐藏溢出来证明保真；浏览器渲染器不能作为独立 Office 验收。 |
| open-kimi-ppt-skill `07eeaadcb04c32c9adb107eb5c8608e6be4e1008`，MIT | 本地 README 的项目目录、浏览器编辑及输出说明 | 交付可携带的源项目、资源和审查结果；提供来源／候选／导出物的连续查看 | 不引入 PPTD 替换 Slidev；其扁平页面结构不替代 FastPPT 的母版契约。 |
| Slidev `30a0a54c8739b4b395d9b336a6304cc8ebcc3947`；qiulishang `1e462feca835d97d12773cd33debd917bf493e1f` | 沿用 09-28 的固定源码调研，本轮远端读取超时；本地 Slidev 为较旧的 `0d798ac` | 沿用 walker／normalize／capture／build 分层，以及字体分段、边界和重叠诊断思路 | 不声称本轮已复核最新上游或其许可证；实际移植前重新核查。禁止照搬固定中英字体或自动居中策略。 |

本轮没有运行以上项目，也没有复制其实现；外部实现用于职责划分和测试设计。Gamma／Presenton 的既有产品调研保留为背景，不作为本轮源码或兼容性证据。

### 按可交付结果推进

与原先“全部格式补完后才做渲染和黄金样例”的顺序相比，现将最小黄金链路与规则证据提前。T2 的格式范围保留；每个切片有确定退出条件，不等待任意 PPTX 全覆盖。

| 顺序／优先级 | 工作包与主要落点 | 验收结果与依赖 |
| --- | --- | --- |
| 1／P0：V0 验证基线 | `fastppt.spec.ts`、`text-capitalization.mjs`、`script-fonts.mjs` | 解决上述夹具／契约冲突；合法源编辑后自动折行、原文和 native Tab 均保留，非法裸 Text 仍阻断；两个完整浏览器 spec 通过。 |
| 2／P0：G0 最小黄金链路 | 新建 `tests/golden/pptx-template/` 的首个单母版样例及重放入口 | 固定 source、analysis、theme、lock、export、readback、browser/PPTX rendering 和报告清单。记录输入／工具／字体／产物哈希；应用不可用时明确 unverified。V0 后开始，先复用已有兼容探针。 |
| 3／P0：R1.3 规则覆盖与阶段契约 | `theme-registry/rules.ts`、MCP `getThemeRules`、生成器、主题 manifest、Gateway／Web 报告 | 先迁移 Landing、Academy、whu-class 三个代表主题。合法样例通过、故意违规可定位、缺证据可见、改规则使旧报告失效；之后迁移余下 20 个主题。只迁移已确认且能测量的规则。 |
| 4／P1：R1.4 实际产物渲染门禁 | `protocol`、`theme-rule-readback.ts`、`export-jobs.ts`、`tests/e2e/scripts/lib/` | 先让 G0 的实际输出经独立渲染器生成行／对象证据并进入现有 evaluator。改文件、换页序、缺页、渲染失败、旧报告均不能发布；浏览器通过而 PPTX 换行失败的反例须被检测。依赖 R1.3 的阶段语义。 |
| 5／P1：T2.3 复杂 body 的受支持子集 | `pptx-import`、`native-text-body.ts`、IR／MCP、`source-layouts.mjs`、捕获和绑定 | 逐项处理 `vert`，`numCol/spcCol/rtlCol`，`horzOverflow/vertOverflow`，autofit。每项先来源／应用探针，再整条链路；RTL bullet／Tab 另立几何子项，不能随普通 RTL 自动放开。 |
| 6／P1：T2.4 动态字段与可见性 | `objects.ts`、继承／IR、原生 writer、规则回读 | 建模 `fld` 的 id/type/缓存文字、日期更新方式、页码和页脚，以及各层 header/footer 开关；换页、隐藏、保存重开可验证。whu-class 可达布局里的 `dt/ftr/sldNum` 作为真实验收输入。 |
| 7／P1：T2.5 媒体和绘制属性 | `objects.ts`、`backgrounds.ts`、同源 layout、`master-objects.ts` | 逐项贯通图片关系／裁剪、透明度、背景和线条；原始图片、矢量图片、原生形状分开报告。未知复杂矩阵与效果保留对象级 partial。 |
| 8／P1：G1 发布矩阵 | 五组黄金样例、固定环境及应用操作报告 | 各切片完成时加入相应黄金输入，最后按五组目录重放。PowerPoint／WPS／Keynote 分别记录新建页、切换布局、修改母版、编辑、播放、保存及重开；每个未测应用维度继续 unverified。 |

R1.3 的具体规则设计：

1. 创作入口返回 Markdown、机器规则、规则 digest、规则来源和所需证据；Agent 在选布局和填槽前读取。模板设计建议、结构硬约束与审美人工审查分开显示，允许主题批准的自定义页面表达。
2. 为下一版规则提出明确的作用范围和证据类别：目录结构、文稿结构、浏览器测量、PPTX 结构、PPTX 渲染。V1 继续原有缺证据行为；迁移需要生成可审查差异，不能静默跳过原有 error。
3. CSS token 存在性规则限定在能观测它的阶段。需要交付品牌色／字体保证时，新增输出属性规则和对象／角色映射；不得把浏览器变量声明当成 PPTX 使用该值的证明。固定 logo 的资产摘要／几何也需独立测量，不把同名对象当作资产等价。
4. 先使用已支持的结构规则；行数／密度等 error 只有配置了相应证据生产者才作为发布保证。缺规则、零检查与通过分开呈现；未覆盖原则列为人工检查。已有例外继续绑定版本、问题、阶段和原因，批准不改变原始验证状态。
5. 验收至少覆盖：错布局、漏槽位、固定对象覆写、错误品牌值、缺机器规则、旧摘要、渲染不可用及例外撤销。新品牌值规则在实现前保持规划状态，不能算入当前覆盖率。

R1.4 的证据清单至少包含实际 PPTX SHA-256、renderer/version、字体与区域配置摘要、页序／slideId、每页图像摘要、测量算法版本和指标定义。继承固定品牌对象是否排除、文字行怎样归并、内容密度分母怎样确定必须与规则一致；只有 PNG 或 PDF 文本提取不能自动证明这些指标。LibreOffice 是一个有明确版本的目标结果，PowerPoint 等应用需要各自证据；独立渲染器适配器不复用 FastPPT 的浏览器测量值。

T2.3 的 autofit 必须区分 noAutofit、normAutofit 的声明参数／缓存比例和 spAutoFit 的形状变化。编辑后是否重新计算、实际字号与原始字号如何保存都要先定契约；不能把旧 `fontScale` 永久冻结为源字号，或仅用 CSS clip 隐藏丢失内容。`numCol/spcCol` 才是分栏的具体 OOXML 属性，`rtlCol` 与段落 `pPr@rtl` 独立。

下一次开发从 **V0 → G0 → R1.3** 开始；先获得可重放且规则覆盖清楚的首个闭环，再进入 R1.4 和后续格式切片。全量目标保持进行中。

## 当前判断

现有工程已经具备导入分析、主题草稿、导入决策、原生布局文件、Master/Layout 导出入口和机器规则校验。结构测试和 Gateway/Web 回归已经覆盖主要协议路径；PowerPoint、WPS、Keynote 的打开、编辑、播放、保存、再次打开仍未验收。因此当前能力应继续标为 `partial`，不能因为存在 XML 节点或静态截图而升级为 `supported`。

当前最短闭环是：

```text
source.pptx
  -> relationship/source facts
  -> reviewed layout contract
  -> theme-lock + native-layouts
  -> editable pptx
  -> XML read-back
  -> rendered comparison
  -> application smoke report
```

这条链路完成前，不扩展更多布局种类，也不把 `fidelity` 解释成逐像素或逐动画还原。

## 从参考项目采用的边界

### PPT Master：分离来源事实与模板职责

本地快照 `references/ppt-master/docs/templates-architecture.md` 将 Brand、Style、Layout、Deck 分成不同职责，且把它们编译到同一套原生 Theme/Master/Layout/Placeholder 图。FastPPT 不立即拆分现有主题注册表，先在现有 `ThemeDesignSpec` 中增加清晰的 ownership/provenance：

- `brand`：颜色角色、字体、logo 和固定品牌资产；
- `style`：密度、组件变体、图像处理和审查建议；
- `layout`：画布、Master/Layout 身份、placeholder `type/idx/geometry`、固定对象和槽位语义；
- `application`：页面角色、顺序约束和主题规则。

来源字段使用 `extracted`、`derived`、`inferred`、`generated`、`user-overridden`。生成器只能新增 proposal，不能改写 `extracted`。以后若需要 Brand/Layout 独立复用，可以从这些字段物化新 kind，而不破坏现有 manifest。

PPT Master 对镜像导入的另一个可取边界是：只发布源页面实际可达的 Layout/Master 图；未被任何页面引用的源结构留在分析证据中，不自动变成可选布局。发布前先完成全量预检，再原子写入目标目录，失败时只保留草稿。

### Slidev 与 qiulishang：保留分层和诊断

参考实现的共同点是把 walker/捕获、几何归一化、PPTX 写入和审计分开。FastPPT 继续沿用浏览器捕获与 Slidewave 服务端转换边界，并借鉴 CJK/Latin run 分段、文本/媒体越界、背景面板约束、重叠和留白诊断。字体必须来自主题脚本映射；默认保留源几何，自动加宽、居中或缩字只能作为可预览修复建议。

上游快照没有被本工程当前锁定的 Slidev 版本证明兼容；外部项目也没有在本机做 PowerPoint/WPS/Keynote 实测。所有这类结论只作为实现参考，不作为支持声明。

### open-kimi-ppt 与 Gamma：让用户确认意图

`references/open-kimi-ppt-skill` 展示了“可继续编辑的中间项目 + PPTX + 浏览器人工编辑”的连续交付；Gamma 的导入说明强调保留来源样式或改善样式是不同意图。FastPPT 的四条路线继续保留，但界面文案应先解释结果，再显示内部 route：

| 用户意图 | 内部路线 | 能承诺的结果 |
| --- | --- | --- |
| 只复用品牌 | `tokens` | 颜色、字体、画布和来源证据可复用 |
| 保留源页继续编辑 | `mirror` | 保留源 PPTX 和可达关系图，生成对照布局 |
| 保持视觉并接受局部降级 | `fidelity` | 逐页对照、对象降级和字体/裁剪/渐变报告 |
| 生成可复用 FastPPT 主题 | `standard` | 仅注册通过规则、布局和构建审查的候选 |

路线仍可由专家显式覆盖，但普通用户不应被要求理解 `strict`、`mirror` 等实现枚举。

## 三个执行切片

### T1.1：把源 PPTX 事实补齐到可审查候选

目标是让每个候选 Layout 都能回答“来源哪里、哪些字段完整、哪些字段需要人确认”。

改动位置：

- `packages/pptx-import/src/inheritance.ts`：完成 page → layout → master 的几何、字体、段落、填充、线条合并；组对象先保留矩阵，缺矩阵时保持 `unresolved`；
- `packages/pptx-import/src/objects.ts`：补充 fill/line/text run/source boundary 和图片裁剪、透明度、旋转，并区分 layout-owned 与 master-owned 固定对象；
- `packages/pptx-import/src/index.ts`：把每个候选的 `source`, `semanticEvidence`, `completeness`, `unsupported` 写入分析结果；置信度只在有证据时出现；
- `packages/presentation-ir/src/index.ts`：扩展 `ImportAnalysisV1`，保持旧字段可读；
- `scripts/extract-theme.mjs`：只消费 typed analysis，生成 `native-layouts.json` 与 `layout-candidates.json`，不从布局序号猜测语义。

验收样例：两套 Master、两套 Theme、非数字页面文件名、未使用但已注册的 Layout、`themeOverride`、背景图片/渐变、中文/Latin 混排和裁剪图片。

完成标准：来源 XML 能回指到 part/shape；不完整 placeholder 进入 `partial`；未解析颜色和背景带原因；任何生成字段都不会覆盖来源字段。

### T2.1：让同一份 Layout Contract 驱动浏览器和 PPTX

目标是证明布局切换和母版修改真实影响导出页面，而不是复制 seed layout 改名。

改动位置：

- `packages/fastppt-mcp/src/theme-design.ts`：生成 layout contract、`agent/native-layouts.json` 和对应 Vue layout；
- `packages/slidewave/src/server/master-layout.ts`、`master-objects.ts`、`placeholder-binding.ts`：只从锁定的 contract 写 Master/Layout/Placeholder；
- `apps/gateway/src/app.ts`：审批时将来源 layout ID 映射为生成 layout 名称，冻结 layout selection、masterId 和 placeholder binding；
- `packages/presentation-compiler`：保留页面到 layout/placeholder 的显式绑定，缺绑定时给出阻断错误；
- `packages/slidewave/test`：增加真实 zip 回读，检查两个布局的几何、`ph type/idx`、Master relationship、固定对象和页面绑定。

源布局生成现在由 `scripts/lib/source-layouts.mjs` 消费真实分析结果：按 part 读取对象，使用正向 Master 关系、归属主题和归一化矩阵；浏览器固定层带 Master/Layout 归属与锚点，占位符生成 `ph-<index>` 命名槽位。已增加真实 PPTX → 分析 → 主题 → 原生导出 → 回读测试以及浏览器几何检查。无法物化的对象、复杂样式、背景等仍使候选保持 `partial`，未使用的源布局只留证据。生成状态 `complete` 表示现有原生契约可以物化，不代表源文字样式或应用视觉验收完成。

验收动作按固定顺序执行：新建页面继承布局 → 切换布局 → 修改母版固定对象 → 重新导出并回读。至少覆盖两个 Master、三个 Layout 和一个没有完整定义的 `partial` 候选。

完成标准：浏览器页面和 PPTX 使用同一 canvas/geometry；切换布局不串 placeholder；修改母版能影响使用它的页面；缺定义时 capability 明确为 `partial`，不伪报 `supported`。

### R1.1：统一模板规则和发布门禁

`packages/theme-registry/src/rules.ts` 已支持首末布局、必选/禁用布局、允许布局和页数上限，并扩展以下规则；具体语义与测量边界见 [模板机器规则](../theme-rules.md)：

- `required-master`、`allowed-masters`；
- `required-placeholder`（布局、type、idx）；
- `required-token` 和 `forbidden-token`；
- `max-text-lines`、`max-density`（以页面角色为输入）；
- `fixed-object`（名称、归属 Master/Layout、是否允许页面覆写）。

规则结果必须由同一 evaluator 复用到：

1. 导入审批：决定哪些候选可以注册；
2. `validate`：阻止明显违反主题契约的 deck；
3. preview quality：在页面和对象位置显示 `ruleId`；
4. editable export：把规则摘要和问题写入报告；
5. PPTX read-back：确认导出后契约仍成立。

2026-10-09 进度：approval/validate/quality/export/readback 已调用同一 evaluator。审批检查裁剪后的主题目录，首末布局按可用性判断，未来页数和排版保持未验证；error 在原子安装前阻断并保留报告。Gateway 提供所选布局、母版、占位符、继承固定对象与动画覆写证据；浏览器提供行数、内容密度和计算后的 CSS 变量。质量报告绑定文稿 revision、主题摘要、规则摘要、profile 和锁定母版内容摘要。

导出任务冻结规则文档，生成后从实际 ZIP 关系和对象执行回读；报告保存文件 SHA-256、实际 part 和问题，审查及 HTTP 下载时核对文件／规则摘要。动画变体的逻辑身份与实际发出 shape 一起核验。回读不沿用浏览器的行数、密度或 token 测量；没有匹配的显式例外时，error 级证据缺失仍阻断。文稿例外已接入当前问题验证、记录／撤销、分阶段应用和发布复验；完整语义见[模板机器规则](../theme-rules.md)。PPTX 渲染证据和黄金产物仍是 R1.1 后续项。

回读可见性处理参考 `pptx-renderer` 的 slide/layout `showMasterSp` 分层语义，固定快照 `2e8cd2222a889451bc872df50941f927cc79c7a2`（Apache-2.0）。目录职责继续借鉴 PPT Master `be8089296767d3e8cf012e07ea31c8716591bad8`（MIT）的来源所有权分层。两者仅是实现参考，不是 Office 兼容性证据。

主题内容、机器规则、锁定 Master 任一 digest 变化，都必须使旧质量报告失效。`warning` 与 `needs-human` 进入审查面板；只有 `error` 默认阻断，用户批准的例外写入带 revision 的 override。

## 验证资产和发布顺序

建立 `tests/golden/pptx-template/`，每个样例固定以下产物：

```text
source.pptx
analysis.json
generated-theme/
theme-lock.json
exported.pptx
read-back.json
rendered/browser/*.png
rendered/pptx/*.png
report.json
```

首批五个样例：

1. 单 Master、中文长标题和正文；
2. 多 Master、多 Layout、非连续页面关系；
3. 多 Theme/`themeOverride`、渐变和图片背景；
4. CJK/Latin/代码混排、字体替代与裁剪图片；
5. notes、点击动画、原生图表/表格和一个 `partial` 复杂对象。

每个样例按四层出报告：

- 结构：关系、节点顺序、shape/placeholder 引用；
- 编辑：文本、布局、母版、图表/表格能否修改；
- 视觉：浏览器与回渲染逐页差异、换行、裁剪、透明度、背景和层叠；
- 应用：PowerPoint、WPS、Keynote 分别记录打开、编辑、播放、保存和再次打开。

LibreOffice 只作为持续回归渲染器，不能替代三种目标应用。没有应用层证据时，报告状态保持 `unverified`，能力保持 `partial`。

## 暂缓项和停止条件

- 暂不支持任意 PPTX 无损双向编辑；`mirror` 只保证保留源文件和可达关系证据。
- 暂不把渐变、复杂组矩阵、SmartArt、Morph 或字体嵌入写成默认支持；每项先进入对象级降级报告。
- 暂不把 layout 序号、文件名或截图相似度当作语义置信度。
- 导出发现正文/数据缺失、悬空关系、未绑定 placeholder 或规则 error 时停止写出；保留快照与分析结果供重试。
- 任何外部项目的实现都先记录 commit、许可证和适配边界，再决定复用、改写或只借鉴测试思路。

## 推荐执行次序

原始依赖为 T1.1 来源 → T2.1 同源布局 → R1.1 规则统一 → 五组黄金样例与应用矩阵；前三项已有基础闭环。按本文顶部的复核队列推进，并依据对应层次的结果更新能力等级。

## 下一轮的具体顺序

以下保留文字切片期间的技术依赖和验收边界；当前优先级以顶部复核队列为准。

1. master `txStyles`、段落默认 run 和字体脚本逐属性继承已接入分析及候选投影。占位符 `fontFamilies` 已贯通源主题生成、浏览器字素分段、单个原生文本对象捕获、布局继承和实际 PPTX 回读，详见 [文字继承与投影](../pptx-text-inheritance.md)。逐级段落默认值和显式多段文本框已接通：九级独立继承，对齐／缩进／间距与逐脚本字体共用契约；标记的普通富文本可捕获为一个原生占位符，保留空段、软换行和链接。基础 `textBody` 已实现内边距、垂直对齐、换行、noAutofit 和独立继承策略；同层文字子属性冲突已进入来源诊断。字符项目符号的四组契约、源主题求值、悬挂预览、单形状捕获和回读已接通；常用自动编号的契约、计数、捕获与原生写入也已接通，重启兼容性继续提示复核；接下来补齐其余标记几何、制表位和剩余 run 格式，再处理日期／页脚字段；固定文字多脚本字体、背景、裁剪图片和线条继续按独立契约推进。现有无法表达项仍给出对象级降级，不得为了产生更多 `complete` 候选而丢弃证据。
2. 审批、实际 PPTX 规则回读和显式文稿例外已接通。继续补充 PPTX 渲染器的证据输入与可重放报告，保持浏览器／PPTX 证据来源独立。导入目录审批保持独立作用域，不读取文稿例外；未来如开放目录级例外，需另绑定 catalogDigest 和审批决策版本。
3. 将目前临时回归样例扩展成五组可重放的黄金产物，保存 source、analysis、theme、lock、export、read-back 和浏览器/PPTX 回渲染图；门禁发现正文或关系丢失时阻断。
4. 在可用目标环境录入 PowerPoint/WPS/Keynote 打开、编辑、播放、保存、再次打开的结果。没有应用证据时保持 `unverified`，不得用浏览器回归替代。

本轮真实样例补充：whu-class 的 92 页源文件经打包后分析／提取，字体求值无未解析问题，但唯一可达布局包含 `dt`、`ftr`、`sldNum`，当前原生契约不支持这些元数据占位符，故保持 partial。后续对象扩展应覆盖日期／页脚／页码的字段语义及 header/footer 可见性；只增加类型枚举而不验证动态字段和显示行为，不算完成。

### T2.2：后续开发的具体验收顺序

| 顺序 | 行为 | 可审查结果与通过条件 |
| --- | --- | --- |
| 1 | 逐级段落、框体与 run 契约（部分落地） | 九级独立继承、显式零值／false、对齐／缩进／间距与脚本字体已打通；显式文本框保留多段／空段／软换行／run／链接，并绑定唯一原生形状。基础内边距／垂直对齐／换行与独立框体继承已通过横纵缩放和实际 ZIP 回读。继续补齐项目符号、制表位、剩余 run 格式及复杂框体；局部不支持须定位并阻断／降级，不能扩大 supported 声明。 |
| 2 | 日期／页脚／页码字段 | 先保存源 `fld` 类型与缓存文字、header/footer 开关及来源，再定义允许的字段和显示规则；换页、隐藏、保存后回读可解释。不能用静态缓存文字冒充动态域。 |
| 3 | 图片／裁剪／背景／线条 | 资源关系、裁剪矩形、透明度和继承顺序进入契约；浏览器、输出 ZIP 和回渲染逐项对照。复杂矩阵或效果继续保留定位降级。 |
| 4 | 独立 PPTX 渲染证据 | 接入有版本记录的渲染器，证据绑定输出文件哈希与页序；渲染失败或过期不可复用浏览器测量。规则报告保留测量来源和未验证项。 |
| 5 | 五组黄金产物与应用矩阵 | 用固定输入重放完整链路，持久保存分析、主题、lock、PPTX、回读及两类渲染报告；再记录 PowerPoint/WPS/Keynote 实际打开、编辑、播放、保存和重开结果。 |

逐级文字切片已增加真实源 PPTX 回读与浏览器嵌套列表回归；文本框切片另增加单形状、唯一段落属性节点、普通 run 显式 false、空段和连续软换行的 ZIP 检查。框体契约已有母版内边距继承、布局显式零值、noAutofit 覆盖、非等比浏览器画布和真实 bodyPr 回读。生成主题的 source-layouts.md 说明显式文本框、整体框体捕获和子锚点限制。它们仍不能替代 Office 行高、换行、内边距视觉效果和应用编辑验收；当前百分比间距仅使用 CSS ratio/em，没有采用参考渲染器的经验行高因子。

#### 下一切片：列表与制表位的实施边界

参考 `pptx-renderer` 固定快照的 `TextRenderer.ts`：项目符号类型、字体、大小、颜色分别继承；悬挂缩进、计数和制表位布局在段落层处理。FastPPT 采用这个职责分离，重新定义可验证契约；其编号计数、空段处理和浏览器布局只作为反例来源，不能直接当作 Office 等价结论。同层重复／互斥文字子属性已先行修复：清除该项的解析值和来源指针、保存全部源 XML 并报告冲突，不能通过最后一个 buNone 隐藏前面的项目符号。

| 次序 | 实现位置和行为 | 必须通过的验收 |
| --- | --- | --- |
| L1 字符项目符号（基础链路已落地） | `native-text-style.ts` 与 IR 定义无标记／字符标记的互斥类型，字体、点值／百分比／随正文、颜色／随正文分别保存。`source-layouts.mjs` 消费分析属性；`script-fonts.mjs` 投影标记与正文，捕获层保留段落标记，写入器输出原生 buChar/buNone。 | 切换九级、局部取消、符号字体、标记颜色、悬挂缩进、折行及空段都有浏览器和 ZIP 证据。符号不能进入正文字符串，也不能成为额外占位符；页面继承仅移除布局明确拥有的各组属性。 |
| L2 自动编号（基础链路已落地，重启兼容性有边界） | 契约保留编号样式与显式 startAt，捕获整个文本框的段落顺序；浏览器计数、写入及回读共用相同顺序。先支持有验收样例的编号格式，其余继续 partial。 | 覆盖起始值、显式重启、换级再返回、中断／空段、换布局和文案编辑；输出为 buAutoNum，不能把显示数字拼进正文来冒充编号。编号连续性需要独立 PPTX 渲染／应用证据。 |
| L3 制表位（含显式 decimal 与自动折行，应用兼容性有边界） | 契约区分默认间距、显式 tabLst 和空 tabLst；位置使用布局 EMU，继承按整组替换。先实现经测量验证的左对齐，再分别支持居中／右对齐／小数点对齐。 | 正文保留 tab 字符；验证跨 run、连续 tab、默认间距、显式清空、缩进、混排及画布缩放。无测量证据的组合继续阻断显式文本框捕获，不用空格替换。 |

2026-10-09：L1 基础链路已通过真实源文件生成／回读、浏览器编辑／缩放与错误标记阻断。已覆盖独立符号字体、随正文、点值／百分比、主题色变换、逐级和局部取消、空段、折行及字体字形收集；符号不混入正文。浏览器目前测量左对齐／两端对齐的负缩进悬挂段落，居中／右对齐和非负缩进仍保持 partial，须结合 L3 的制表几何继续完成。固定文字项目符号、自动编号、图片标记及目标应用视觉验收没有随之完成。

2026-10-09：L2 现已接通 16 种常用编号格式，区分模板默认起点与页面主动重启。浏览器／捕获／写入共用按文本框隔离的逐级计数，空段和普通文本中断不消耗编号；上层列表项重置下级。真实生成和回读保留 buAutoNum、起点与来源，未实现格式保持 partial；编辑、缩放、分框和异常标记已有浏览器回归。新增[独立 LibreOffice 回渲染](../validation/numbering-compatibility.md)：21 页中 19 页编号吻合，重启到 1 和相邻相同起点的 2 页保留已知差异及导出提示。参考快照 `pptx-renderer@2e8cd2222a889451bc872df50941f927cc79c7a2` 使用取模 26 格式化字母编号，FastPPT 以 AA/AB 等独立期望和回渲染证据校正，没有复制该算法。该证据只验证此渲染器版本的编号结果，没有完成字体度量、规则发布门禁接入或 PowerPoint/WPS/Keynote 应用矩阵；L2 不作全应用支持声明。下一实施项为 L3 制表位与剩余悬挂几何。

2026-10-09：L3 左对齐基础链路已落地。默认间距与停止点列表独立继承，保留零值和空列表；源分析、IR、锁定布局、源 Vue、显式文本框捕获、原生写入及实际回读共用契约。正文保留真正 Tab，编译前保护避免 Vue 压缩为空格，宿主与生成主题的独立 Slidev 均有验证。跨 run／中文混排、连续 Tab、软换行、负缩进、字体加载和画布缩放已覆盖；自动折行及其他未测量组合仍阻断。独立 LibreOffice 15 页实际导出中 7 页吻合、8 页有已知差异，诊断副本另记，见[制表证据](../validation/tabs-compatibility.md)。不得因移除 indent 的副本显示正确而删除生产产物的来源缩进。

L3 后续按以下顺序推进，不把序列化完成当作浏览器或应用支持：

1. 居中／右对齐停止点已落地：以完整字段测量跨 run 宽度，Tab／显式软换行终止字段。浏览器验证编辑、缩放、相邻／默认停止点、空字段和长字段；捕获复核间隔，实际回读保留 ctr/r。字段过长时使用零间隔；参考实现跳到默认网格的算法与独立探针不同，没有照搬。
2. 小数点对齐：先定义来源及目标应用的分隔符约定，再测量经目标应用验证的锚点。新增 de-DE/fr-FR 探针保留原生 run 语言，但 LibreOffice 仍按句点对齐；不能直接使用 Intl 默认值或把 run lang 当作分隔符控制。已有独立探针也不支持参考实现的半点号偏移。无分隔符、多个分隔符、跨 run 和混排逐项补样例；声明格式前须保留应用环境依赖。
3. 制表字段自动折行与剩余标记几何：定义显式行／自动行的原生语义后再解除阻断；继续保持内容字符、原生对象数和源属性不变。非负缩进或居中／右对齐项目符号不能因左对齐 Tab 已完成而提升能力等级。
4. 与剩余 run／RTL、日期／页脚字段、图片契约一起逐项接通独立渲染证据，再进入五组黄金产物及应用矩阵。渲染结果接入规则门禁时必须绑定实际 PPTX 哈希、页序、渲染器版本及阶段，不复用浏览器或诊断副本结果。

2026-10-09：小数点前置的主／备用语言传递已完成。`lang`／`altLang` 在 NativeCharacterStyle、IR、Vue、逐级与页面／布局继承及实际回读中独立保留；缺省、空值、私有标签和大小写不合并。普通文字、显式多段文本框和统一语言的固定文字均已验证；非法来源使候选保持 partial，混合固定文字不被压平。已修复写入器合成 en-US／备用语言和空布局占位符的假语言；浏览器覆盖作者声明、内联覆盖、嵌套列表、空段、编辑和缩放。详见[文字继承记录](../pptx-text-inheritance.md)。

2026-10-09：decimal 来源／应用证据格式已落地。分析器显式保存源分隔符 unknown，生成器将其保留在 SOURCE_SELECTION；IR 区分用户声明和应用观测，报告绑定应用版本、实际区域设置、初始配置、复现脚本与产物哈希，复核页序、源内容和几何状态。新增隔离 LibreOffice／UNO 探针：en-US 使用句点，de-DE／fr-FR 使用逗号；每种区域设置 23 组样例，69 页实际产物保留已知缩进差异，69 页诊断副本均符合固定期望，未预期差异为零。详细限制与复现命令见[小数点制表证据](../validation/decimal-compatibility.md)。

2026-10-09：decimal 声明与浏览器测量已接通。`decimalTab` 绑定用户原因与已测量应用配置，IR／MCP／原生模板／源 Vue／捕获保留逐级覆盖和显式清除；提取器 `--decimal-tabs` 以源 SHA-256 绑定声明，原始 unknown 独立保留。浏览器测量首个分隔符字形左边缘，缺失时测量字段末端；跨 run、强调、混排、空字段、软换行、编辑、缩放及异常捕获已通过宿主和独立主题回归。报告配置固定关联诊断证据与实际生产差异，不自动设置应用环境。原生保留 Tab、dec 和 indent，并输出应用配置／证据提示；再次分析仍正确得到未知分隔符。详细契约和声明示例见[小数点制表证据](../validation/decimal-compatibility.md)。

2026-10-09：制表字段自动折行已接通实测与行级捕获。Tab 间隔迭代至稳定，新行重新选择停止点；完整字段和 decimal 前缀按跨行累计字宽计算。`tabLayout` 记录原文、连续范围、自动／软换行及实际边界，原生只保留原字符与作者换行。窄框、长词、超宽停止点、显式列表耗尽、正负缩进、编辑、缩放、篡改记录和独立主题均有回归。独立应用探针实际／诊断共 66 页：20 个制表案例分别 14 吻合＋6 已知差异／20 吻合，13 个项目符号案例各自只记观察。见[文字流证据](../validation/text-flow-compatibility.md)。精确字宽边界仍有浏览器／应用差异，不能修改来源框宽或硬写自动换行来隐藏它。

下一实施项为剩余项目符号几何：明确标记字体／字宽、首行占用和续行对齐，再支持非负缩进与居中／右对齐。先补显式字体、随正文、独立字号、长标记、空段和长词折行探针；现有证据显示 LibreOffice 的随正文字体标记可使用 OpenSymbol，不能把浏览器所选字宽直接当成应用宽度。实现需保留标记与正文分离及用户字符，不向正文拼接符号或空格。随后进入 run／RTL、动态字段、图片／背景契约和实际 PPTX 渲染规则门禁。未知来源、未测量组合和已知应用差异继续保持 partial；诊断副本不替代生产应用验收。

每个切片都按“源解析及诊断 → IR／原生契约 → Vue 投影与捕获 → 继承绑定与写入 → 真实回读及浏览器反例”的顺序交付。新增字段须贯通主题生成、锁定快照和 MCP 校验；完成一项即更新能力与限制，再进入下一项。自动缩放、竖排、RTL、复杂 run 装饰和固定文字框体不随基础列表契约自动变为已支持。

继续采用参考项目的分层原则：PPT Master 的来源事实／模板职责边界用于决定字段所有权；Slidev/qiulishang 的捕获、归一化、写入、审计分离用于控制改动范围；pptx-renderer 的继承和可见性规则用于补充反例；open-kimi-ppt/Gamma 的导入意图用于用户流程。每个切片同时保留旧契约回归、真实产物证据和当前限制，不因例外批准提升能力等级。

### R1.2：显式例外的实现约束

当前已实现单个文稿问题的申请、记录、分阶段使用和撤销，并保留以下约束。批量批准和导入目录级例外尚未提供，不把文稿例外复用于主题安装。

- 协议：保存 exception ID、deck ID/revision、theme/rule/master/profile 摘要、规则 ID、具体问题身份（code/status/页面与 locator）、适用阶段、原因、用户操作时间和撤销状态。原始 severity/status 不改写，报告只附加应用了哪条例外。
- Gateway：服务器重新取得当前证据再接受例外，不能只信任客户端提交的问题；按文稿串行追加和撤销记录，保留历史。绑定任一输入变化后例外失效。导出入队冻结有效例外与规则文档，重试和重启继续检查相同绑定。
- 发布门禁：仅显式匹配的问题可免于规则阻断；导出前例外不会自动授权回读阶段。损坏 ZIP／关系、正文或数据缺失等产物完整性错误不可免除。视觉未验证问题即使获准交付仍标为 unverified。
- Web：在具体问题旁填写原因、确认适用范围和撤销；展示过期状态。不能以“确认导出”或选择 fast 策略隐式批准规则例外。导入目录审批与文稿例外使用不同作用域，不跨主题复用。
- 验收：覆盖文稿／主题／规则／母版／profile 每一绑定变更、换页序、不同阶段、伪造问题、撤销、并发追加、重启、重试及缺失内容不可绕过；至少一条真实导出与浏览器申请流程。

### 当前已交付与下一切片（2026-10-09）

项目符号的首行占用、非负缩进和左／中／右／两端对齐已完成浏览器、捕获、来源生成和原生回读。标记 advance 与源 indent 决定首行占用，普通 inline 空探针对齐基线；源字符、缩进、标记类型与字号保持原样。超宽前缀、RTL 和非左对齐段落的 Tab 仍未放开。详见[46 页实际产物证据](../validation/bullets-compatibility.md)：29 吻合、15 已知差异、2 仅观察；原生基线不作匹配声明。

本次继续采用 Slidev／qiulishang 的捕获与写入分层，PPT Master 的来源属性所有权边界；pptx-renderer 的标记、字体、大小、颜色分离用于组织实现，其额外空格和 inline-block 假设由独立反例检验。参考源码不是应用支持证明。模板规则仍应核对实际产物及其摘要，不因浏览器通过或例外获批而提高能力等级。

接下来按以下可审查切片执行：

1. **源 run 单下划线／单删除线**：扩展 NativeCharacterStyle、IR/MCP 校验及来源投影，独立保存缺省和显式 none；同步 Vue、显式框体捕获、固定文字的统一样式、布局继承移除规则和原生 writer。验收母版 → 布局 → 页／run 的逐级覆盖、局部取消、软换行／段尾隔离、跨脚本／链接及真实回读。双线、波浪线、独立下划线颜色等继续定位 partial，不用单线冒充。
2. **剩余文字属性**：字距先按可缩放的明确单位贯通；基线偏移、kerning 阈值、大小写、RTL 和复杂 body 分别建立浏览器及应用探针，逐项解除捕获边界。无法表达的属性继续携带源 XML、part/shape/run 定位。
3. **动态字段与媒体**：按 T2.2 的顺序处理日期／页脚／页码及可见性，再处理图片／裁剪／背景／线条；保留动态字段与缓存文本的区别、资源关系和继承来源。
4. **实际渲染门禁与完整验收**：把 renderer 版本、真实 PPTX SHA-256、页序、字体和可重放测量接入机器规则；失败／过期结果不沿用浏览器证据。固化五组黄金产物，再录入 PowerPoint/WPS/Keynote 的打开、编辑、播放、保存、重开结果。

每个切片独立跑相关单元、真实回读、浏览器／独立主题和打包冒烟；共用契约变化时跑全仓类型检查。只有实际证据覆盖到的能力才能更新状态，未知和已知差异继续显式报告。


### 2026-10-09：单线装饰切片验收与下一项

源单下划线／单删除线已完成上述第 1 项的链路：独立 true/false/缺省、逐级和作者子树覆盖、统一固定文字、IR／MCP、Vue 叶节点、段落与 BR 默认元数据、布局声明所有权、真实导出与再次分析。软换行单独写入装饰属性；仅有一个可编辑文本框，不用线条形状模拟。复杂线型与自定义 uLn/uFill 保持 partial。普通混排文字保留同一来源 run，显式框体保留多段、链接、Tab 与空段。

新增[12 页应用证据](../validation/decorations-compatibility.md)，核对线条种类、水平范围、正文色及基线相对侧，全部吻合；浏览器像素等价仍 unverified。参考 pptx-renderer 的逐属性继承，但不采用将任意非 none 线型压平成布尔值的行为；局部取消由实际文字叶节点实现。来源到页面的规则所有权继续沿用 PPT Master 的边界，捕获与原生写入继续分层。

下一实施项是字距：来源 spc 的单位为百分之一点，契约使用显式点值并随画布缩放；缺省、零、负值需分别保留。先明确可接受的有限值范围和字体／缩放行为，再同步九级样式、固定文字、IR／MCP、Vue 与捕获、布局继承、原生输出和真实回读。增加混排、跨 run、链接、Tab／折行及零值取消反例；应用探针确认字符 advance 与折行，不以浏览器 CSS 成功替代应用结果。字距通过后再依序处理基线偏移、kerning 阈值、大小写、RTL 和复杂 body，各自保持独立契约及证据。

其后仍为动态日期／页脚／页码与可见性 → 图片／裁剪／背景／线条 → 实际 PPTX 哈希绑定的规则渲染门禁 → 五组黄金产物 → PowerPoint/WPS/Keynote 编辑、播放、保存和重开矩阵。全量目标保持进行中。


### 2026-10-09：字距切片验收与下一项

已完成 `letterSpacing` 的明确点值、缺省／零／负值、九级样式、统一固定文字、IR／MCP、源 Vue、捕获、布局声明所有权及原生回读。画布缩放沿横向字体比例；XML 按 0.01pt 写入。底层 writer 的零值省略已通过逐 run 属性恢复修复，未声明的原生调用仍继承；软换行单独保存字符字距，段尾／空段使用段落默认。非法来源继续附带定位损失，不能注册为完整候选。

[18 页实际应用探针](../validation/letter-spacing-compatibility.md)中 15 项吻合、3 项中英混排已知差异，零未预期差异。脚本边界额外间隔在所请求字体已安装时仍存在，报告分别保存独立预期和实际观察；导出正文与模板保留兼容提示。参考 pptx-renderer 的单位与继承拆分，未复用 WordArt 竖排补偿。报告尚未接入实际文件的规则渲染门禁。

下一项为基线偏移，按以下顺序交付：先以源 baseline 的相对字号比例、零值与来源为事实，独立测量浏览器和目标应用的字形大小、基线位置及行框变化，明确哪些组合可由同一契约表达；再扩展原生／IR／MCP、九级与固定文字、Vue／捕获、布局所有权、run／BR／段尾写入和真实回读。覆盖正负偏移、零值取消、混排／链接／装饰／字距、空段、软换行、Tab／折行、缩放和编辑。不能用固定上下标字号或 CSS vertical-align 的默认缩字替代源比例；无法表示或未测量的组合保留定位 partial。

基线通过后继续 kerning 阈值与大小写，再处理 RTL／复杂 body；动态字段、媒体、实际产物绑定的渲染规则、五组黄金样例和多应用编辑矩阵仍在完整范围内，全量目标保持进行中。


### 2026-10-09：基线切片验收与下一项

`baselinePercent` 已完成来源 → 九级／固定文字／IR／MCP → Vue／捕获 → 原生／真实回读。正负值、零清除、缺省和来源分别保留；比例不缩放，原生字号不改小。投影只移动文字叶节点，普通文字保持原 run，直接叶节点恢复名义坐标；制表换行判定去掉偏移，真实边界仍保留。BR、空段和段尾分别写入默认，BR 的局部字号同时保留。对错误 CSS／元数据以及旋转或非等比非零偏移明确阻断。

[23 页实际应用报告](../validation/baseline-compatibility.md)记录 2 吻合、21 已知差异、0 未预期；非零字号缩至约 58%，小数比例被截断，部分首行位置改变。参考项目 pptx-renderer 按 20% 阈值缩至 65% 的实现没有采用。源契约、浏览器模型和应用观察分开记录，不由原生属性保留推出跨应用视觉一致。完整浏览器 23/23，独立生成主题包含第六页基线，单元／类型／打包链路已验证。

下一实施项按以下顺序进行：

1. **Kerning 的来源与边界探针**：保留 kern 的百分之一点、独立缺省和零阈值，检查低于／等于／高于阈值的比例字体字对，以及字号缩放、字体替换、显式字距并用的实际结果。参考 pptx-renderer 的阈值到 font-kerning 映射，但不以 CSS normal 开启就认定应用一致；阈值零并不表示关闭。输出应同时保留阈值和实际字号，不把浏览器是否启用反推成源事实。
2. **贯通契约与所有权**：扩展原生／IR／MCP、源布局与固定文字、叶节点 CSS／捕获、run／BR／段尾及布局绑定。验证缩放后的阈值单位、零值恢复、逐级覆盖和真实读回；不支持的字体特征继续定位 partial。
3. **大小写显示语义**：分别处理 cap=none/all/small；保留原始可编辑字符串与显示模式。现有 capture 的 applyTextTransform 会改变字串，需先建立保留源文本的受校验路径；小型大写还必须区分真实字体特征与浏览器合成效果。覆盖混排、链接、字符字距、基线与编辑后重新测量，未验证组合不提升支持等级。
4. **后续全量路线**：RTL／复杂 body → 动态日期／页码／页脚及可见性 → 图片／裁剪／背景／线条 → 实际文件 SHA-256 绑定的独立渲染规则 → 五组黄金产物 → PowerPoint／WPS／Keynote 编辑、播放、保存及重开矩阵。

规则门禁继续按阶段消费真实证据，源分析、浏览器校验和目标应用报告不能互相替代；全量开发仍在进行中。


### 2026-10-09：Kerning 切片验收与下一项

`kerningThreshold` 已贯通来源 → 九级／固定文字／IR／MCP → 源 Vue 与独立运行时 → 捕获 → 原生／真实回读。源 kern 以百分之一点解码，缺省与零分开；字号和阈值一起缩放，零始终启用。浏览器按实际字号重算，固定文字和 MCP 布局也使用同源逻辑；捕获拒绝冲突 CSS／字体特征、未建模的拉伸／可变轴与缺失阈值的关闭状态。run、BR、段落默认和段尾独立写入，布局策略只移除自己声明的 kern。Canvas 关闭 kerning 时的字体简写与宽度测量已修复。

[20 页应用报告](../validation/kerning-compatibility.md)保留 10 吻合、9 已知差异和 1 缺失字体观察。预期从安装字体的 advance／kern 表独立计算，实际文件未经改写；低于字号阈值的样例仍被 LibreOffice 启用 kerning，因此导出附加兼容提示。完整浏览器 24/24、最新阈值／独立主题 2/2、全仓类型 26/26 通过，原生回读和打包运行时已验证。跨应用像素等价与实际文件规则门禁仍未完成。

下一项聚焦大小写显示语义，按以下顺序推进：

1. 保留 cap 的 none/all/small、独立继承与显式清除，分析 Unicode 大写展开（如 ß）、不同语言及混排。源文本与显示文字分开，不能用浏览器转换后的字符串替换可编辑原文。
2. 为大写与小型大写建立浏览器及实际应用探针。小型大写必须区分真实字体特征、浏览器合成和目标应用缩放；先选已安装字体验证，再记录替换字体／缺失字形的限制。
3. 接通 NativeCharacterStyle／IR／MCP、源投影、九级／固定文字、Vue 叶节点及受校验的原文捕获；调整现有 applyTextTransform 路径，使源 cap 保留原字串。再接原生 run／BR／段尾和布局所有权，覆盖链接、Tab、自动折行、kerning／字距／基线组合、编辑与缩放。
4. 真实 PPTX 再分析应同时读回原文字串、cap 值与来源。没有足够字体／应用证据的组合继续定位 partial；随后依序进行 RTL／复杂 body、动态字段、媒体、实际 PPTX 渲染规则、五组黄金产物和多应用矩阵。

全量目标保持进行中，不用已完成文字属性替代后续门禁和应用验收。


### 2026-10-09：大小写切片验收与下一项

`capitalization` 已贯通来源 → 原生／九级／固定文字／IR／MCP → 源 Vue → 捕获 → 实际导出／回读。none/all/small、缺省、局部取消与来源独立保存；原文和显示模式分开，Unicode 展开不替换可编辑字符串。普通脚本组、显式多段框、空段、BR、链接、Tab／自动折行、字距／基线／kerning、编辑和缩放均有回归；固定文字采用实测 DOM 宽度。继承所有权只移除声明的 cap，非法或显示不一致的源状态定位阻断。相关字体保留完整字形与可变字体字重实例，避免原文子集遗漏显示字形。

[36 页报告](../validation/capitalization-compatibility.md)保留 14 显示文字匹配、6 映射差异、10 small 显示为 full capitals、6 仅观察，所有原文保留。Chrome 普通 CSS 参考页用于确定大小写和字体合成语义，不冒充 FastPPT 捕获或跨应用像素证据；独立工程 E2E 已验证生成主题。相关单元 387、脚本 9、完整浏览器 25/25、全仓类型 26/26、相关 lint 和两包构建／打包冒烟通过。

下一项按以下边界推进：

1. **先拆开方向事实**：分别读取 pPr@rtl、bodyPr@rtlCol／vert／vertOverflow／columns 等来源，不从语言或阿拉伯字形推断段落方向；保留逻辑原文、显式 false 与继承。参考 pptx-renderer 的属性拆分和 Slidev 的捕获／归一化／写入分层，不复制简单反转字符串或交换所有左右值的实现。
2. **先做方向与成形探针**：至少覆盖阿拉伯语／希伯来语、Latin／数字／标点混排、语言与方向不一致、左右／居中对齐、正负首行缩进、链接、BR／空段与双向控制字符。记录原始逻辑序列、浏览器 DOM Range 的视觉区域、字体成形和应用字形顺序；PDF 文本抽取顺序不等同于源顺序。先限定普通无标记段落，再单独测量 RTL 标记／Tab。
3. **贯通一项再开放一项**：扩展原生与 IR／MCP、独立段落级方向、Vue、受校验原文捕获、布局绑定与回读。显式文字框当前 LTR 门禁只有在探针与端到端测试通过后才解除；不要先删除方向检查。RTL 的左右 margin、indent、物理 align、标记侧和 Tab 停止点各自建模，未知组合继续 partial。
4. **复杂 body 与其后范围**：竖排／分栏／溢出／自动缩放逐项建立契约和应用证据；随后继续动态日期／页码／页脚及可见性 → 图片／裁剪／背景／线条 → 实际输出 SHA-256 绑定的规则渲染门禁 → 五组黄金产物 → PowerPoint／WPS／Keynote 新建页、切换布局、编辑、播放、保存及重开矩阵。

规则门禁继续使用对应阶段的真实证据：源分析、Chrome 参考、工程捕获和目标应用结果不能互相替代。全量开发仍在进行中。
