---
theme: slidev-theme-landing
addons:
  # - slidev-addon-typst
  # - slidev-component-progress
  # - slidev-addon-naive
  # - slidev-addon-stem
aspectRatio: 16/9
---

# References 插件演示

---

# 什么是 Slidev?

Slidev 是一个为开发者设计的幻灯片制作和演示工具。特点包括：

- 📝 **基于文本** - 使用 Markdown 编写内容，然后添加样式
- 🎨 **可主题化** - 主题可以作为 npm 包分享和重用
- 🧑‍💻 **对开发者友好** - 代码高亮、实时编码和自动完成
- 🤹 **交互式** - 嵌入 Vue 组件以增强表达
- 🎥 **录制** - 内置录制和摄像头视图
- 📤 **便于分享** - 导出为 PDF、PPTX、PNG 或可部署的 SPA
- 🛠 **可扩展** - 几乎网页上的任何东西都可以在 Slidev 中实现

更多信息：[Why Slidev?](https://sli.dev/guide/why)

---

# References 插件用法

本页面演示了 References 插件的用法：

Transformer 架构 <MyCite doi="10.48550/arXiv.1706.03762">实现了突破性的进展</MyCite>。

<MyCite doi="10.1038/nature12373">深度学习的发展</MyCite> 推动了现代人工智能的发展。

---

# 引用列表

这是该页面的所有引用：

<References />

---

# Navigation

Hover on the bottom-left corner to see the navigation's controls panel

## Keyboard Shortcuts

|     |     |
| --- | --- |
| <kbd>space</kbd> / <kbd>tab</kbd> / <kbd>right</kbd> | next animation or slide |
| <kbd>left</kbd>  / <kbd>shift</kbd><kbd>space</kbd> | previous animation or slide |
| <kbd>up</kbd> | previous slide |
| <kbd>down</kbd> | next slide |

---
layout: toc
active: 1
tocTree:
  - title: 框架核心概念
    children:
      - title: 响应式系统 (Reactivity)
      - title: 虚拟 DOM 渲染
  - title: 工程化实践
    children:
      - title: Vite 构建流程
      - title: 自动化测试
  - title: 性能优化策略
    children:
      - title: Tree Shaking
      - title: 懒加载与分包
---

layout: image-right
image: https://cover.sli.dev
---

# Code

## Test

Use code snippets and get the highlighting directly!

```ts
interface User {
  id: number
  firstName: string
  lastName: string
  role: string
}

function updateUser(id: number, update: Partial<User>) {
  const user = getUser(id)
  const newUser = { ...user, ...update }
  saveUser(id, newUser)
}
```

---
layout: center
class: "text-center"
---

# Learn More

[Documentation](https://sli.dev) / [GitHub Repo](https://github.com/slidevjs/slidev)
