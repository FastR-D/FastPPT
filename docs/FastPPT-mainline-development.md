# FastPPT 主线开发交接说明

版本：1.0
更新时间：2026-08-20
适用分支：`main`

## 1. 先读这份说明

本仓库现在是 FastR-D 组织的正式 FastPPT 主线。后续 AI 或开发者必须在本仓库 `main` 上继续开发，不要创建 `FastPPT-Online` 等平行项目，也不要把旧 Skill 工作区直接复制进来。

本仓库的目标是：以 `ppt-master` 的 SVG 到可编辑 PPTX 路线为核心，逐步增加 FastPPT 的图片优先生成、高质量提示词、页面合同、在线逐页聊天精修、本地运行和服务器部署能力。当前提交只完成仓库迁移和目录边界，不代表在线服务已经实现。

## 2. 仓库来历

### 2.1 正式主线

- 正式仓库：<https://github.com/FastR-D/FastPPT>
- 上游仓库：<https://github.com/hugohe3/ppt-master>
- 上游关系：本仓库是 `hugohe3/ppt-master` 的 GitHub Fork。
- 本次 Fork：只复制上游 `main` 分支，没有复制旧 Skill 分支。
- Fork 基准提交：`a160e776b7faff5d2227d180d0f31c6253056fae`
- 上游许可证：MIT；必须保留仓库中的原始 `LICENSE` 和版权声明。

### 2.2 旧 Skill 项目

旧的 `FastR-D/FastPPT` 已改名为：

<https://github.com/FastR-D/FastPPT-legacy>

它保存原有 Skill 实验、`skill` 分支和历史内容，仅作为历史归档与参考。不要把它的 `skill` 分支推送到本仓库，也不要把其中尚未达到主线质量的代码直接合入 `main`。

学生项目参考版本保留在旧归档仓库的 `slidev` 分支：

<https://github.com/FastR-D/FastPPT-legacy/tree/slidev>

学生项目只用于借鉴浏览器工作台、Slidev HMR 和交互设计；不得把它的本地 Gateway、Codex/Claude Harness、MCP 或 `127.0.0.1` 依赖作为线上生产架构。

## 3. Git 工作规则

本主线不维护 `skill` 分支，也不把每个功能做成长期产品分支。默认直接在 `main` 上保持一个可运行产品，用 Tag 标记版本，例如 `v0.1.0`、`v0.2.0`。

远程关系应保持：

```text
origin   -> git@github.com:FastR-D/FastPPT.git       # 团队主仓库，可推送
upstream -> git@github.com:hugohe3/ppt-master.git    # 上游，只用于同步
```

同步上游时先执行 `git fetch upstream`，再根据测试结果决定是否合并。不要直接覆盖上游文件，也不要因为一次同步而删除本项目新增目录。每次同步后至少运行 SVG 转 PPTX、PPTX 结构检查和 Golden Deck 回归。

## 4. 内核边界

`ppt-master` 是本项目的 PPT 生成与转换内核之一，尤其要保留其 SVG 到可编辑 PPTX 的路线。上游目录结构先保持原样，主要内核仍位于上游已有的 `skills/ppt-master/` 区域。不要把这些脚本复制到多个业务目录。

我们自己的代码通过 `packages/ppt-master-adapter/` 统一调用内核，并在这里固定输入输出契约、版本兼容性检查和错误映射。这样上游更新时，优先检查适配层，而不是让在线聊天、图片生成和部署代码直接依赖上游脚本细节。

目标调用链：

```text
用户聊天
  -> FastPPT 事实与页面合同
  -> 结构化编辑计划
  -> 必要时生成页面视觉图
  -> 生成或更新 SVG
  -> ppt-master SVG/PPTX 内核
  -> PowerPoint 权威渲染与 QA
  -> 浏览器快速预览和最终预览
```

最终 PPTX 是事实来源。Slidev/SVG 只能作为快速预览或 PowerPoint Worker 不可用时的明确回退，不得把回退结果伪装成 PPTX 权威渲染。

## 5. 目录职责

本次只创建目录边界和说明文件，未实现业务代码：

```text
apps/
  web/                         # 在线与本地共用的浏览器界面
  runtime/                     # 本地/服务器运行入口和配置装配

packages/
  fastppt-core/                # 事实锚点、页面合同、Prompt Composer、图片优先流程
  ppt-master-adapter/          # ppt-master 内核适配、转换契约和兼容性检查
  edit-orchestrator/           # 单页、多页、全局聊天编辑计划和版本操作
  preview/                     # Slidev 快速预览、SVG 预览、PPTX 权威预览状态

services/
  api/                         # 登录、项目、页面、聊天和 WebSocket API
  worker/                      # 图片生成、编辑计划执行和 PPTX 任务队列
  render/                      # PowerPoint Windows Worker 和渲染 QA

deploy/
  local/                       # 单机本地运行配置
  server/                      # 小范围多用户公网部署配置

docs/architecture/             # 架构决策记录和接口契约
tests/                         # 单元、集成、浏览器和 Golden Deck 测试
```

## 6. 必须保留的 FastPPT 能力

后续实现不得因为采用 `ppt-master` 而丢弃以下能力：

1. 事实锚点、页面合同和内容保护。
2. 服务端拼装的高质量提示词，而不是把用户原话直接发送给模型。
3. 先生成或确认视觉页面图，再转换为可编辑 PPTX。
4. 文本、基础形状、线条和允许的图标尽量保持原生或矢量可编辑。
5. 成本/Goal 预留、版本、回滚、失败恢复和审计。
6. SVG 质量检查、PPTX 静态检查和 PowerPoint 渲染检查。

复杂图表、流程图和结构化重绘暂不做特殊支持；遇到这类要求时必须明确提示限制，不得用整页图片掩盖可编辑性不足。

## 7. 本地与服务器共用一套代码

`main` 同时支持两种运行模式，不通过长期分支区分：

- 本地模式：本地文件工作区、本地 Gateway、本地队列和可用的 PowerPoint Worker。
- 服务器模式：认证、项目隔离、API、队列、对象存储、模型中转站和 PowerPoint Render Worker。

两种模式必须共用页面模型、编辑计划、FastPPT Core、ppt-master Adapter、预览协议和 QA。差异通过配置、依赖注入和部署文件表达。浏览器不得持有模型 API Key、PowerPoint 凭证或中转站密钥。

仓库代码、配置、测试和文档不得硬编码任何开发者的盘符、用户目录或个人工作区路径。文件位置必须通过仓库相对路径、环境变量、配置项或部署挂载点表达；示例配置只提交脱敏的 `.env.example`，真实密钥和运行数据必须由 `.gitignore` 排除。

## 8. 推荐实施顺序

1. 读取并精读上游 `skills/ppt-master/` 的 SVG、PPTX、质量检查和现有工作流，不先改核心脚本。
2. 在 `ppt-master-adapter` 中建立最小、可测试的 SVG 到 PPTX 调用契约。
3. 在 `fastppt-core` 中恢复事实锚点、页面合同、Prompt Composer 和图片 provenance。
4. 建立统一页面/版本模型和本地运行入口。
5. 实现单页聊天即时修改，再实现多页和全局修改确认。
6. 接入服务器 API、队列、对象存储、自建中转站和 PowerPoint Render Worker。
7. 用 Golden Deck 验证快速预览、PPTX 权威渲染、可编辑性和失败恢复。

每一步都要保持 `main` 可运行。不要为了赶进度把旧 Skill 目录、学生项目 Gateway 或整页图片方案直接塞进主线。

## 9. 完成前禁止事项

- 不创建 `FastPPT-Online` 平行仓库。
- 不把 `FastPPT-legacy` 的 `skill` 分支推送或合并到本仓库。
- 不删除或覆盖 `ppt-master` 的 `LICENSE`、版权声明和来源记录。
- 不把 Codex App、Skill、MCP、Harness 或本地 Gateway 作为线上生产依赖。
- 不把 Slidev/SVG 快速预览宣称为 PPTX 已通过权威渲染。
- 不用整页 raster 图片作为最终可编辑 PPTX 的替代品。
- 不在没有测试和适配层的情况下大规模改写 `ppt-master` 内核。
