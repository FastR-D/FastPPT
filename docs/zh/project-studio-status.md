# FastPPT 实施状态

FastPPT 使用 pnpm、TypeScript、Fastify、React 和 Vite。Python 只执行
PPT Master 现有的确定性 checker 与 exporter，不承载 FastPPT 服务。Agent Gateway
使用 Claude Agent SDK 与 Codex SDK 的官方本地凭据发现，不保存 API Key。

## 已交付能力

- Generate `svg_output/`、Edit Native `authoring-svg-flat/` 和 Create Template
  只读审阅边界。
- 页面／整套会话、选择／区域／页面／页面集合／整套作用域，以及严格的
  `baseRevision`、目标集合和元素引用语义校验。
- 元素结构路径、文本摘要和几何元数据；跨版本重定位在低置信度或并列候选时
  返回 `409`，不会让 Agent 猜测。
- 持续 SSE、标准 `Last-Event-ID` 续传、有限重放、项目事件和作业事件日志。
- Agent 与 direct 两类 staging 作业、影响计划、审批门、作用域 guard、checker、
  journal 原子提交、失败保留、重试、取消与崩溃整体回滚。
- Default Generate 的 `waiting_workflow` 队列和 Step 7 后显式释放；Quick、
  Edit Native 和 Create Template 保持各自路线合同。
- 共享 Confirm UI 的回环身份校验代理；receipt 仍只由 Confirm UI 校验和写入。
- sidecar 感知的 `deckRevision`、导出失效、路线 exporter、postflight receipt、
  `exportAfter` 状态链和版本恢复。
- 修改前后 staging 差异、历史版本、Edit Native 页面计划与受限 JSON sidecar。
- 成功提交且成功导出后的记忆候选；编辑、接受、拒绝、撤回、作用域检索和
  Agent 上下文注入。拒绝或撤回项不可检索。
- 项目内附件路径校验、raw SVG 与会话 ID 校验、单实例 lock、回环绑定和
  Confirm 代理 SSRF 边界。
- 页面计划与已生成 SVG 合并为统一页面列表；未生成页面使用空预览和统一状态
  标签，不再假定每个规划页面已有 revision。
- 左栏使用 revision 缓存键渲染 SVG 缩略图；画布提供抓手平移、分级缩放、
  100% 和自适应视口控制，并保持元素点击与 CTM 框选语义。
- 主题输入执行独立 research Agent 阶段，严格校验 `Research Brief`、无 URL 的
  Markdown、连续 fact ID 和 `ppt-master.fact-provenance.v1`，原子写入并导入
  Markdown／facts JSON 后才允许规划；无效研究输出不会进入来源清单。
- 启动页展示当前项目、最近同级项目、运行能力和 Harness 状态；支持创建项目、
  复用已有 Studio 锁或在独立回环端口启动目标项目，拒绝任意路径切换。
- 附属面板可查看报告并编辑受限 JSON；保存使用内容 revision 乐观并发控制，
  外部修改返回 `409`，避免覆盖，并立即使旧导出失效。
- 页面历史提供持久撤销／重做栈；恢复和新提交都保持可逆语义并按需清空 redo，
  顶栏及 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z` 操作当前页。
- 前端将三条工作区 SSE 合并为单连接，并把最后 sequence 存入 sessionStorage；
  刷新后通过 `since` 补拉，连接内继续使用标准 `Last-Event-ID` 重连。
- `Ctrl/Cmd+K` 命令面板统一提供项目、检查、导出、撤销／重做、规划、历史和
  附属入口；支持筛选、回车执行和 Esc 关闭，不引入额外前端依赖。
- staging diff 支持修改前／修改后 SVG 并排可视预览，并显示两侧 revision；
  对照窗口只读，不改变 staging、提交或导出事务。
- 导出历史面板读取 `export_history.jsonl`，展示成功／失败记录和错误输出；历史下载
  按 `historyId` 定位，并严格限制在当前项目 `exports/` 下的 PPTX。
- 讲稿面板按当前页面 roster 编辑并整体保存 notes；服务端拒绝缺页、多页或越界页面，
  保存后同步标记导出失效。
- 工作区事件序号按项目隔离保存，重复或过期 sequence 会被丢弃，避免刷新、重连或
  切换项目时重复应用事件。

## 规划验收映射

1. 元素修改：selection 合同、direct/Agent staging、checker、commit、export。
2. 区域重排：region 合同与区域外对象指纹 guard。
3. 外部并发修改：`baseRevision` 不匹配返回 `409`。
4. 多页修改：影响计划、审批、一个事务和一次 exporter。
5. 任一页失败：正式项目零写入；测试覆盖双页失败。
6. Agent 中断：正式源不变，staging 保留，可重试或取消；commit 中断整体回滚。
7. 导出失效：SVG 或 sidecar 变化更新 `deckRevision`，成功导出恢复最新状态。
8. 生成期请求：Default Step 7 前进入 `waiting_workflow`，显式交接后释放。
9. Edit Native：使用 round-trip exporter 和 `page_plan.json`，未改页不转成普通生成页。
10. 记忆审批：接受后按作用域检索，拒绝后不可检索。
11. 撤销经验：withdraw 决策立即从检索和 Agent 上下文排除。
12. 路径越界：附件、slide ID、会话 ID 与代理目标均 fail-closed。

## 验证

```bash
pnpm install --frozen-lockfile --offline
pnpm studio:check
pnpm studio:web:build
pnpm studio:test
git diff --check
```

端到端测试覆盖 Generate、Edit Native、Create Template、持续状态文件、冲突、
区域 guard、多页零部分写入、journal 恢复、成功 Agent 状态机、自动记忆、
Confirm UI 回环代理、sidecar revision 和项目外路径拒绝。
