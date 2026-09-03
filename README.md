# FastPPT

FastPPT 是一个本地运行的 AI 演示文稿工作台。它把主题研究、素材导入、内容规划、SVG 页面生成、修改审阅、版本管理、质量检查和 PPTX 导出整合到浏览器中。

生成结果以可编辑的 SVG 和 PowerPoint 原生对象为目标。底层演示文稿工作流与转换工具来自仓库内的 [PPT Master](./skills/ppt-master/SKILL.md)。

## 主要能力

- 从主题或本地素材创建演示文稿规划。
- 使用 Codex 或 Claude 执行规划、生成与修改任务。
- 实时查看页面缩略图、SVG 画布和生成中的 staging 版本。
- 按元素、区域、单页、多页或整套演示文稿发起修改。
- 查看修改前后差异，并在提交前进行检查。
- 支持页面撤销、重做、版本历史和导出历史。
- 管理讲稿、项目记忆和受限附属文件。
- 通过项目列表创建、打开和切换演示文稿。
- 项目显示名称允许重复，每个项目使用独立 ID，并记录备注、创建时间和最近更新时间。
- 项目工作台使用 `/projects/:projectId` 路由，可直接刷新和收藏。
- Agent 支持联网研究、开放许可图片搜索、图片下载、素材检查和 SVG/PPTX 图片插入。

FastPPT 不保存模型 API Key，Codex 与 Claude 通过各自本地 SDK 的凭据和运行环境接入。

## 环境要求

- Node.js 22 或更高版本
- pnpm 10
- Python 3.10 或更高版本
- 可选：已配置的 Codex 或 Claude 本地环境

## 安装

```bash
pnpm install
```

同步 Python/PPT 依赖（推荐使用 `uv`）：

```bash
uv sync
uv run python skills/ppt-master/scripts/project_manager.py --help
```

图片与网页素材会先落地到项目目录，再作为可编辑图片对象写入 PPTX：

```bash
uv run python skills/ppt-master/scripts/source_to_md.py <URL>
uv run python skills/ppt-master/scripts/image_search.py --query "关键词" --filename hero.jpg -o <project_path>/images
uv run python skills/ppt-master/scripts/analyze_images.py <project_path>/images
```

来源和许可记录在项目的 `image_sources.json` 中。完整依赖及 PPT Master 工作流说明见[中文快速开始](./docs/zh/getting-started.md)和[PPT Master 技能入口](./skills/ppt-master/SKILL.md)。

## 启动

启动 FastPPT，并自动打开最近使用的项目：

```bash
pnpm studio
```

启动指定项目：

```bash
pnpm studio projects/example_20260902
```

指定监听端口：

```bash
pnpm studio projects/example_20260902 6070
```

通过命令行创建并启动项目：

```bash
pnpm studio --new example
```

默认访问地址为 <http://127.0.0.1:6070>。项目列表位于 `/`，具体演示文稿位于 `/projects/:projectId`。

也可以直接在项目列表中点击“新建演示文稿”。FastPPT 会创建带日期后缀的项目目录，然后等待新项目服务就绪后再跳转。

## 基本流程

1. 新建或打开一个演示文稿项目。
2. 输入主题，并按需上传素材或填写项目内相对路径。
3. 生成并确认内容规划。
4. 生成整套页面，在画布和版本面板查看结果。
5. 通过对话面板提交局部或整套修改任务。
6. 运行质量检查并导出 PPTX。

项目文件默认保存在 `projects/`。正式 SVG、生成中的 staging 文件、讲稿、版本记录和导出文件彼此隔离，失败任务不会覆盖已提交版本。

## 开发与验证

```bash
pnpm studio:check
pnpm studio:web:build
pnpm studio:test
git diff --check
```

前端位于 `skills/ppt-master/studio-web/`，Fastify 服务位于 `skills/ppt-master/studio-ts/`。当前实施状态和验收映射见 [FastPPT 实施状态](./docs/zh/project-studio-status.md)。

## 项目结构

```text
skills/ppt-master/studio-web/   FastPPT React 前端
skills/ppt-master/studio-ts/    FastPPT 服务与作业编排
skills/ppt-master/scripts/      PPT Master 确定性工具
skills/ppt-master/workflows/    演示文稿工作流规范
projects/                       本地演示文稿项目
docs/zh/                        中文文档
```

## 安全边界

- 服务仅监听 `127.0.0.1`。
- 项目切换仅允许访问 `projects/` 下的同级安全目录。
- 上传、附件、SVG、导出文件和附属文件均执行路径校验。
- 修改任务先写入 staging，通过检查后才提交正式文件。
- 外部修改引起版本冲突时返回冲突提示，不静默覆盖。

## 许可证与归属

仓库内 PPT Master 工作流及其工具遵循对应目录声明的许可证和版权信息。新增的 FastPPT 工作台代码以仓库许可证为准。
