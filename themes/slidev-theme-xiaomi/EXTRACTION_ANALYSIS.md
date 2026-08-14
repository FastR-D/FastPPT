# xiaomi 提取分析

| 项目 | 值 |
| --- | --- |
| 画布 | 1280×720 (16/9) |
| 主色 | #FF6900 |
| 次色 | #11161A |
| 背景 | #FFFFFF |
| 正文色 | #000000 |
| 标题字体 | MiSans |
| 正文字体 | MiSans |
| 标题字号 | ~86px |
| 正文字号 | ~17px |
| 背景类型 | image |
| 填充签名 | #4472C4 |

## 幻灯片字体使用（按频率）
- `MiSans` ×296

## 建议布局（供 harness 设计参考）
- cover
- section
- ending
- two-col
- metrics

## 建议组件（供 harness 设计参考）
- callout
- stat
- pill

## 幻灯片内容结构
- slide1: pics=0 tables=0 charts=0 shapes=9 2col=no
- slide2: pics=0 tables=0 charts=0 shapes=27 2col=no
- slide3: pics=0 tables=0 charts=0 shapes=13 2col=no
- slide4: pics=0 tables=0 charts=0 shapes=15 2col=no
- slide5: pics=0 tables=0 charts=0 shapes=14 2col=no
- slide6: pics=0 tables=0 charts=0 shapes=21 2col=no
- slide7: pics=0 tables=0 charts=0 shapes=22 2col=no
- slide8: pics=0 tables=0 charts=0 shapes=19 2col=no

## 主导色（按频率）
- `#FFFFFF` ×93
- `#FF6900` ×30
- `#000000` ×25

> 修正说明：原提取器遗漏了 OOXML 自闭合 `srgbClr` 节点，导致错误回退到 Office 默认 `accent1` 蓝色。修复后，小米橙是源幻灯片中最主要的非中性色。
