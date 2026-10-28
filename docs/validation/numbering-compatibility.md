# 自动编号的独立回渲染证据

2026-10-09，实际 FastPPT 原生导出 → LibreOffice 7.3.7.2 PDF → pdftotext。21 页中 19 页编号符合预期，2 页出现已知重启差异。完整标签和文件 SHA-256 见 [JSON 报告](numbering-libreoffice-7.3.7.2.json)。本机产物保存在 `.fastppt/validation/numbering/`，二进制不进入 Git；复现脚本进入工程。

| 用例 | 预期／实测 | 结论 |
| --- | --- | --- |
| 一级从 5 起、二级从 3 起，普通文本中断、空段和返回上级 | 5、6、3、普通文本、4、7、3、空段、8 | 一致；上层普通文本不重置下级，上层列表项会重置下级 |
| 连续段后重启到 2，再重启到 5 | 5、6、2、3、5、6 | 一致 |
| 连续段后重启到 1 | 预期 5、6、1、2；实测 5、6、7、8 | 已知差异，不能标记为通过 |
| 相邻段显式采用相同起点 5 | 预期 5、5、6；实测 5、6、7 | 已知差异，不能标记为通过 |
| 字符标记中断后恢复模板起点 | 5、字符、5、6 | 一致 |
| 16 种 Arabic／Latin 字母／Roman 格式，起点 27 | 独立固定期望值对照，包含 AA 与 XXVII | 全部一致 |

运行方式（需本机有 `libreoffice` 和 `pdftotext`）：

```bash
pnpm --filter @fastppt/e2e exec tsx scripts/numbering-compatibility.ts ../../.fastppt/validation/numbering
```

脚本写出 PPTX、PDF、提取文字及报告；每次转换前移除旧 PDF，避免失败时误用上次产物。报告记录渲染器版本、脚本摘要、实际 PPTX/PDF 摘要、逐页预期和实测。只有所有页面符合记录中的预期或已知差异时进程才成功退出；`known-difference` 始终独立于 `matched`。新版本若改变已知差异，应复核新报告，不能自动升级全应用支持。

这一检查只提供该版本 LibreOffice 的编号连续性和格式证据。它不验证字体度量、所有模板继承组合、编辑／保存重开、PowerPoint、WPS 或 Keynote，也尚未接入模板规则发布门禁。浏览器重新计数、原生 buAutoNum、正文无数字污染、单形状和逐组继承由对应浏览器／结构回归验证。显式页面重启在导出报告中保留 `numbering-compatibility`，源候选中的其他编号样式仍为 partial。
