# 原生布局与页面占位符绑定

原生布局定义保存在主题的 `agent/native-layouts.json`。主题设计工具的 `layouts[].nativePlaceholders` 会生成该文件；刷新母版快照后，导出使用锁定版本。修改文件会改变主题摘要，需要刷新快照才能继续导出。

```json
[
  {
    "name": "cover",
    "placeholders": [
      {
        "index": 0,
        "type": "title",
        "x": 914400,
        "y": 914400,
        "width": 7315200,
        "height": 914400,
        "textBody": {
          "insets": { "left": 91440, "right": 91440, "top": 45720, "bottom": 45720 },
          "verticalAlign": "middle",
          "wrap": true,
          "autoFit": "none"
        },
        "textStyle": {
          "fontFamily": "Inter",
          "fontFamilies": { "ea": "Noto Serif SC", "cs": "Noto Sans Arabic" },
          "fontSize": 28,
          "color": "223344",
          "bold": true
        }
      }
    ]
  }
]
```

位置和尺寸单位为 EMU（914400 = 1 英寸）；字号单位为点；颜色为不含 `#` 的六位 RGB。索引须在同一布局内唯一。基础文字默认值用于全部九个段落级别，可以用 `levels` 指定独立覆盖：

```json
{
  "fontFamily": "Inter",
  "fontSize": 24,
  "bold": true,
  "paragraph": {
    "align": "left",
    "marginLeft": 0,
    "lineSpacing": { "unit": "percent", "value": 120 }
  },
  "levels": [
    {
      "level": 2,
      "textStyle": { "fontSize": 16, "bold": false },
      "paragraph": {
        "marginLeft": 914400,
        "indent": -182880,
        "spaceBefore": { "unit": "points", "value": 0 },
        "spaceAfter": { "unit": "points", "value": 6 }
      }
    }
  ]
}
```

`level` 为 1–9，不能重复。每级先继承基础值，再应用自身声明，不从相邻级别继承。`false`、零缩进和零间距均为有效覆盖。逐级 `fontFamilies` 按脚本合并；逐级声明统一 `fontFamily` 会重新设置该级全部脚本的回退，仅该级的 `fontFamilies` 可以再次覆盖它。

段落支持 `align`（left/center/right/justify）、`marginLeft`、`marginRight`、`indent`（EMU，可为负值）；`lineSpacing`、`spaceBefore`、`spaceAfter` 使用 `{ unit: points|percent, value }`，百分比的 120 表示 120%。字号、绝对间距和缩进随参考画布宽度缩放，百分比不缩放。浏览器采用相应 CSS 行高和字体比例；Office 的实际行度量仍须通过回渲染验收。

段落标记由四组独立属性组成，同样可放在 `paragraph` 或某个 `levels[].paragraph` 中：

| 属性 | 可用值 |
| --- | --- |
| `bullet` | `{ "kind": "none" }`、`{ "kind": "character", "character": "•" }` 或 `{ "kind": "auto-number", "scheme": "arabicPeriod", "startAt": 5 }`；字符须是单个 Unicode 标量，允许符号字体的私用区字符，拒绝空白、控制字符和孤立代理项 |
| `bulletFont` | `{ "kind": "text" }` 随首个可见正文 run，或 `{ "kind": "font", "fontFamily": "Symbol" }` |
| `bulletSize` | `{ "kind": "text" }`、`{ "kind": "points", "value": 14 }`（1–4000 点）或 `{ "kind": "percent", "value": 80 }`（25–400%） |
| `bulletColor` | `{ "kind": "text" }` 或 `{ "kind": "color", "color": "AA5500" }` |

示例段落：`{ "bullet": { "kind": "character", "character": "•" }, "bulletSize": { "kind": "percent", "value": 80 }, "marginLeft": 914400, "indent": -365760 }`。字体、大小和颜色未声明时使用随正文默认值，避免种子母版的符号样式泄漏。四组属性在逐级继承时分别替换；只声明取消符号，不会清除该级的字体／大小／颜色设置。点值随画布缩放，百分比保持比例。

源 Vue 项目符号目前测量左对齐／两端对齐、负首行缩进的悬挂排版，正文折行后仍从正文左边界开始。居中／右对齐、非负缩进所依赖的制表布局，以及未实现的编号格式、图片符号、标记透明色和更复杂字体属性仍需后续契约，源候选保持 partial。符号大于悬挂区时捕获阻断，不默默覆盖正文。字体解析、安装和嵌入分别验证，不把字体名存在当作字形可用证明。

自动编号支持 16 种 DrawingML 样式：`arabicPeriod/arabicParenR/arabicParenBoth/arabicPlain`，以及 `alphaLc/alphaUc/romanLc/romanUc` 分别配 `Period/ParenR/ParenBoth`。`startAt` 是模板默认起点，缺省为 1，范围 1–32767；字母编号在 Z 后为 AA，罗马编号按加减法格式化。超出当前计数范围会阻断捕获，不回绕或把数字拼入正文。

每个显式文本框拥有独立的逐级计数。非空列表项回到上级时重置下级；普通文本中断不重置，空段不消耗数字；切换字符标记、编号样式或默认起点会开始新序列。页面 `<p data-fastppt-start-at="2">` 可主动重启，`<li data-fastppt-start-at="2">` 作用于其第一个投影段落。重启意图以快照 `numberingRestart` 保存，和模板起点分别处理。浏览器按 DOM 顺序重新计算，写入原生 `buAutoNum`；连续段省略本地 startAt。选择 `textStyle: layout` 时，布局已声明的 bullet 仍会覆盖页面重启／取消，应使用 `textStyle: page` 保留页面意图。

原生编号存在应用差异。LibreOffice 7.3.7.2 的独立回渲染确认重启到 1、相邻相同起点可能继续计数；已有序列中的显式重启／默认起点变更，以及空段重启，会在导出报告中产生 `numbering-compatibility` 提示，不能把结构正确当作显示一致。空段重启保存原始意图并提示复核。编号字体收集使用对应样式的完整小字母表／数字／标点集合，以防应用计数差异造成子集缺字。参见[编号兼容证据](validation/numbering-compatibility.md)。

段落制表契约保存 `defaultTabSize` 和 `tabStops`，均按画布宽度缩放。`defaultTabSize` 为 0–51206400 的整数 EMU，缺省为 914400；`tabStops` 是最多 1024 项、按 position 严格递增的 `{ position, align }` 数组，位置相对于段落左边距，允许负值。默认间距与显式列表独立继承；缺省列表继续继承，`[]` 明确清除列表，零默认间距不等于缺省。原生契约允许 left/center/right/decimal；源布局和浏览器已完成 left/center/right；decimal 仍需分隔符约定和目标应用验证，继续 partial。

例如 `{ "defaultTabSize": 914400, "tabStops": [{ "position": 1905000, "align": "left" }, { "position": 3333750, "align": "left" }] }`。先选择光标右侧的显式停止点，再使用默认网格；负缩进区域的下一个默认位置最低为零。默认间距为零且后方无显式停止点时阻断，不自行补间距。

在源槽位的显式文本框中，可以输入真正 Tab 字符或 HTML `&#9;`。宿主和生成主题的 setup 会在 Vue 编译前保护正文 Tab，投影后逐个实测间隔，并在编辑、字体加载及尺寸变化时重算。跨 run、连续 Tab、中文混排、空列表和软换行可保留；必须是左对齐 LTR 且每条显式行无需自动折行。捕获验证字符、停止点、间距和边界；未测量的 Tab、自动折行、篡改的间隔和缺失显式框体会产生 invalid-snapshot。导出保留正文 Tab 和原生 defTabSz/tabLst，不转换为空格或多个文本形状。

居中和右停止点测量下一个 Tab 或显式软换行之前的整个字段，包括跨 run 的强调、不同脚本及字号。前者将字段中点、后者将字段末端放到停止点；如果字段过长而会覆盖前文，Tab 间隔压到零，不跳到后面的默认网格。字段内容和停止点契约保持不变。连续 Tab 的空字段仍消耗停止点，显式列表用尽后的默认停止点回到左对齐。编辑、字体加载、缩放会重新测量；捕获独立检查字段宽度，不能用旧间隔导出已改变的正文。正文段落本身仍须左对齐、LTR；停止点居中不表示支持居中段落中的 Tab。

小数点对齐不能只按 run 的 lang 或遇到的首个标点猜测。LibreOffice 7.3.7.2 的德语／法语探针保留了原生 run 语言，却仍按句点而非逗号对齐。下一步需要显式定义来源／目标应用的分隔符约定，并保留无法编码到 DrawingML 的环境依赖；在此之前，decimal 源候选和浏览器捕获继续保持 partial／阻断。

LibreOffice 的已知制表差异通过对象级 `text-tab-compatibility` 报告，不修改来源缩进来掩盖差异；参见[制表兼容证据](validation/tabs-compatibility.md)。这不改变占位符 textStyle: page/layout 的独立继承策略，也不代表剩余项目符号几何或应用层排版已验收。

`fontFamilies` 可分别指定 `latin`、`ea`、`cs`。每个脚本优先使用对应字体，缺项使用 `fontFamily`；两者均未声明时继续继承。空映射、空字体名和未知脚本键会被拒绝，避免把拼写错误默默丢弃。旧的单一 `fontFamily` 契约继续可用。

`textBody` 独立描述文本框。四边 `insets` 单位为 EMU，支持显式零值；默认左右 91440、上下 45720。`verticalAlign` 为 top/middle/bottom，默认 top；`wrap` 为布尔值，false 禁用自动折行，仍保留显式软换行；当前 `autoFit` 仅支持 none，不自动缩字或扩展形状。左右内边距按参考画布宽度缩放，上下按高度缩放，包括未声明边的缺省值。负内边距、未知字段、其他对齐和自动适应方式会被拒绝；图片占位符不能声明此契约。未声明 `textBody` 的旧布局仍输出原有空 bodyPr。

声明 `textStyle` 时，未指定的段落属性仍使用左对齐、零缩进、无项目符号、零段间距和 1.2 倍行距，避免种子母版的居中、缩进或字符格式意外生效。生成的源 Vue 槽位同步设置可表达的文字属性及默认文本框内边距。源占位符可以保留逐级文字／段落样式和不同脚本字体；上述字符符号／常用自动编号之外的标记格式、未测量的制表布局、RTL 与其他未实现格式仍使候选保持 partial，详见 [PPTX 文字继承](pptx-text-inheritance.md)。

在页面 frontmatter 中按对象锚点绑定槽位：

```markdown
---
layout: cover
fastpptPlaceholders:
  title:
    index: 0
    geometry: layout
    textStyle: layout
    textBody: layout
---
<h1 id="title">标题</h1>
```

- `title: 0` 是简写，仅建立关联，保留页面捕获的位置、尺寸和文字格式。
- `geometry: layout` 移除页面对象的整个局部变换，位置、尺寸、旋转和翻转由布局继承；默认 `page` 保留局部变换。
- `textStyle: layout` 按每个页面段落的级别，移除布局已定义的字体、字号、文字填充、粗体、斜体及段落属性覆盖。逐脚本字体只移除对应的脚本覆盖，未声明字段保留。文字、链接和段落级别保留；主／备用语言分别按该级布局的声明继承，未声明的组保留页面值；默认 `page` 保留局部文字格式。存在跨级共享的非空页面 `defPPr` 且布局各级不同的情况会拒绝绑定，避免删除共享属性影响其他级别。
- 项目符号继承也按四组分别处理：例如布局只声明 `bulletColor`，只移除页面 buClr/buClrTx，符号、字体和大小继续保留；声明 `bullet` 才移除页面标记类型。页面局部取消需使用 `textStyle: page`，或在模板对应级别明确声明 none。
- `textBody: layout` 独立移除布局已声明的各边内边距、垂直对齐、换行和自动适应覆盖；未声明的边或属性继续保留页面值。默认 `page` 保留捕获值。使用 layout 时必须有锁定的 textBody 契约，不会随 geometry/textStyle 选项隐式开启。
- 布局名、槽位和对象锚点必须存在。绑定对象必须导出为唯一顶层原生形状；一个容器拆成多个形状时不能整体绑定一个槽位。图片只能绑定图片槽位。
- 禁用母版导出时不应用这些绑定。

浏览器预览使用主题 Vue/CSS，不会仅因上述 frontmatter 继承选项自动调整。PPTX 导入生成的源布局已从同一契约创建 `ph-<index>` 命名槽位，内容需放在对应槽位并显式绑定锚点；通用手写布局仍需自行保证几何一致。含段落契约的源槽位根据嵌套列表深度选择级别，也可以在 p、标题或 li 上设置 `data-fastppt-level="2"`。列表容器自身不增加缩进，各段落使用相对同一文本框的契约值；因此嵌套不会重复累加缩进。捕获保留 1–9 级身份，输出转换为 DrawingML 的 0–8 级 `lvl`。PowerPoint/WPS/Keynote 中的完整继承仍未完成验收。

源槽位将普通文字按 Unicode 字素分段显示脚本字体，保留组合音标、emoji、空格和文字顺序。生成的字体包裹层在捕获时合并为一个原生文本对象，保留原内容锚点，导出内部保存逐脚本 run。默认仍按文字节点捕获；多段正文可以显式声明一个文本框，使整个容器成为唯一顶层原生形状：

```markdown
---
layout: <reviewed-source-layout>
fastpptPlaceholders:
  source-body:
    index: 1
    textStyle: page
---

::ph-1::

<div id="source-body" data-fastppt-text-box>
  <p>第一段包含 <em>强调文字</em> 和 <a href="https://example.com/" style="border:0;padding:0">链接</a>。</p>
  <p data-fastppt-level="2">第二级正文<br>同段软换行</p>
  <p></p>
</div>
```

此功能要求源槽位提供 paragraph/levels 契约，使段落具有明确级别。捕获保存每段样式、缩进、间距和逐 run 字体／装饰／链接；段落分隔与 `<br>` 软换行分开，空段也保留。导出写入一个文本形状，使用原有占位符和动画锚点。上述 `page` 保留局部强调；选择 `textStyle: layout` 仍会移除布局已声明属性的全部局部覆盖，例如布局声明 `italic` 时会覆盖页面斜体。

当源槽位还有 `textBody` 契约，且显式文本框是该槽位唯一的直接内容时，捕获使用整个占位符矩形及实际内边距、垂直对齐和换行状态，避免只捕获正文边界后再次应用内边距。浏览器用画布的横／纵容器单位分别定位两轴内边距；非等比调整画布不会把上下内边距错误地按宽度缩放。显式文本框不能再添加额外外边距或缩窄宽度；槽位内有其他可见内容时拒绝把它当作单个文本框。

文本框使用无间隙的列排版。可包含普通段落、标题、源布局投影后的嵌套列表及行内文字；列表级别由模板决定标记样式。带字符符号或自动编号的源段落必须放入显式文本框，使标记与正文合并为同一个原生形状；没有标记框体时阻断导出。`<p data-fastppt-no-bullet>` 或 `<li data-fastppt-no-bullet>` 可局部取消标记，`data-fastppt-level="9"` 等仍选择模板级别。空段保留标记契约，但不显示符号；可见标记随编辑和尺寸变化更新，单独测量并写入原生 buChar/buAutoNum/buFont/buSz*/buClr*，不进入正文字符串。字体收集也包含实际可见标记的字形。

容器只使用一个锚点，不在子段落或 run 上设置独立 id／动画锚点。图片、SVG、额外视觉效果、边框／自定义内部 padding、复杂定位、裁剪、RTL、未测量的制表布局、独立子锚点和无法表达的排版会产生 `invalid-snapshot` 并阻断导出；不会静默丢弃这些对象。标记内容、位置、字体、颜色或大小与契约不一致时也会阻断。源槽位的 textBody 内边距不受此限制。普通节点捕获仍可用于不需要整体绑定的内容。自行渲染文字的 Vue 组件和目标应用中的排版仍需独立验收。

## 布局固定对象

布局定义可包含 `fixedObjects` 数组，每项使用唯一 `name` 和 EMU 坐标 `x/y/width/height`，可选 `fill`（六位 RGB）、`text`、`fontFamily`、`fontSize`（点）、`color`（文字 RGB）、`language` 和 `alternativeLanguage`（整段固定文字的统一语言声明）。对象写在布局层、位于占位符下方，不复制到每个页面，也不建立页面占位符或动画绑定。主题设计输入对应 `layouts[].nativeFixedObjects`。

当前固定对象支持无描边矩形与纯文本（换行分段），可按多个母版分别继承；图片、渐变和复杂形状仍需扩展。主题设计工具会在声明 nativeCanvas 后从同一份固定对象定义生成浏览器固定层，并携带导出去重标记；既有手写主题需自行接入这些标记。

## 参考画布

布局可声明 `canvas: { width, height }`（EMU），主题设计输入对应 `nativeCanvas`。声明后，导出按实际页面宽高分别换算占位符和固定对象的位置、尺寸；跨宽高比会产生非等比几何变化。显式字号以参考画布中的点数为单位，并随目标宽度比例缩放。未声明时继续按绝对 EMU 写入。

参考画布也是生成浏览器固定对象的比例坐标依据。生成主题的非空 nativeFixedObjects 必须同时提供 nativeCanvas。浏览器字号按参考画布换算容器单位，PPTX 显式字号按同样的横向比例缩放。固定文字两端均使用零内边距、顶部对齐和 1.2 倍行高；具体字体度量与换行仍需视觉验收。

主题设计工具会为固定文字补全缺省字体（主题正文字体的首个 family）、字号（参考画布 12pt）及颜色（主题 ink），并将补全结果写入两端生成文件。当前固定文字采用常规字重、左对齐，不支持独立的富文本 run 格式。

## 母版分组

布局可用 `masterId` 归属母版组（主题设计输入为 `nativeMasterId`），省略时为 `default`。导出生成独立母版部件并将布局连接到所属组；通过下述 masterTheme 与 masterObjects 配置每组的主题投影和固定对象，未指定属性继续来自种子。

母版组还可通过布局的 `masterTheme`（设计输入 `nativeMasterTheme`）指定 `fontFamily` 和 `colors`（最多六个不含 # 的 RGB 强调色）。同组多个布局若都提供配置，必须一致。配置后的组使用独立主题部件；未指定的字段保留种子主题。主题设计生成器将同组配置传播到布局的局部 CSS：覆盖标题/正文字体，以前两个强调色分别设置 primary/accent，并暴露六个 --fastppt-master-accent-N 变量。既有手写主题仍需自行使用相应配置。

### 母版共享固定对象

主题设计布局可声明 `nativeMasterObjects: { canvas: { width, height }, objects: [...] }`，对象字段与 `nativeFixedObjects` 一致。同一 `nativeMasterId` 下只需一个布局声明，其余布局会继承；多个显式声明必须一致。浏览器使用各自参考画布定位，母版对象位于布局固定对象后方。文本缺省字体、字号和颜色按组主题与设计基础值补齐。

原生契约字段为 `masterObjects`。导出将对象写入共享母版一次，不复制到布局或页面。捕获的 `nativeLayoutObject.scope` 区分 `master` 和 `layout`，避免同名对象混淆；禁用母版导出时仍保留捕获内容。当前支持矩形及纯文本，图片等资源对象仍待扩展。

固定对象可以提供 `anchor` 作为显式动画锚点。动画导出遇到匹配的捕获对象时，会为该页生成独立布局；若目标来自母版，还会生成独立母版。变体只移除被动画覆盖的固定项，保留其他固定项、占位符与组主题；动画对象作为该页可编辑对象输出。其他页面继续使用原始共享定义。此行为仅针对显式指定的动画，不会自动给品牌框架添加动画；Office 客户端表现仍须按兼容性矩阵验证。


## 文字语言

`textStyle.language`／`textStyle.alternativeLanguage` 对应 DrawingML 的 `lang`／`altLang`，可分别在基础样式及 `levels[].textStyle` 中声明。缺省字段继承；空字符串显式表示未知语言；大小写和私有标签原样保留。生成的源布局也将统一语言投影到槽位，因此没有段落契约的普通文字同样可以继承。

页面用 `lang="zh-CN"` 和 `data-fastppt-alt-lang="en-GB"` 分别声明主／备用语言，也可用空字符串清除。适用于容器、段落、列表和内联文字；页面声明优先于模板的浏览器默认值。`textStyle: page` 保留捕获结果，`textStyle: layout` 只移除该级布局已声明的语言组，另一组继续保留。固定文字可使用相同字段，但尚不支持不同 run 的语言混合。

这些字段保留文字语言信息，不指定应用的小数分隔符，也不自动启用 RTL 排版。非法标识会被契约校验拒绝；目标应用的字体选择、断词和拼写行为仍需独立验收。
