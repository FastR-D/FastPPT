# FastPPT v1.1.0

FastPPT 是一个同时支持本机部署和服务器部署的 AI 演示文稿生产与修改系统。
它通过页面合同、事实来源、不可变版本、任务和 QA 记录保证过程可追溯，并通过
内置的 `ppt-master` 转换内核导出尽量原生可编辑的 PPTX。

FastPPT 是独立应用，不是 Codex Skill 或 Claude Skill。Claude Code SDK 与
Codex SDK 位于统一 Agent Harness 之后，可以通过服务端配置切换 Agent、模型、
官方接口和兼容的 HTTPS 中转站。浏览器不会接收模型密钥、磁盘路径或对象存储 Key。

## 本机运行

需要 Python 3.11 及以上版本、Node.js 18 及以上版本和 Windows PowerShell。

```powershell
.\deploy\local\install.ps1
.\deploy\local\start.ps1
```

然后打开 <http://127.0.0.1:43110>。本机模式默认只监听回环地址，使用 SQLite、
私有文件 Artifact Store 和持久本地队列。

```powershell
.\deploy\local\status.ps1
.\deploy\local\stop.ps1
```

## 服务器部署

服务器模式使用同一套产品代码，并强制要求 PostgreSQL、S3 兼容对象存储、会话
认证、持久 Worker、可信 CORS 来源和真实 Agent/模型配置。部署说明见
[`deploy/server/README.md`](deploy/server/README.md)。PowerPoint 权威渲染由独立
Windows Worker 提供；未连接该 Worker 时，界面和导出报告会明确显示降级状态。

## 内核边界

上游 `ppt-master` 已集中到 `kernel/ppt-master/upstream`，FastPPT 业务代码只能
通过 `packages/ppt-master-adapter` 调用。`kernel/ppt-master/UPSTREAM.json` 固定
来源和提交，`sync.py` 只接受精确提交进行受控更新。旧上游画廊和仓库级参考资产
保留在 `kernel/ppt-master/upstream-repository`，不再散落在产品根目录。

项目只在 <https://github.com/FastR-D/FastPPT> 的 `main` 开发。产品版本统一为
`v1.1.0`，技术清单版本统一为 `1.1.0`。

CI 使用真实 PostgreSQL 和 MinIO 启动两个独立 Runtime，验证跨实例元数据、S3
Artifact、过期任务租约恢复、异步文档解析、代表页确认、异步导出和严格 SVG QA。
发布门禁与本机验证证据沿用 v1.0.0 基线；v1.1.0 另增加 Agent/Image 合同、React 工作台和 macOS 实验性脚本。
