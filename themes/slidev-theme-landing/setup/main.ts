import { defineAppSetup } from "@slidev/types";
import referencesPlugin from "../plugins/references/index";
import scrollPlugin from "../plugins/scroll";
import tabPlugin from "../plugins/tab";
import { createPinia } from "pinia";
import "@fastppt/slidewave/browser/runtime";

// 注:本主题不使用任何 naive-ui 组件(已核实组件/布局/插件/slides 均无 N* 标签)。
// 此前全量注册 `import * as naive from "naive-ui"` 会把整个库打进产物,
// 且 naive-ui 入口顶层 import "virtual:naive" 导致静态构建产物运行时崩溃。

export default defineAppSetup(({ app }) => {
  app.use(createPinia());
  app.use(referencesPlugin);
  app.use(scrollPlugin);
  app.use(tabPlugin);
});
