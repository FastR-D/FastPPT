# WHU Teaching 0.2 验证记录

日期：2026-10-10。参考主题：仓库内 slidev-theme-academy。

## 本次升级

保留 WHU 调色板、中文无衬线字体与校园封面；引入 Academy 式章节导航、课程页脚、标题层次、三线式表格、定义框、轻量说明、核心结论、图表说明与流式引用。原 9 个布局不改名，新增 content、split、toc。

## 验证结果

- 主题 smoke 通过；新增 3 项单元测试通过，覆盖章节定位、双栏比例合法性以及全局/单页密度与间距覆盖。
- 注册表 33 项测试通过，主题与 Skill 版本均为 0.2.0。
- 最终 12 页 example.md 经项目 Markdown 格式化/验证、机器规则验证：0 个问题，覆盖全部 12 种布局。
- 默认主题构建与 12 页完整示例的 Slidev production build 均通过。
- Chrome 逐页检查 12 页：0 个 JavaScript 错误、0 个画布越界、0 个页脚遮挡、0 个分栏内部溢出。全部页面经过截图视觉复核。
- 自动目录跳转到第二章节、正文导航返回第一章节：通过；当前章节随页面正确更新。
- 原 0.1 的 9 页示例未经内容改动，在新主题下渲染通过，未发现越界。
- 4 组配置回归通过：compact 22px；dense 20px 与 3:2 双栏；关闭导航和页脚；1.8 行距/26px 内容间距/字符串 footer；最小导航和 pageNumber: false。
- 本次未改动 Academy 包或工作区锁文件。

预览：`.preview/overview.png`；逐页图：`.preview/slide-*.png`；检查记录：`.preview/audit.json`、`.preview/regression.json`；生产构建：`.preview/dist/`。这些均为可再生成的忽略文件。

未执行 PPTX 导出或 PowerPoint 原生编辑验证。本版本不实现 Academy 的自动图表编号、Typst 和 Plotly 接口。
