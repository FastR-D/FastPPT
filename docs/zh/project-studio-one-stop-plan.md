# Project Studio 一站式工作台规划

## 目标

参考 `~/FastWrite` 的工作台体验和 `~/FastPPT` 的 Harness 生命周期，让用户可以在浏览器内完成：

```text
启动 Studio → 新建项目 → 导入素材/输入主题 → 生成规划 → 确认
→ 生成 SVG → 实时预览 → 选择或框选修改 → 检查 → 导出并下载 PPTX
```

Studio 必须保持事务边界：Agent 只写 staging，质量检查通过后才提交主项目；预览明确区分 staging、committed 和 exported 状态。

## 产品界面

采用 FastWrite 风格的三栏工作台：

- 左栏：项目、页面缩略图、页面状态和多选。
- 中栏：SVG 画布、选择、框选、平移、缩放、适应画布和修改前后预览。
- 右栏：Harness 对话、阶段进度、差异、检查结果、记忆和附属内容。
- 顶栏：项目名称、当前阶段、Harness 状态、检查和导出按钮。
- 底部 Composer：主题、素材和修改指令输入。

页面状态统一为：`未生成`、`规划中`、`生成中`、`待确认`、`已生成`、`修改中`、`检查失败`、`可导出`、`已导出`。

## 项目生命周期

### 启动与创建

支持：

```bash
pnpm studio
pnpm studio <project-path> <port>
pnpm studio --new <project-name>
```

启动页提供新建、打开、最近项目和能力检测。服务端返回统一项目状态：

```ts
{
  projectId: string;
  projectRoot: string;
  route: string;
  stage: string;
  deckStatus: string;
  harnesses: HarnessStatus[];
  capabilities: Record<string, boolean>;
}
```

创建流程为：初始化项目、转换来源、运行 topic research、生成 source manifest、初始化 page plan、创建 Harness 会话，并通过事件流显示进度。

### 规划与确认

Agent 先输出结构化规划，不直接绘制页面：

```json
{
  "title": "课程首页",
  "audience": "本科生",
  "tone": "学术、克制、具有校园识别度",
  "canvas": "ppt43",
  "pages": [{ "id": "P01", "role": "title", "title": "课程名称" }]
}
```

网页确认页支持页面数量、顺序、页面角色、风格、主题色和模板选择。确认后进入 SVG 生成。

## Harness 架构

参考 `~/FastPPT`，Claude 和 Codex 使用统一适配器，不为每次修改创建无上下文会话：

```ts
interface HarnessAdapter {
  kind: "claude" | "codex";
  getStatus(): Promise<HarnessStatus>;
  createSession(input: CreateSessionInput): Promise<SessionReference>;
  resumeSession(input: ResumeSessionInput): Promise<SessionHandle>;
  forkSession?(input: ForkSessionInput): Promise<SessionReference>;
  sendMessage(input: SendMessageInput): AsyncIterable<UnifiedAgentEvent>;
  cancelRun(input: CancelRunInput): Promise<void>;
}
```

会话关系：

```text
生成会话
  ├── 规划分支
  ├── 页面修改分支
  ├── 框选区域修改分支
  └── 导出修复分支
```

页面修改必须 fork 当前生成会话，携带主题、规划、素材、历史修改和用户反馈。

## 事件协议

统一事件：

```text
session.created / session.resumed
run.created / run.started / run.progress / run.completed / run.failed
approval.requested / approval.resolved
file.changed / preview.updated
validation.started / validation.passed / validation.failed
revision.created / revision.committed
export.started / export.completed / export.failed
```

前端订阅 `workspace`、`session:<id>`、`run:<id>`、`deck:<id>` 和 `export:<id>`，断线后按 sequence 补拉事件。

## SVG 编辑与预览

编辑范围统一支持：本页、所选元素、框选区域、勾选页面和整套。

框选工具将浏览器坐标通过 SVG CTM 转换为画布坐标：

```ts
{ slide: "P01", region: { x, y, width, height } }
```

提交成功后必须：生成新 revision、写入 manifest、发出 `revision.committed`、刷新缩略图和当前 SVG，并在 iframe URL 附加 revision cache key。

## 修改事务

```text
创建编辑分支 → staging 修改 → scope 校验 → SVG quality checker
→ 生成 diff → 提交 revision → 更新主项目 → 实时刷新
```

检查失败时不提交主项目，保留 staging，展示具体错误，并允许使用同一 Harness 会话继续修复。

## 导出

```text
检查当前 revision → 生成 final quality report → svg_to_pptx.py
→ 写入 export receipt → 生成受限 download URL → 浏览器下载 PPTX
```

下载接口只允许当前项目 `exports/` 目录下的 `.pptx` 文件，并设置正确的 Office MIME 类型和 attachment 文件名。

## 记忆与附属

成功提交并导出后生成记忆候选，支持接受、拒绝、修改和撤回。附属面板统一展示 `page_plan.json`、`animations.json`、讲稿、音频、transition 配置、export receipt 和 validation report，并提供更新时间、状态和查看/编辑入口。

## 服务端模块

```text
studio-ts/src/
├── project/       # 项目初始化、状态、能力
├── harness/       # Claude/Codex 适配器、会话、事件归一化
├── jobs/          # 作业、staging、事务和重试
├── preview/       # SVG 预览和 revision watcher
├── export/        # 检查、导出、下载
└── logging/       # FastPPT 日志、脱敏和级别
```

## 前端模块

```text
studio-web/src/
├── components/{workspace,project,canvas,composer,harness,revisions,export}
├── stores/{project,session,canvas,event}
├── api/{studio-client,harness-client}
└── styles/{tokens,workspace,components}
```

## 实施阶段与验收

### Phase 1：基础闭环

启动、项目状态、SVG 预览、revision 刷新、导出下载、空状态和错误状态。

验收：网页完成“打开项目 → 查看 SVG → 检查 → 下载 PPTX”。

### Phase 2：Harness 会话

统一适配器、status、create/resume/fork、事件流、取消、重试和 staging 生命周期。

验收：同一个生成会话连续完成生成、修改和修复。

### Phase 3：规划与生成

来源导入、topic research、page plan、确认页、生成进度和失败修复。

验收：主题输入后在网页确认规划并生成首页。

### Phase 4：可视化编辑

元素选择、框选区域、scope 校验、diff、revision 提交和实时预览。

验收：框选区域并通过对话完成局部修改，页面实时更新。

### Phase 5：导出与附属

final quality gate、PPTX 下载、notes、animation、narration、记忆和导出历史。

验收：从主题开始一站式导出可编辑 PPTX。

### Phase 6：体验完善

FastWrite 风格视觉细节、快捷键、command palette、可折叠面板、最近项目、撤销/重做、断线恢复和响应式布局。

## 优先级

第一优先级：Harness 会话持久化、规划确认、staging 事务、SVG 实时刷新、导出下载。

第二优先级：框选工具、diff、取消/重试、记忆和附属内容。

第三优先级：快捷键、command palette、多项目管理和窄屏适配。
