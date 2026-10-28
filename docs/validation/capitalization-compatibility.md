# 大小写显示模式：原文、字体与应用差异

2026-10-09。[36 页报告](capitalization-libreoffice-7.3.7.2.json)来自实际原生导出，原文字串全部保留。14 页显示文字匹配、6 页大小写映射差异、10 页 `small` 被渲染为与 `all` 相同的全高大写、6 页仅观察，零未预期差异。显示文字匹配不等于字体、行框或像素一致。

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/capitalization-compatibility.ts /tmp/fastppt-capitalization-compatibility
```

需要 LibreOffice 7.3.7.2、系统 Python UNO、fontconfig、Liberation Serif、EB Garamond 12、`python3` 的 fontTools/PyMuPDF 和 `/usr/bin/google-chrome`。本次 Chrome 版本、字体文件、应用配置、实际 PPTX、两份 PDF、字形 JSON 与复现脚本摘要均在报告中。本机产物位于 `.fastppt/validation/capitalization/`；共享 LibreOffice 探针未改动。正式生产器先经真实 writer 导出，再只读检查 XML 与应用导入的原文，不用修改过的 XML 作为原生导出证据。

| 情形 | 实际观察 |
| --- | --- |
| 普通 Latin，`none/all` | 原文分别显示为原样或全大写，字号保留 |
| 德语 `Straße`，`all` | Chrome 显示 `STRASSE`，LibreOffice 显示 `STRAẞE` |
| 土耳其语 `i ı I İ`，`all` | 声明 `tr-TR` 后，两者显示 `İ I I İ` |
| 希腊语 `άδικος`，`all` | Chrome 去掉重音，LibreOffice 保留首字母重音 |
| 连字 `ﬃ`，`all` | Chrome 展开为 `FFI`，LibreOffice 仅显示 `F`；已检查 PDF 图像，不能只用 PDF 文本抽取推断 |
| `small`，Liberation Serif | Chrome 使用合成小型大写，测试小写字形约 14.25pt；LibreOffice 与同页内容的 `all` 控制样例同字号、同字形位置 |
| `small`，EB Garamond 12 | 字体含 `smcp`；Chrome 使用字体特征，PDF 中仍为约 20pt 声明字号但字形较小；LibreOffice 仍与 `all` 控制相同 |
| 中文混排、缺失字体、缺失源字形、`small` 软换行 | 保留原文并记录字形／替换字体，仅观察，不升级为视觉兼容 |

Chrome 对照是独立生成的普通 CSS 页面：`all` 使用 `text-transform:uppercase`，`small` 使用 `font-variant-caps:small-caps`，`none` 显式清除二者。它绕过 FastPPT 捕获，仅用于确定浏览器语义。每页同时记录 `textContent`、`innerText`、实测宽度与 PDF 字形；小型大写的 PDF 文本可能仍是小写 Unicode，不能把它当作字形外观或 PPTX 原文回读。

字体特征来自实际 fontTools GSUB 表。对基本 Latin 控制样例关闭字体合成后，Liberation Serif 的宽度变化，EB Garamond 12 的宽度保持不变；结合 PDF 字号和图像区分合成与真实字体特征。此结论不外推到所有脚本和字形。LibreOffice 的 `small` 与 `all` 比较逐字检查内容、字体、字号和原点，容差 0.05pt。报告的离线回归重新检查以上关系及脚本摘要，不把已知应用行为改写成源规则。

工程契约使用 `capitalization: 'none' | 'all' | 'small'`，缺省继承，`none` 明确清除，字号缩放不改变显示模式。原生段落默认、run、软换行、段尾、九级样式及固定文字保存独立的 `cap`；布局策略只移除对应级别声明的属性。作者可在源模板中用 `data-fastppt-capitalization="none"` 覆盖。生成叶节点携带显示模式，捕获核验 CSS 后保留原文字串；原生导出不调用大小写转换。

源文字的实际显示宽度来自 DOM，避免用未经语言处理的 Canvas 字串估算 `ß → SS`。跨行展开到多个行框的单个字素须使用显式文字框；普通源 run 不静默丢弃第二行。额外字体特征、合成模式覆写、非法模式、CSS 不一致及缺失原文契约会阻断；主题插件不得替换该路径的原文。Tab 和自动折行仍以原始 UTF-16 字符范围记录，保持可编辑原文。

字体嵌入保留相关 face 的完整字形，防止按原文裁剪后丢失大写展开或 `smcp` 字形。可变字体仍实例化声明字重，保留全部 Unicode 映射与替换字形；原有大小预算和字体失败报告继续生效，因此文件可能更大。`none` 或未声明模式继续使用原有子集策略。

源模板／MCP、普通混排、固定文字和显式文字框有独立浏览器回归，实际 writer 回读验证原文与属性。正文／模板中的 `all/small` 附带 `text-capitalization-compatibility`，对象报告保留原因。这些证据尚未建立浏览器与 PowerPoint／WPS／Keynote 的像素一致性，也未完成实际 PPTX 文件绑定的规则渲染门禁。

参考 `pptx-renderer@2e8cd2222a889451bc872df50941f927cc79c7a2` 的 `cap` 到 CSS 映射；额外保留原文、逐级来源、受校验捕获和独立应用报告。没有采用把显示后的大写字串写回原文的做法。
