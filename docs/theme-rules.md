# 模板机器规则

主题 manifest 的 `machineRulesFile` 指向 JSON 规则文件；`rulesFile` 中的人类可读设计原则继续作为创作指导。规则只判断有证据的结构或测量结果，不解释设计原则中的自然语言。规则可声明 `provenance`（`extracted`、`derived`、`inferred`、`generated`、`user-overridden`）；未声明时返回 `unspecified`，不能推定为来源事实。

MCP `get_theme_rules` 保留 `rules` Markdown 字段，同时返回 `machineRules`、`machineRulesDigest`、`machineRulesSource`、`contentDigest` 和 `evidenceRequirements`。`machineRulesStatus` 区分 `absent`（未配置）、`empty`（规则集合为空）和 `available`；这些都是配置状态，不是验证结论。结构规则标明目录／编译结构及 `pptx-xml` 证据，行数／密度标明浏览器测量及待接入的 `pptx-render`，token 规则标明尚缺的输出映射。`providerAvailable` 只表示当前读取器具备该种证据能力，不保证文稿已提供证据；现有各阶段门禁不因此跳过。规则文件改变但注册表尚未重载时，接口拒绝返回与旧主题摘要不一致的规则。

```json
{
  "version": 1,
  "rules": [
    { "id": "brand.master", "kind": "required-master", "master": "brand", "severity": "error" },
    { "id": "cover.title", "kind": "required-placeholder", "layout": "cover", "type": "title", "index": 0, "severity": "error" },
    { "id": "brand.logo", "kind": "fixed-object", "name": "Logo", "owner": "master", "allowOverride": false, "severity": "error" },
    { "id": "body.lines", "kind": "max-text-lines", "layout": "default", "value": 12, "severity": "error" },
    { "id": "body.density", "kind": "max-density", "value": 0.7, "severity": "warning" },
    { "id": "brand.token", "kind": "required-token", "token": "--ext-primary", "severity": "error" }
  ]
}
```

| 规则 | 判定范围 |
| --- | --- |
| first-layout / last-layout | 编译后第一页／最后一页的 layout |
| layout-position | 指定布局若出现，只能位于 `positions` 声明的 `first`／`last` 位置；审批目录阶段不要求出现该布局 |
| required-layout / required-master | 整份文稿至少一页使用指定 layout／master |
| allowed-layouts / forbidden-layout / allowed-masters | 逐页检查布局或母版 |
| max-slides | 编译后的总页数 |
| required-placeholder | 只检查使用该 layout 的页面；槽位 type 与 index 必须匹配。若还要求该布局必须出现，另加 required-layout |
| fixed-object | 每页必须继承指定 name 与 owner 的固定对象；未允许时，显式动画引起的页面覆写违反规则 |
| required-token / forbidden-token | 逐页检查 `.slidev-layout` 上计算后非空的 CSS 自定义变量名，例如 `--ext-primary`；不是任意文本关键词 |
| max-text-lines | 页面可见内容按块统计的实际渲染行数总和；继承品牌固定对象不计入 |
| max-density | 可见文字片段及图片、SVG、表格、canvas、video 矩形的并集面积／画布面积；裁剪到画布，重叠只计一次，取值 0–1 |

内置 Landing、Academy、crimson-violet、whu-teaching、xiaomi 使用 `layout-position` warning 规则，来源是各自 Markdown 的布局建议；自定义页和没有封面／结束页的文稿仍可通过。其余 17 个内置主题尚无机器规则，`machineRulesStatus: absent` 不代表通过。提取器自动生成的注册布局、首尾页规则均标记 `generated` 且为 warning；它们不是源 PPTX 的硬约束。新的品牌颜色、字体和 logo 值校验需要输出对象映射与实际产物证据，现有 token／固定对象规则不承担这项保证。

密度是确定性的内容边界指标，不是像素墨迹比例或视觉审美分数。变换后的边界按浏览器矩形近似；字体换行与 PowerPoint 的实际排版仍须回渲染验收。

`severity` 可取 `error`、`warning`、`needs-human`，省略为 `warning`。结果包含 ruleId、source、页号、结构定位 locator、修复建议及 `status`：已观测违规为 `violation`，证据不足为 `unverified`。在 validate/quality 中缺证据显示为 needs-human；导出时仍按原规则 severity 执行，error 级规则缺证据会阻断，包括 fast 导出策略。

结构证据来自原生布局定义；导出时使用锁定的定义。浏览器测量必须与文稿 revision、主题内容、机器规则、profile 和母版快照内容摘要匹配。逐页检查会保留其他页仍有效的结果；修改任何上述输入后须重新检查。未知测量不等于零，也不按 Markdown 的换行估算。

## 导入审批

审批在用户选择完成、未选布局被裁剪后，对待安装目录调用同一个 evaluator（`phase: approval`）。输入是主题布局目录，不是将来的文稿：首末布局规则检查对应布局是否可用，不检查目录排列；页数上限、CSS token 和渲染行数／密度保持 `unverified`、`needs-human`。已知的布局、母版、占位符和固定对象违规保留原严重度，error 阻断原子安装。

`IMPORT_RULE_REVIEW.json` 保存 `scope: theme-catalog`、规则摘要、最终 manifest/native definitions 的 `catalogDigest`、布局列表和问题。失败报告留在导入草稿；成功报告随主题安装。`GET /api/v1/imports/pptx-theme/:themeId/rule-review` 返回经 schema 校验的报告，无历史报告时返回 null。Web 展示 ruleId、来源和修复建议；有待审查问题的注册结果保留在面板，已注册决策不能再编辑。

## 导出后回读

导出任务冻结通过导出前校验的机器规则文档，`themeRules.stage` 从 `pre-export` 变为 `post-export`。在允许审查和下载前，`readPptxRuleEvidence` 从实际 ZIP 的 officeDocument 关系、presentation 页序及 slide → layout → master 关系读取结构，并以 `phase: readback` 执行同一个 evaluator。

- 占位符来自实际 layout；固定对象来自实际 master/layout，遵循 `showMasterSp` 和对象隐藏标记。
- FastPPT 写入可忽略的 `urn:fastppt:template-identity:v1` 扩展，记录逻辑布局／母版和稳定页面身份。动画生成的布局变体保留逻辑名称；固定对象覆写必须引用页面中真实存在的 shape。没有扩展的文件使用实际 `cSld` 名称；不据此虚构稳定页面身份。
- 缺 part、关系歧义、重复页 ID／占位符索引、非法覆写、实际页数或已记录页面身份不匹配都会失败。没有预期定义或浏览器测量值作为读回替代输入。
- `themeRules.readback` 保存来源 `pptx-xml`、文件 SHA-256、时间、状态、问题及实际 part 路径。阻断时保留任务、规则文档和快照，删除不可发布产物。重试重新生成报告；重启后审查／下载仍核对冻结规则摘要和文件哈希，文件变化使任务失效。

XML 不能提供 PowerPoint 实际行数、密度或 CSS token 证据。这些规则在回读中保持 `unverified`，沿用声明的严重度：error 阻断发布，warning/needs-human 展示待审查问题。浏览器通过不会把 PPTX 回读自动标为通过。

## 显式文稿例外

预览面板的“审查模板规则例外”按具体问题填写原因并批准。导出前（`export`）和导出后（`readback`）分别授权，不会因为选择 fast 策略或点击“确认导出”自动放行规则。已批准的问题仍保留原始 `severity` 和 `status`，只增加 `exception: { id, reason, approvedAt }`；回读仍有问题时报告为 `issues`，不是验证通过。

记录保存在 `.fastppt/decks/<deckId>/theme-rule-exceptions.json`，包括用户操作时间、原因、适用阶段、原问题与指纹、绑定上下文和撤销时间。追加／撤销按文稿串行执行并原子写入；重复批准同一有效问题幂等，撤销后重新批准生成新记录并保留历史。

绑定包括：

- deck ID 与 Markdown revision；
- theme ID 与直接读取主题文件计算的内容摘要、机器规则语义摘要；
- 锁定母版、请求 profile、规范化导出选项的摘要；
- 动画、备注和图表 sidecar 的 `authoredDigest`；
- 原问题的 ruleId、code、status、页号、locator、message 和 source 指纹。

上下文任一字段变化都会使记录失效；问题本身改变也不应用旧例外。服务器在批准前重新取得当前问题，不接受客户端自填的违规结果。回读例外只能来自当前绑定的、无产物解析错误的真实导出报告。预览校验／质量检查复用适用的导出前例外；导出任务冻结有效记录，开始生成、完成回读、人工审查、HTTP 下载及重启后的上述操作均重新检查当前上下文和撤销状态。已失败任务重试使用原冻结记录；新增批准后应创建新导出。

| API | 用途 |
| --- | --- |
| `POST /api/v1/decks/:deckId/rule-exceptions/review` | 传入 phase、options、profileDigest；readback 另传 exportId，返回当前绑定、问题指纹和有效／失效／撤销历史 |
| `POST /api/v1/decks/:deckId/rule-exceptions` | 同上，并传 expectedBinding、issueFingerprint、reason；服务器重新验证后记录批准 |
| `POST /api/v1/decks/:deckId/rule-exceptions/:exceptionId/revoke` | 撤销该文稿的记录，保留审计历史 |

例外仅解除匹配的模板规则阻断。损坏 ZIP、悬空关系、正文／数据缺失、错误 placeholder 绑定等产物完整性检查继续阻断；原始未验证问题不会因批准变成已验证。导入目录审批不使用文稿例外。结构规则、浏览器通过和人工例外均不构成 PowerPoint/WPS/Keynote 的支持声明。
