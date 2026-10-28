# WHU Teaching 视觉规则

## 依据与边界

参考 `ppts/第三章 数据的运算和运算部件_新版.pptx`（82 页，16:9）。本主题是可复用教学设计系统，并非 82 页课件的逐页转换。源课件所有页均已通过缩略图检查，重点复核第 1、2、3、6、11、30 页。章节过渡和思考题容器是沿用源配色的扩展版式，不声称来自原生 PPT 母版。

## 视觉语言

- 1280×720；正文页左/右边距 48px，标题顶边 66px，页脚为底边 36px 高色条。
- 主色 **#00523A**：标题、重点、表头、目录侧栏。**#00A98F** 只用于短线、步骤编号等强调。
- 正文 **#20322D**；辅助文字 **#63736D**；分隔线 **#C8D7D1**；浅底 **#F2F7F4**；背景白。
- **#C79B45** 仅用于封面短线、问题提示，不用作大面积正文底。
- 微软雅黑优先，Noto Sans SC 本地回退，英文 Arial/无衬线；代码 Fira Code。禁止把中文标题切换到衬线字体。
- 正文标题 42px、正文 24px、二级标题 27px、表格 21px、注释至少 17px；页码 14px。封面标题 56px、两行以内。
- 未启用章节导航时，标题短横条位于左上；启用时改用顶部章节条。细线与留白分组。避免阴影、装饰卡片网格、过度圆角和大面积渐变（封面除外）。

## 内容与版式

- 教学页允许主题名、问题式或结论式标题；每页集中讲清一个知识点。
- `default` 单栏；`two-cols` 为默认 slot 的通栏标题以及 `left`/`right` 两栏。
- `agenda` 默认 slot 标题，`left`/`right` 目录内容；`label` 默认“主要内容”。
- `diagram` 默认 slot 标题，`figure` 图示，`notes` 讲解，`caption` 简短图注。
- `example` 默认 slot 标题，`work` 表格/计算过程，`explanation` 解释。
- `exercise` 默认 slot 标题，`question` 问题，`answer` 分析；答案默认可见，需要分步揭示时由作者使用 `v-click`。
- `cover` 复用源照片与白色标识，支持 `background`、`logo`、`showLogo: false`。正文标题使用真实文本，不能整页截图。
- `section` 使用 `chapter` 标记讲次；`end` 用于课程总结，不强制感谢页。
- 页码自动以 `01 / 09` 显示，使用页内上下文，在概览/导出中保持各页编号；`pageNumber: false` 可关闭，`footer` 可补充来源。

## 可编辑内容与质量

- 表格使用 Markdown/HTML；流程和电路示意采用 HTML 节点与独立文字；不能把需要编辑的表格和文字放进背景图。
- `WhuCallout`（title、kind=note/question）强调知识点；`WhuStep`（number、title）用于计算步骤。
- 双栏建议各 3–5 条要点；例题表格建议不超过 8 行。内容放不下时拆页，不能裁切或缩到不可读。
- 必须检查字体加载、标题换行、内容互相遮挡、页脚碰撞与资源路径。示例覆盖全部 12 个版式。
- 自动提取的 native-layouts.json 为空；不存在可选的 source-* 原生布局。

## 0.2：参考 Academy 的样式升级

- 顶部深绿章节条，当前章节以金线强调；正文通栏标题与细分隔线；底部深绿课程页脚。校园封面保留原有构图。
- 全局 `courseTitle`、`presenterName` 显示课程和主讲信息。旧版字符串 `footer` 继续作为本页页脚标签；`footer: false` 或 `pageNumber: false` 隐藏整个页脚，`footerMode: minimal` 仅显示页码。
- 章节入口为 `layout: section` 或 `sectionStart: true`，使用 `sectionLabel` 设置短标签。`toc` 自动汇总这些入口；导航和目录可点击跳转，按本页上下文判断当前章节。建议 2–6 个短标签；过多章节用 `sectionBarMode: minimal`。`sectionBar: false` 隐藏正文导航。
- `content` 是 `default` 别名；`split` 是 `two-cols` 别名，旧槽位不变。双栏使用 `ratio: '3:2'`、`gap: sm | md | lg`，非法比例回退到 1:1。
- 正文密度：normal 24px、compact 22px、dense 20px；表格分别为 21/20/19px。`lineHeight` 支持 1–2.4；`flowGap` 为 none/tight/normal/loose 或非负 px/rem/em 长度，控制单栏及双栏顶层内容间距。这些选项可设全局并在单页覆盖。
- 三线式学术表格替换原深绿表头：浅绿表头、深绿顶/底线，保留轻量交替行。
- `WhuBlock title` 是带嵌入式标题的定义框；`WhuNote title` 是细线标题说明；`WhuTakeaway` 突出一条核心结论。允许克制的 6px 圆角，不使用投影或装饰性卡片。
- `WhuFigure`：src/alt/caption/credit/number；省略 src 时接受 HTML 图示槽位。`WhuTable`：caption/credit/number 包裹原生表格。编号由作者显式提供，不自动计数。`WhuCitation` 为流式来源标注，保留底部留白。
- 这次升级只借鉴 Academy 的视觉层次与核心教学交互，不引入完整 Academy 组件接口或其外部图表/公式依赖。
