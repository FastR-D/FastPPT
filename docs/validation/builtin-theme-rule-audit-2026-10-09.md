# 内置主题机器规则审查

审查日期：2026-10-09。范围为仓库 `themes/*/agent/theme-manifest.json` 的全部 23 个内置主题；逐项读取 manifest 布局目录和 `rulesFile`。不包含用户导入的主题。此表是迁移决策，不能作为某份文稿通过验证的报告。

当前 **6/23** 套主题具有非空机器规则，共 **9** 条，全部是从 Markdown 明确位置建议推导的 `layout-position`、`provenance: derived`、`severity: warning`。仅在相应布局出现时检查；不强制封面或结束页出现，不限制自定义布局。其余 **17/23** 套保持 `machineRulesStatus: absent`，不创建空 JSON 充数。

下表主题名称省略共同的 `slidev-theme-` 前缀。来源路径均相对于仓库根目录，点击对应的规则文件可查看依据。

| 主题 | 审查结论 | 已迁移规则／未迁移原因 |
| --- | --- | --- |
| academy | 规则 + 仅指导／缺证据 | [来源](../../themes/slidev-theme-academy/agent/theme-rules.md)明确 end 仅用于最终致谢，迁移 `academy.end-position`。实质结论在 end 前、H1、密度和品牌视觉尚需语义／对象证据。cover 用于标题页不等于必须首位。 |
| computer-organization | 规则 + 缺证据 | [来源](../../themes/slidev-theme-computer-organization/agent/theme-rules.md)“cover 开头…end 收尾”，迁移 `computer-organization.cover-position`／`end-position`。调色板、字体和字号尚缺输出属性映射；section 用作转场不证明位置。 |
| crimson-violet | 规则 + 缺证据 | [来源](../../themes/slidev-theme-crimson-violet/agent/theme-rules.md)“cover 开头…end 收尾”，迁移 `crimson-violet.cover-position`／`end-position`。颜色和字体建议不能用 token 存在性代替。 |
| eloc | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-eloc/agent/theme-rules.md)只有 default，建议短标题、代码层级和有限列。无原生槽位或页序要求；不将布局目录机械地变成自定义表达禁令。 |
| landing | 规则 + 仅指导／缺证据 | [来源](../../themes/slidev-theme-landing/agent/theme-rules.md)cover 用于标题或结尾，保留 `landing.cover-position` 的 first/last。paper-summary 的命名槽位是组件创作指导，不能虚构为原生 placeholder type/index。 |
| ledger | 缺证据；absent | [来源](../../themes/slidev-theme-ledger/agent/theme-rules.md)的 1–4 图、3–5 模块、乘数数量、语义颜色和 serif/sans 角色需对象分类与内容角色，现有密度规则并非图数规则。 |
| magazine | 缺证据；absent | [来源](../../themes/slidev-theme-magazine/agent/theme-rules.md)的横带 ≤4、铜棕覆盖 ≤15%、高亮 ≤3 需要角色和颜色面积度量；不能替换为整页 max-density。摄影来源和章节命题继续人工审查。 |
| mumbo | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-mumbo/agent/theme-rules.md)browser 用于截图、default 由 mode/frontmatter 驱动；没有位置、原生母版或槽位约束。 |
| narrative | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-narrative/agent/theme-rules.md)照片优先 image-left/right、观点用 statement；需内容语义，未指定封面位置或必须出现的布局。 |
| nicodevs | 缺证据；absent | [来源](../../themes/slidev-theme-nicodevs/agent/theme-rules.md)fact 一个关键数字、statement 一个结论；字符数、行数和页数均不能证明这一语义。 |
| nmt | 缺证据；absent | [来源](../../themes/slidev-theme-nmt/agent/theme-rules.md)要求保留 16:10，manifest 已有画幅元数据；机器规则尚无画幅值比较。figure/about-me/Announcement 是内容选择指导。 |
| nord | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-nord/agent/theme-rules.md)以 default 和 Nord 色板组织层级；未声明位置约束，颜色需实际属性映射。 |
| practicum | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-practicum/agent/theme-rules.md)Slot/Text/Image API、裁切与内容优先级属于组件／视觉契约，不能当作原生 placeholder。 |
| raft | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-raft/agent/theme-rules.md)配对内容和观点对应 two-cols/statement；end 布局存在本身不证明位置要求。 |
| sketchdeck | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-sketchdeck/agent/theme-rules.md)whiteboard/code 的语义适配与便签阅读顺序未被当前 evaluator 建模。 |
| squircle | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-squircle/agent/theme-rules.md)选择一致 palette、流程用 process-flow/steps-layout；未指定 closing/cover 的位置。 |
| strategy | 缺证据；absent | [来源](../../themes/slidev-theme-strategy/agent/theme-rules.md)证据模块数量、ChapterBar/SoWhatBar 各至多一次、语义配色需对象与组件角色；不能以固定对象名称证明组件用量。 |
| tahta | 缺证据；absent | [来源](../../themes/slidev-theme-tahta/agent/theme-rules.md)显式 themeConfig.variant 需要配置证据和受众判断；现有 required-token 只接受 CSS 变量名，不能替代 frontmatter 校验。 |
| the-unnamed | 仅指导／缺证据；absent | [来源](../../themes/slidev-theme-the-unnamed/agent/theme-rules.md)about-me/two-cols/center 对应语义任务，未给出可执行页序或原生槽位规则。 |
| touying | 缺证据；absent | [来源](../../themes/slidev-theme-touying/agent/theme-rules.md)preset 一致性属于配置证据；正式学术场景与 focus 的适用性需语义判断。 |
| tud-db | 缺证据；absent | [来源](../../themes/slidev-theme-tud-db/agent/theme-rules.md)品牌使用授权、留白、页脚和对比语义尚未建模；同名页脚不是品牌资产与几何的证明。 |
| whu-class | 规则 + 缺证据 | [来源](../../themes/slidev-theme-whu-class/agent/theme-rules.md)“cover 开头…end 收尾”，保留 `whu-class.cover-position`／`end-position`。颜色、字体和源 dt/ftr/sldNum 的动态行为仍待独立证据。 |
| xiaomi | 规则 + 缺证据 | [来源](../../themes/slidev-theme-xiaomi/agent/theme-rules.md)“ending 收尾”，迁移 `xiaomi.ending-position`；不将未提到的 end 别名或产品主视觉 cover 扩为页序要求。“标题最多两行”是标题角色指标，现有 max-text-lines 是整页总和，不能直接使用。MiSans、橙色及禁用 Office 蓝需输出值证据。 |

通用的“只用注册布局”、引用核实、预览检查及主题视觉语言继续由创作指导与原有校验承担。新规则不把这些原则偷偷变成阻断自定义 HTML/CSS 的布局 allowlist。`derived` 表示对上述 Markdown 建议的转写，不证明它是源 PPTX 自身规定的顺序。

验收落点：`packages/theme-registry/tests/index.test.ts` 对真实注册主题检查非空规则、来源、严重度、适用阶段、合法页序、故意违规、自定义页及缺失布局身份；`rules.test.ts` 检查目录与文稿阶段差异、缺证据和测量隔离。目录审批的 `layout-position` 显示 `not-applicable`；产物没有布局身份时保留 `unverified`，不能因为无法匹配布局而空通过。

下一步是品牌输出映射、标题／组件等角色度量及实际 PPTX 渲染证据。它们未实现前，表中“缺证据”不升级为规则覆盖或发布保证。
