# 字距：原生字符位置与折行证据

2026-10-09。[可重放报告](letter-spacing-libreoffice-7.3.7.2.json)包含 18 页实际原生导出：15 页吻合、3 页中英混排已知差异、0 页未预期差异。报告记录原始 PDF 字符、起点、基线、字体、字号和行归属；浏览器像素等价仍为 `unverified`。

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/letter-spacing-compatibility.ts /tmp/fastppt-letter-spacing-compatibility
```

需要 LibreOffice 7.3.7.2、系统 Python UNO、Poppler、Liberation Mono、Noto Sans CJK JP，以及 `python3` 可加载的 PyMuPDF。本轮使用 PyMuPDF 1.28.2；产物保存在仓库 `.fastppt/validation/letter-spacing/`。每次使用独立只读应用配置，校验实际版本与 en-US 系统区域设置。报告绑定真实 PPTX、PDF、字符 JSON、初始配置和两个复现脚本的 SHA-256，没有修改缩进、正文或框体的诊断副本。

打开前检查唯一内容 shape、唯一段落和原始字符，逐字符核对原生 `spc`，包括 Tab、作者软换行及显式零值；段落默认与段尾另行核对。原文从 UNO 读回。PDF 使用 `TEXT_INHIBIT_SPACES` 禁止分析器根据字距虚构空格，真正的源空格仍保留。

独立预期使用 20pt Liberation Mono，基础 advance 为 12pt；CJK 使用 20pt 全角 advance。各字符加上自己的字距，行距为 30pt，框起点为 40pt。预设行序列不调用浏览器求解器。位置容差 0.25pt，字号容差 0.05pt；PDF 字体名称也逐字符比较。

| 样例 | 页数 | 结果 |
| --- | ---: | --- |
| -2／0／2／1.25／-0.75pt 字距 | 5 | 字符起点吻合，显式零值取消段落的 2pt 默认 |
| 多个 run 的 2 → 0 → -2pt | 1 | run 边界与字符起点吻合 |
| 连续空格、Tab、软换行 | 3 | 原文保留，间距与行归属吻合；Tab 的其他兼容限制仍见制表报告 |
| 100pt 框中的 -2／0／2pt | 3 | 负字距首行容纳两词，零／正字距分别占三行 |
| 55pt 框中的长词与 2pt 字距 | 1 | 每行 3／3／2 字符；原生没有添加自动换行 |
| Latin/CJK 混排的 -2／0／2pt | 3 | 已知差异：应用在脚本边界加入额外间隔；所请求字体正确，不能归因于字体替换 |
| 空段默认、连续软换行 | 2 | 空行没有虚构字符；文字行和默认值保留 |

混排预期和实际观察分别保存在 `source.expected`／`source.known`，不能用已知值覆盖预期。例如 2pt 案例的首个汉字预期 X=96pt，实际约 100.8pt；后续 Latin 预期 X=140pt，实际约 149.7pt。0pt 与负值也观察到脚本边界间隔；应用行为不由字符字距一个属性决定。探索阶段使用未安装的 Noto Serif SC 还出现字体替换，正式报告改用已安装字体隔离此因素。

`textStyle.letterSpacing` 使用点值，缺省继承、零清除，可为负数；原生字段为 DrawingML `rPr@spc` 的百分之一点，序列化按 0.01pt 取整。契约接受有限的 -4000 至 4000pt，缩放后仍须满足范围。该范围是数据契约，不代表极端字距仍能在给定框体内可读。九级默认值、统一固定文字和布局绑定均独立保留声明；固定文字和占位符按横向画布比例缩放。

源 Vue 用 cqw 表达模板字距；作者可用正常 CSS 覆盖，例如 `letter-spacing:0`，捕获保存实际 computed style。浏览器可能把零值返回为 `normal`，仍正确保存为零。段落、空段、软换行、普通混排文字和显式框体均有回归。底层写入器会省略零值，FastPPT 在逐 run 的语言恢复阶段同时恢复声明过的字距，避免零值意外继承布局；未声明的原生调用继续继承。BR 则单独写入其字符样式。

非零字距正文和原生模板导出附加 `text-letter-spacing-compatibility`，对象报告记录混排及折行的应用限制。该提示没有改写源字距，也不代表应用限制已解决。报告尚未接入实际 PPTX 渲染规则门禁，PowerPoint/WPS/Keynote 的编辑、播放、保存与重开仍未验收；比例字体的 kerning、基线和 RTL 也不由本报告推断通过。

参考 `pptx-renderer@2e8cd2222a889451bc872df50941f927cc79c7a2` 的 `letterSpacingPt` 换算与逐 run 继承。FastPPT 的画布缩放、零值恢复、软换行写入和应用差异由自身契约与真实产物验证；没有沿用其 WordArt 竖排的额外字距补偿。
