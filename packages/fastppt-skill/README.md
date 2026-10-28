# Managed Skills

启动时只接入基础和通用能力 Skill。注册主题保持 `on-demand` 状态，
创建主题会话、更新会话主题、发送使用主题的消息，或调用 MCP `get_theme_skill`
时，`ensureTheme(harness, themeId)` 才将目标主题接入对应 Harness。

- 同一个安装器串行处理安装，避免同主题的并发调用互相覆盖。
- 热重载更新已经使用过的主题，不安装尚未使用的新主题。
- 启动迁移通过 `reconcile({ unloadThemes: true })` 回收旧的完整主题安装；
  只移除带受管理标记且校验值一致的目录，保留修改过或用户自行创建的内容。
- 已有主题被手动移除时，下次使用会重新接入。
- `themeStatus` 和 `inspect` 只读；状态查询不会触发安装。
