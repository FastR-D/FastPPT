# 小数点制表位：应用区域设置的独立证据

2026-10-09，LibreOffice **7.3.7.2 30(Build:2)**，分别使用独立的 en-US、de-DE、fr-FR 系统区域设置。可重放的 [JSON 报告](decimal-libreoffice-7.3.7.2.json) 保存应用配置、实际读回的区域设置、导入后的制表符属性、源／输出哈希及逐页文字位置。

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/decimal-compatibility.ts .fastppt/validation/decimal
```

需要 LibreOffice、支持 UNO 的 `/usr/bin/python3`、Python 3 和 Poppler 的 `pdftotext`。每次运行创建独立配置目录和随机 UNO 管道，完成后关闭该实例；不会连接用户现有的 Office 会话。PDF 导出前只读取段落属性，不修改导入文档。初始配置留档并计算哈希，请求值必须与 UNO 回读的实际值一致。

## 结果

| 系统区域设置 | UNO 实际小数字符 | 实际导出：吻合／已知差异 | 去除 indent 的诊断副本：吻合／已知差异 |
| --- | --- | --- | --- |
| en-US | `.` | 0／23 | 23／0 |
| de-DE | `,` | 0／23 | 23／0 |
| fr-FR | `,` | 0／23 | 23／0 |

总计 69 页实际产物与 69 页诊断副本，未预期差异为 0。实际产物在此 LibreOffice 版本中仍受显式 `indent=0` 重置制表位的已知问题影响：UNO 回读显示 LEFT 停止点，正文落在默认网格。诊断副本回读为 DECIMAL 停止点，使用对应系统区域设置的小数字符。诊断结果不能替代生产输出验收。

23 组固定输入覆盖句点、逗号、无分隔符、重复分隔符、首／尾分隔符、负数、货币前缀、非数字字段、两类千分位写法、独立 run 语言、跨 run、显式软换行、多个停止点、连续空字段、显式停止点之后的默认网格和过长字段。

独立几何期望固定使用 Liberation Mono 20pt；每个字符 12pt。停止点为页面 x=190pt 时：

- 英语配置下，`12.34` 从 x=166pt 开始，句点的左边缘位于停止点；德语／法语配置下它没有逗号，字段末尾位于停止点，从 x=130pt 开始。
- 德语／法语配置下，`12,34` 从 x=166pt 开始；英语配置下它从 x=130pt 开始。
- 多个分隔符采用首个匹配字符。没有匹配分隔符时采用字段末尾，包括完全非数字的文本。
- 一个字段可以跨多个 run，包含独立语言和空语言声明。脚本先检查实际 ZIP 中每个字符及 run 语言，再渲染，避免把写入器丢失语言的结果误读成应用行为。
- 字段过长时 Tab 间隔压到零，不跳到后续网格。相邻文字可能被 PDF 提取器合并，报告同时检查合并词的末端。

结论仅适用于上述应用版本和显式验证的配置。这里证明系统区域设置能改变实际 decimal 对齐字符；此前的语言探针只证明改变 run `lang` 不能单独达到这一点，两组结果并不矛盾。不得从浏览器 Intl、UI 语言或 run 语言代替应用配置取证。

## 来源与证据契约

`DecimalTabEvidenceV1` 将源分隔符声明与目标应用环境分别保存。原始 DrawingML 的 TabStop 没有分隔符属性，因此本组源 PPTX 的 `sourceConvention` 保持 `unknown`。目标应用使用了逗号，不表示源文件作者原本要求逗号。显式用户声明保存 `user-declared` 和原因，并由外层源 PPTX 哈希绑定。

分析器遇到 decimal 停止点时写入 `decimalTabConvention: { status: "unknown", reason: "drawingml-has-no-decimal-separator" }`，模板生成在 `SOURCE_SELECTION.json` 保留它。原始停止点、来源 part 和属性仍保存在既有来源证据中；无分隔符测量契约的候选继续 partial，不因读到渲染报告而自动注册。

报告绑定实际 PPTX／PDF、初始配置、两个复现脚本的 SHA-256。schema 核对实际与诊断身份、源文件绑定、完整页序、各环境一致的探针内容、请求／实际区域设置、源 run 内容以及按 0.25pt 容差重新计算的结果状态。回归还核对已提交报告与当前复现脚本摘要一致。

这些校验用于维持证据内部一致性，不是签名验证、例外批准或支持等级授权。规则门禁接入时仍须验证实际文件及其摘要，不能只接受外部 JSON 自报结果。本报告也不覆盖混排字体度量、自动折行、浏览器捕获或 PowerPoint／WPS／Keynote 的编辑行为。

## 显式声明与浏览器测量

生成器现在接受 `--decimal-tabs <声明文件.json>`，与 `--analysis` 同时使用。声明作用于该源 PPTX 的所有 decimal 停止点，必须匹配分析文件和实际 PPTX 的 SHA-256：

```json
{
  "version": 1,
  "sourcePptxSha256": "<analysis.json 中的 sourceHash>",
  "decimalTab": {
    "separator": ",",
    "provenance": "user-declared",
    "reason": "源作者确认所有小数点制表字段按逗号对齐",
    "targetProfile": "libreoffice-7.3.7.2-linux-de-DE"
  }
}
```

```sh
node scripts/extract-theme.mjs source.pptx --name reviewed-decimal --analysis analysis.json --decimal-tabs decimal-tabs.json
```

可用配置为 `libreoffice-7.3.7.2-linux-en-US`（句点）、`libreoffice-7.3.7.2-linux-de-DE` 和 `libreoffice-7.3.7.2-linux-fr-FR`（逗号）。这些 ID 固定关联本报告的 SHA-256 与对应环境，浏览器不接受调用者自报的任意证据哈希。报告摘要及诊断／实际阶段由回归核对。选择配置只声明测量依据，不会设置 Office 区域设置，也不是当前文稿的兼容性验收。

`SOURCE_SELECTION.json` 分别保存来源 `decimalTabConvention: unknown` 与用户 `decimalTabDeclaration`；不会改写来源分析。没有声明时 decimal 候选继续 partial；提供合法声明后，只解除小数分隔符这一物化阻断，其他来源问题与应用限制仍保留。源码、打包提取器和 `runThemeExtraction({ decimalTabsPath })` 使用同一入口。

模板作者可以在 `nativePlaceholders[].textStyle.paragraph.decimalTab` 或某个 `levels[].paragraph.decimalTab` 设置同一对象；MCP／IR／原生契约均校验。字段缺省继承，`null` 显式清除，列表与默认间距独立继承；声明不随画布缩放。含 decimal 停止点的浏览器段落必须有完整的有效声明。缺少、清除、未测量配置或分隔符不匹配均阻断捕获，不从 lang、Intl 或操作系统猜测。

浏览器按真实 DOM Range 测量首个分隔符左边缘，保留跨 run 的字形度量；无分隔符时使用字段末端。字段止于下一个 Tab、br 或文字内软换行。连续空字段仍消耗停止点，过长字段压到零间隔，显式列表用尽后使用左对齐默认网格。捕获重新测量，拒绝改动正文后未更新的间隔；已覆盖中英混排、强调、语言独立、编辑和缩放。宿主与独立 Slidev 均运行共享测量逻辑。

原生正文保留真正 Tab、`algn="dec"` 和来源 indent，保持一个可编辑文字对象。导出提示携带配置 ID、区域设置和证据哈希，说明已知生产差异；完整声明留在模板／快照中，导出报告保留应用配置与证据提示；不能从 DrawingML 回读出不存在的分隔符属性。再次分析导出 PPTX 时仍正确得到 unknown。直接构造的原生快照允许无声明的 decimal，用于原生语义探针，并输出未声明提示；这不绕过浏览器捕获契约。

自动折行现已接入累计字形测量与行级捕获，见[文字流验证](text-flow-compatibility.md)。剩余项目符号几何、RTL，以及 PowerPoint／WPS／Keynote 的编辑与视觉验收仍未完成。此处测量通过不提升目标应用支持等级。
