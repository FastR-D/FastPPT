# FastPPT components

FastPPT 的共享 Vue 组件与蓝白 IDE 视觉规范。业务界面只组合组件，不直接声明原生 HTML 标签，不重复定义按钮和输入控件的外观。

- `Button`：`primary`、`secondary`、`quiet`、`icon`、`navigation`、`danger`；`xs` / `sm` / `md` 三种尺寸。
- `TextField`、`TextArea`、`SelectField`：共用边框、圆角、字号、禁用态和焦点环，使用 Vue 原生 model 指令保留输入法、数字、复选框数组和多选语义。
- `Button`、`TextField`、`Select`、`DisclosureTrigger` 的 `xs` 为 20px，用于紧凑工具栏；`sm` 为 30px，表单默认 `md` 保持原尺寸。
- `BrandMark`：蓝色文档与 P 标记组成的 SVG 图标，`fastpptIconUrl` 提供同一份资源给网站 favicon。
- `Select`：支持键盘操作、视口定位与滚动的选择菜单。
- `Modal`：共用遮罩、表面、尺寸、Escape、焦点循环和焦点恢复。
- `ModalBody`：统一弹窗正文的 16px 内容间距和 24px 内边距，手机上内边距收敛为 16px，与弹窗头尾对齐。
- `Box`、`Panel`、`Text`、`Heading`、`Header`、`Footer`、`Field`、`Table` 等语义与布局组件。
- `Frame`、`DialogSurface` 等基础组件保留 DOM ref，供预览捕获和编辑器使用。

应用入口仅导入一次 `@fastppt/components/styles.css`。视觉 token 和控件样式由组件库维护；业务 CSS 只安排布局、间距和内容层级。主操作显式使用 `variant="primary"`。

`eslint.config.js` 为 `apps/web/src/**/*.vue` 启用组件边界规则：原生 HTML 仅允许出现在本包内部；业务层的 `template` / `slot` 是 Vue 结构语法，不是原生 DOM。禁止通过 `Box as="button"` 等方式绕过控件组件。

深浅模式通过 `useColorMode()` 切换；`initializeColorMode()` 在应用挂载前初始化，首次跟随系统，显式选择保存在 `fastppt.color-mode`。两套主题共用语义 token，蓝色文字与蓝色按钮填色使用不同 token，以保证暗色模式中的可读性。
