# 制表位的独立回渲染证据

2026-10-09，使用 **LibreOffice 7.3.7.2 30(Build:2)** 导出 PDF，再用 `pdftotext -bbox-layout` 提取文字及位置。源码、PPTX 和 PDF 的 SHA-256、渲染器版本、逐页期望与观测保存在 [JSON 报告](tabs-libreoffice-7.3.7.2.json)。报告允许 0.25 点的位置误差；文字内容或数量不符仍失败。

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/tabs-compatibility.ts .fastppt/validation/tabs
```

脚本需要 LibreOffice、Poppler 的 pdftotext 和 Python 3。每次执行先删除旧产物和报告，避免转换失败时使用上轮 PDF。测试输入固定使用 Liberation Mono、20 点字号；实际导出画布为 13.333 英寸，不能把默认导出误当作 10 英寸。输出保存在指定目录，本机路径为 `.fastppt/validation/tabs/`。

## 结果和范围

| 证据 | 页数 | 位置吻合 | 已知差异 | 未预期差异 |
| --- | ---: | ---: | ---: | ---: |
| 实际原生导出 `tabs-native.pptx` | 33 | 7 | 26 | 0 |
| 移除 indent 的 XML 诊断副本 | 33 | 27 | 6 | 0 |

实际导出覆盖默认间距、左右边界、正负首行缩进、连续 Tab、显式制表位、自定义和零默认间距、布局继承和空列表清除；另有居中／右／小数点对齐的原生契约探针。居中／右停止点已有独立浏览器测试；小数点停止点尚未完成分隔符约定，不能因 XML 能写入而声明支持。

已知差异如下：

- 实际导出保留显式 `indent`，包括零值。此 LibreOffice 版本会重置显式／继承制表位，实际产物的显式停止点案例因此使用默认间距。移除 indent 后，显式左／居中／右／小数点位置可对照预期；该副本只用于隔离原因，生产导出不删除来源缩进。
- 自定义 `defTabSz` 在两个版本中都被忽略；72 点以外的默认间距仍需目标应用复核。
- 诊断副本中，`<a:tabLst/>` 未清除继承的停止点。实际导出中的此页因 indent 已经重置停止点而碰巧吻合，因此不能由这一页推断空列表继承正确。

独立期望以段落左边距为原点。负首行缩进的光标仍在左边距之前时，下一个默认停止点为零；不是负默认网格。居中／右／小数点探针使用等宽字符：停止点位于页面 x=190 点，`BB` 分别从 x=178／166 开始，`12.34` 从 x=166 开始，点号左边缘位于 x=190。参考渲染器将半个点号宽度加入偏移的做法未被此证据支持，下一切片不能直接照搬。

浏览器另行验证左对齐段落中的 left/center/right 停止点、LTR、跨 run／中文混排、连续 Tab、br 与文本内软换行、编辑、画布缩放、负缩进及长字段；自动折行、无测量或篡改的停止点、零默认间距后无可用停止点会阻断显式文本框导出。FastPPT 宿主和生成主题的独立 Slidev 启动均验证过编译前保留 Tab，正文导出仍为真正 Tab 字符和一个原生形状。

扩展样例为居中／右停止点分别增加多停止点、空字段、软换行、默认停止点、跨 run、零默认间距和长字段。不能在停止点之前容纳完整字段时，诊断副本显示 Tab 间隔压到零，字段紧跟前文；没有跳到后面的默认网格。长字段的文本、起止位置都检查，避免 pdftotext 将相邻 run 合并成一个 word 后漏验。默认停止点保持左对齐，显式软换行重新从本行选取停止点。

报告另保存德语／法语各一组句点／逗号探针。实际 run 中的 `lang="de-DE"`／`lang="fr-FR"` 已在 ZIP 中确认；诊断副本仍按句点对齐。报告中的语言期望只是对相应常见数字约定的探针，带 expectationNote，不作为 OOXML 必须行为或应用支持结论。由此不能直接把 Intl.NumberFormat 的结果套到原生 decimal Tab；需要独立的来源／目标应用分隔符约定。当前浏览器仍阻断 decimal。

初版证据包含 15 页实际产物和 15 页诊断副本；本次保留全部案例并扩展为 33 页，JSON 报告记录当前脚本和产物摘要。

导出产生对象级 `text-tab-compatibility` 提示。以上证据仅覆盖该版本 LibreOffice 的 PDF 位置；没有完成规则发布门禁的渲染证据接入，也不能替代 PowerPoint、WPS、Keynote 的打开、编辑、保存及重开验收。

## 参考依据

- [Microsoft DrawingML TabStop](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.tabstop?view=openxml-3.0.1)：停止点相对于左边距，按位置递增使用。
- [LibreOffice 7.3.7.2 的段落属性应用](https://github.com/LibreOffice/core/blob/libreoffice-7.3.7.2/oox/source/drawingml/textparagraphproperties.cxx#L472)：设置首行缩进时重置 TabStops。
- [LibreOffice 7.3.7.2 的段落解析](https://github.com/LibreOffice/core/blob/libreoffice-7.3.7.2/oox/source/drawingml/textparagraphpropertiescontext.cxx#L97)：该版本未实现每对象默认制表间距。源码仅用于解释观测，没有复制进工程。
- `pptx-renderer@2e8cd2222a889451bc872df50941f927cc79c7a2`（Apache-2.0）的 `TextRenderer.ts` 提供段落测量职责参考；其默认网格、连续停止点容差和小数点偏移不能充当兼容规范。


后续已新增[显式应用区域设置探针](decimal-compatibility.md)：隔离 en-US／de-DE／fr-FR 配置并通过 UNO 回读，证明系统区域设置会改变实际 decimal 对齐字符。旧报告没有锁定或验证该设置，不能把旧 run 语言探针外推为“所有区域设置都使用句点”。实际产物与诊断副本仍分别记账。


后续已完成显式 decimal 声明和制表自动折行，当前实现及独立应用限制分别见[小数点契约](decimal-compatibility.md)与[文字流验证](text-flow-compatibility.md)。上述 33 页旧探针及当时限制保留为历史证据；当前自动行使用稳定迭代与行级捕获，仍不转换成原生硬换行。
