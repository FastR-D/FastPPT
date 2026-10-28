# PPTX 模板黄金链路

当前固定样例为 `single-master`：一套可达布局、两个文字占位符、固定品牌线，两页中文／Latin 内容。`source-package/` 保存源 PPTX 的全部包成员，`expected.json` 独立记录源哈希、精确 EMU 几何及文稿原文。首次输入由原生 writer 构造，再明确规范为 12192000 × 6858000 EMU；固定后运行器只组装这些文件，不调用 writer 重建输入或自动更新期望。它是合成回归样例，不是 Office 编辑验收。

在仓库安装依赖后运行：

```sh
pnpm --filter @fastppt/e2e exec tsx scripts/template-golden.ts
pnpm --filter @fastppt/e2e exec tsx scripts/verify-template-golden.ts /absolute/path/to/run
FASTPPT_GOLDEN_RUN=/absolute/path/to/run pnpm --filter @fastppt/e2e exec tsx --test scripts/template-golden.test.ts
pnpm --filter @fastppt/cli build
pnpm --filter @fastppt/e2e exec tsx scripts/template-packaged-smoke.ts /absolute/path/to/run
```

需要 Chrome／Playwright Chromium、Noto Sans CJK SC、LibreOffice、系统 Python UNO、`fc-match`、`pdftoppm` 和 `pdftotext`。独立 Slidev 使用端口 4336，端口被占用时失败；不使用 E2E Gateway、临时复制的布局或现有预览进程。运行器创建新的 `artifacts/single-master-*` 目录，也可将第一个参数指定为其他产物根目录。输入、失败中间物和成功结果均保留，不覆盖旧运行。

每次保存 source、analysis、生成主题、theme-lock、Markdown、浏览器快照和测量、export、read-back、浏览器 PNG、真实输出的 LibreOffice PDF／PNG／只读段落观察及 JSON 报告。报告记录实际文件 SHA-256、主题摘要、实现源码摘要、依赖锁文件、字体文件、浏览器／应用版本和区域配置。源包按固定排序、日期及 STORE 压缩组装，源哈希必须匹配；导出 PPTX 的生成日期可以变化，报告绑定当次文件。

自动检查包括来源几何、原文、页序、母版关系、占位符、固定对象规则及独立应用的文本读取和页数。离线 verifier 逐文件检查摘要、重新读取实际 PPTX 关系、重新执行样例结构规则并验证主题锁；篡改、缺图、旧输出摘要或从清单删掉必需产物均失败。它不是数字签名，也不以报告自身的成功标记代替实际文件。

打包冒烟先验证保留运行，再调用 CLI 分发目录内的提取器、Slidewave writer 和 MCP stdio 入口；检查布局定义、实际新 PPTX 的结构回读，以及 `get_theme_rules` 的规则、摘要和证据需求。结果保存在该运行下新的 `packaged-*` 目录。打包冒烟不复用源代码 writer，但仍依赖测试侧的结构读取器；它不是分发包的独立渲染或目标应用编辑验收。

`automatedChecks: passed` 只表示这些检查通过；整体 `status: partial` 保留视觉及多应用编辑未验收。已有截图观察到 LibreOffice 的首行基线和段落行距与浏览器不同，不能据此宣布像素等价。颜色值／字号／密度等发布规则、PowerPoint／WPS／Keynote 的新建页／切布局／编辑／保存重开和其他四组黄金输入仍按路线继续开发。二进制产物沿用仓库本地保存政策，不进入代码历史；可追踪的源包 XML、期望和运行器足以重新生成。
