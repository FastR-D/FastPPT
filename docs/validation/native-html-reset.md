# 全库原生 HTML 重置验收

本次覆盖静态版式 3497 页、动画源参考 211 页、创意动画示例 1230 页。
静态与参考页从本次变更前的固定 SVG 基线转换，保留所有非 SVG 字节、文字和对象锚顺序。
动画示例重新组合为标题、产品占位、指标、节点、粒子和装饰等 HTML 元素。

## 交付结构

- `packages/resources/pages`：每页一个 Slidev Markdown；普通矩形、原生图片及带几何元数据的 HTML/CSS 轮廓。
- `packages/animations/pages`：1230 个原生 HTML 创意动画示例，9860 个动画对象。
- 静态与源参考库的 `compositions`、`index.json`，以及静态库的 `manifest.csv`：真实源对象结构、可替换槽位、HTML 锚候选、当前 Markdown 哈希及检索说明。
- `docs/design/native-html-geometry.md`：HTML/CSS 轮廓与可编辑 PPTX 的契约。

转换得到 50,023 个矩形、623,405 个几何对象和 549 个图片对象，共 673,977 个原生 HTML 对象。
61,903 个复杂或不可见画层保留局部 SVG，均标记原因；其中包括 25,980 个完全裁切对象、
23,482 个蒙版对象，以及裁切描边、裁切图片、虚线与超出点数预算的对象。
另外每页有一个不绘制内容的 SVG 定义区。转换没有用整页截图代替内容。

语义索引包含 218,659 个源对象与 99,572 个槽位；64,525 个源对象有明确映射。
几何候选和未映射画层分别保留，候选分数不作为对象身份的证明。检索返回有界摘要和
本地完整文件路径，避免把整个大页面的几何数据自动塞进 LLM 上下文。

复杂曲线采用受预算约束的采样轮廓；填充自交转换为简单复合轮廓，孔洞在 DrawingML
中保持同一原生自定义形状。HTML 颜色、透明度、尺寸可直接修改；修改轮廓需同步 CSS
和几何元数据。存在 SVG fallback 的页不能声称所有对象均可在 PPTX 中原生编辑。

## 已核验的结构与导出

- `native-integrity-audit.json`：3708 页基线、当前哈希、非 SVG 字节、锚顺序全部通过；重复转换逐字节幂等。
- 1230 个 motion JSON 与原提交逐字节一致，保留全部 13,326 个原生动画效果及其时间、顺序和 XML。
- 32 个源 PPTX 均存在，记录了 SHA-256；它们未受 Git 跟踪，因此没有将其宣称为与 Git 基线相同。
- `native-geometry-audit.json`：623,405 个对象、22,241,080 个点的数据、颜色和预算校验，错误 0。
- `native-visual-audit.json`：3708 页唯一覆盖，逐页前后哈希匹配，加载错误和差异超阈值均为 0；平均 MAE 0.001460，最大 0.015549，阈值 0.02。
- 人工复核 MAE 最高的 `71caabc93d70-0261` 与高差比例最高的 `f753356251a9-0568`，照片、数字、图表和完整日期表均无缺失；主要差异为图片重采样和密集细线抗锯齿。
- 两库 `render-audit.json`：3708 页文字溢出、越界、缺失图片及加载错误均为 0；修补的 17 页另行重测，所有页面哈希和最终索引一致。
- 像素核对发现并修复跨 SVG 的图片引用丢失：20 个被引用的源图片保留原 SVG ID，重建 17 页。全库原始/当前悬空 SVG 引用均为 0。
- 浏览器端到端检查 2 项通过：复合孔洞、透明度、CSS 改色，以及实际库页的 35 个原生自定义形状和可编辑文字。导出文件不含 `p:pic`。
- 两个导出样例经 LibreOffice 转 PDF 后进行视觉检查；这只是样例验证，不是 Microsoft PowerPoint 全库验收。
- Slidewave 回归 39 项、转换器 11 项、composition 6 项、resources 7 项、MCP 30 项测试通过；相关类型检查、Slidewave 构建及本次涉及模块的 lint 通过。
- 动画基础 DOM 1230 页、专门创意动画的浏览器中间时间点 206 页、13,326 效果数据审核均为错误 0，且报告索引哈希一致。
- 两库非 assets 目录的 PNG/JPG/JPEG 截图数量为 0。视觉检查样例只保存在临时目录。

逐页图像与 DOM 验收见 `packages/resources/native-visual-audit.json` 及两库的
`render-audit.json`。旧 SVG 重建的图像分数保留为历史
数据，不用于认证当前 HTML。自动像素检查针对转换前基线与转换后 HTML；不等于与
Microsoft PowerPoint 原生播放逐页完全一致，也不等于全库人工审美验收。

## 重建与复验

离线重建使用 Python 3.10.12、lxml 6.1.1、Shapely 2.1.2；依赖记录在
`packages/resources/scripts/requirements-native.txt`，浏览与复用现有页面不需要这些 Python 依赖。

```bash
python3 packages/resources/scripts/reset-native.py --source-root /path/to/original-svg-baseline --report packages/resources/native-html-report.json
python3 packages/resources/scripts/composition-map.py --publish
pnpm --filter @fastppt/gateway exec tsx ../../packages/resources/scripts/audit-native-geometry.mts
node --experimental-strip-types packages/resources/scripts/audit-native-dom.mjs
python3 packages/resources/scripts/test-native-html.py
python3 -m unittest discover -s packages/resources/tests -p test_composition_map.py
pnpm --dir tests/e2e exec playwright test -c playwright.native-html.config.ts
```

基线必须与报告记录的原始 Markdown 一致；不能将已转换的页面作为原始 SVG 输入。
更新页面后必须重新发布 composition，并重新验收对应哈希的渲染结果。
