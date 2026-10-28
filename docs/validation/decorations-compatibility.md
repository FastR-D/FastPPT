# 单下划线与单删除线：独立应用证据

2026-10-09。真实原生导出共 12 页，LibreOffice 7.3.7.2 Linux 实测 12 页吻合、0 页未预期差异。[完整报告](decorations-libreoffice-7.3.7.2.json)保存原始 PDF 文字基线、线段、颜色、线宽与预期位置。这里验证装饰语义及水平范围，浏览器像素等价仍为 `unverified`，PowerPoint/WPS/Keynote 尚未验收。

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/decoration-compatibility.ts /tmp/fastppt-decoration-compatibility
```

需要系统 LibreOffice 7.3.7.2、Python UNO、Poppler、Liberation 字体，以及 `python3` 可加载的 PyMuPDF。本轮使用 PyMuPDF 1.28.2，产物保存在仓库 `.fastppt/validation/decorations/`。每次使用独立应用配置，不改动文档再渲染；报告绑定真实 PPTX、PDF、绘图 JSON、初始配置和两个复现脚本的 SHA-256。页面仍为一个原生正文对象和一个段落，原字符与作者软换行不变。打开前逐字符核对 run 的 `u`／`strike`，并核对软换行独立属性，不能让显式取消重新继承默认装饰。

独立预期使用 20pt Liberation Mono，每个字符 12pt advance、行距 30pt、文字起点 40pt。PyMuPDF 提取实际矢量线段及文字基线，以基线上／下区分删除线和下划线；只合并同一行同类且相接的线段，水平容差 0.25pt，原始线段留在报告。颜色按正文 `#112233` 复核。当前不比较浏览器与应用的精确纵向偏移、线宽或字体光栅化。

| 样例 | 结果 |
| --- | --- |
| 无装饰、仅下划线、仅删除线、两者同时 | 线条种类、范围和正文色吻合 |
| 中间连续空格 | 下划线连续经过空格 |
| Tab | 两侧文字有线，Tab 间隔无线；Tab 的其他兼容限制仍见制表报告 |
| 软换行、连续软换行 | 每个有文字的行绘制对应装饰，空行无线 |
| `gypsy` 下伸字形 | 应用绘制连续下划线；源 Vue 使用 `text-decoration-skip-ink:none` |
| 空段默认两种装饰 | 默认属性保留，没有虚构线段 |
| 各 run 独立取消、同时开启 | 线条范围吻合，不把段落默认强加给局部 run |
| 默认两种装饰、含软换行的正文显式全部取消 | 原生 run／br 明确取消，实际页面无线 |

`textStyle.underline` 与 `strike` 是独立可选布尔值：缺省继承，`false` 取消，`true` 表示单线。相同字段适用于统一样式的固定文字；混合固定文字继续保留 partial。空的标准 `uLnTx/uFillTx` 保留随正文线条／填充语义，自定义 `uLn/uFill`、双线、波浪线等未支持装饰仍附带 part/shape/run 定位问题，不压平成单线。

Vue 只在实际文字叶节点应用模板装饰，避免 CSS 祖先下划线无法被后代取消。作者使用 `data-fastppt-underline="false"`／`data-fastppt-strike="false"` 独立取消，也可显式设为 `true`；属性在作者子树内继承。段落、空段和 BR 的默认元数据不绘制祖先装饰。普通 HTML `u/s` 保持浏览器本身的祖先传播语义。捕获验证声明、实际 CSS、颜色和线条样式，拒绝非法声明、双线、自定义颜色／粗细／偏移及被篡改的连续线设置。布局绑定只移除该级别声明的装饰属性，`textStyle: page` 保留页面局部取消。

参考 `pptx-renderer@2e8cd2222a889451bc872df50941f927cc79c7a2` 的逐属性继承及显式 none 处理。该版本会把其他非 none 下划线／删除线值合并为布尔 true；FastPPT 对未表达样式保持定位 partial，采用独立应用探针确定连续线和 Tab 间隔行为。参考代码与本报告均不替代实际文件的规则渲染门禁或多应用编辑／保存验收。
