# FastPPT 画盘

本地配色库，采用与 `packages/resources` 相近的索引、检索与详情读取机制。
当前内置 **2,147 组去重配色**，包括设计配色、主题配色、分类色、连续色、发散色和循环色。

- `data/index.json`：版本化索引，保存稳定 ID、色号、标签、来源、别名及源色数。
- `data/sources/`：公开数值数据的原始快照；索引记录下载来源与 SHA-256。
- `src/index.ts`：按需读取、索引热更新、双语关键词／风格扩展、色号近似匹配、分页与筛选。
- `scripts/import.py`：静态解析 JSON、Python 字面量、TypeScript 色值和公开配色数据，不执行下载的代码。
- 超过 12 色的连续色带固定采样为 9 色，`originalColorCount` 保留原长度；同一组色号合并来源与别名。

## 使用

```ts
import { PaletteLibrary } from '@fastppt/palettes'
const palettes = new PaletteLibrary()
await palettes.search({ query: '科技发布', limit: 24 })
await palettes.read('索引中的配色 ID')
```

默认使用本包 `data`；`FASTPPT_PALETTES_ROOT` 可指向另一个同格式库。

HTTP：`GET /api/v1/palettes`、`GET /api/v1/palettes/facets`、
`GET /api/v1/palettes/:id`、`POST /api/v1/palettes/recommend`。
AI 推荐由当前 Claude Code / Codex Harness 完成，不需要额外 API Key；
模型只对真实候选库排序并说明理由，返回不存在的 ID 会被拒绝。
搜索本身离线可用，模型不可用时仍可继续搜索。
MCP 提供 `search_palettes` 和 `read_palette`，对话可复用同一份数据。

## 更新数据

```sh
# 从已提交的来源快照重建，可离线复现
python3 packages/palettes/scripts/import.py --offline
# 更新项目数值源，同时刷新 Color Hunt 热门与近期配色
python3 packages/palettes/scripts/import.py --refresh-colorhunt
```

Color Hunt 每次刷新读取热门 25 页、近期 10 页，限制并发为 2 并保留来源链接。
不在运行时抓取网站。索引数据不包含来源网站的页面代码或图片；
`sources` 中的项目源码仅用于可复现的数值解析。原项目的许可和归属仍随来源元数据保留。

## 来源

- [Color Hunt](https://colorhunt.co/)：公开热门和近期设计配色数值。
- [ColorBrewer](https://colorbrewer2.org/)：地图及图表色序。
- [Open Color](https://github.com/yeun/open-color)：界面色阶。
- [Radix Colors](https://github.com/radix-ui/colors)：浅色与暗色界面色阶。
- [Catppuccin](https://github.com/catppuccin/palette)：四套主题配色。
- [Bokeh](https://github.com/bokeh/bokeh)：经典及科学可视化色带。
- [Plotly](https://github.com/plotly/plotly.py)：分类、连续、发散、循环配色。
- [Vega / D3](https://github.com/vega/vega/tree/main/packages/vega-scale)：可视化配色。

配色参考不等于任意两种颜色都有足够文字对比度；卡片色号标签会按亮度选择前景色，
用于页面时还应结合字号、背景和最终用途检查。
