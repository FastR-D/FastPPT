# WHU Teaching · 武大教学

参考项目内 `ppts/第三章 数据的运算和运算部件_新版.pptx` 构建的 FastPPT / Slidev 教学主题。保留校园封面、深绿标题、青绿短线、白底双栏、学术表格和课程页脚；内容保持为 Markdown/Vue。

## 使用

在 FastPPT 主题选择器中选择 **WHU Teaching · 武大教学**（ID：`slidev-theme-whu-teaching`）。项目通过 `themes/*/agent/theme-manifest.json` 自动发现主题，无需修改注册表代码。

```markdown
---
theme: slidev-theme-whu-teaching
layout: two-cols
---
# 数据的运算

::left::

## 算术运算

加、减、乘、除。

::right::

## 逻辑运算

与、或、非及移位。
```

| 布局 | 默认内容 | 命名槽位 / 属性 |
| --- | --- | --- |
| cover | 封面标题、课程信息 | background、logo、showLogo |
| agenda | 标题 | left、right；label |
| default | 单栏正文 | 无 |
| two-cols | 标题、简短引导 | left、right |
| diagram | 标题 | figure、notes；caption |
| example | 标题 | work、explanation |
| exercise | 标题 | question、answer；questionLabel、answerLabel |
| section | 章节标题、说明 | chapter |
| end | 小结与后续学习 | 无 |
| content | 学术正文（default 别名） | density、lineHeight、flowGap |
| split | 可调双栏（two-cols 别名） | left、right；ratio、gap |
| toc | 自动课程目录 | section / sectionStart 自动生成 |

`footer` 设置页脚文字；`pageNumber: false` 关闭页脚。`WhuCallout` 支持 `title` 和 `kind="question"`；`WhuStep` 支持 `number` 和 `title`。详细规范见 `agent/theme-rules.md`。

## 示例与验证

`example.md` 展示全部 12 个布局，可在主题目录中通过 Slidev 打开：

```bash
# 从仓库根目录运行
node packages/slidev-host/node_modules/@slidev/cli/bin/slidev.mjs themes/slidev-theme-whu-teaching/example.md --theme "$(pwd)/themes/slidev-theme-whu-teaching"
node scripts/theme-smoke.mjs themes/slidev-theme-whu-teaching
node scripts/theme-build.mjs themes/slidev-theme-whu-teaching
```

源码使用微软雅黑，未安装时使用项目内 Noto Sans SC；不分发微软雅黑字体。照片和标识从用户提供的 PPTX 原样提取，来源见 `THIRD_PARTY_NOTICES.md`。本主题不复刻整份 82 页课件，也不包含该课件的完整原生母版。

## 0.2 Academy 风格升级

新增章节导航、自动目录、深绿课程页脚、三档正文密度、可调比例双栏，以及定义/说明/结论/图表/引用组件。原有 9 个版式与命名槽位继续有效；增加 `content`、`split`、`toc` 三个版式。

```yaml
# 首张幻灯片的全局配置
courseTitle: 计算机组成原理
presenterName: 主讲人
sectionBar: true
# 可选全局正文参数，也可在单页覆盖
density: normal
lineHeight: 1.55
flowGap: normal
```

在章节首页设置 `sectionStart: true` 和 `sectionLabel: 定点数运算`，或使用 `section` 布局，便可生成导航与 `toc`。双栏设置 `ratio: '3:2'`、`gap: lg`；密度可选 normal/compact/dense。组件 API 和关闭导航/页脚的方法见 `agent/theme-rules.md`。此版本不包含 Academy 的自动图表编号、Typst 或 Plotly 组件。
