# RTL 水平段落：逻辑文本与方向契约

2026-10-09。本轮支持普通水平 RTL 段落：方向来自 `a:pPr@rtl`，保留逻辑原文，物理 `marL`、`marR` 与 `indent` 不交换；浏览器捕获依靠 CSS bidi 成形，原生写入使用 DrawingML `rtl="1"`。阿拉伯语、希伯来语、Latin/数字/标点混排以及显式 `rtl="0"` 均经过真实 PPTX 导出和 LibreOffice 7.3.7.2 只读回读。

应用探针产物：`/tmp/fastppt-rtl-compatibility/report.json`。5 页全部保留原文，4 页写入 `rtl="1"`，1 页显式 LTR；实际 PPTX、PDF、LibreOffice 配置、SHA-256 和复现脚本摘要均绑定在报告中。

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/rtl-compatibility.ts /tmp/fastppt-rtl-compatibility
pnpm --filter @fastppt/e2e exec playwright test specs/standalone-tabs.spec.ts --reporter=line
```

浏览器专项覆盖 `مرحبا بالعالم 123 ABC`、`שלום עולם 123 ABC`、括号和数字混排、语言与方向不一致、右／中／左对齐、编辑后重新捕获与原生导出。DOM `textContent` 和捕获快照保持逻辑顺序；视觉区域由浏览器 bidi 算法决定，不能通过反转字符串实现。

当前边界：RTL 项目符号和 Tab 需要方向感知的标记／停止点测量，继续阻断；竖排、`bodyPr@vert`、`rtlCol` 分栏、复杂溢出和 autofit 继续保持 `partial`。双向控制字符仅作为应用观察记录，不作为跨应用像素等价证明。PowerPoint、WPS、Keynote 的打开、编辑、播放、保存矩阵仍未完成。
