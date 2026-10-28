import { basename } from 'node:path'

import { ManagedSkillInstaller } from '@fastppt/fastppt-skill'
import { loadThemeRegistry } from '@fastppt/theme-registry'
import { WorkspaceService } from '@fastppt/workspace'

import { GatewayBrowserCaptureDelegate } from './gateway-delegate.js'
import { createFastPptMcpServer, FastPptMcpService } from './server.js'

/** Shared core for the CLI and MCP: identical schemas, file policy and delegates. */
export async function createFastPptRuntime(options: {
  workspaceRoot: string
  themesRoot: string
  commonSkillRoot: string
  extractorPath: string
}) {
  const [workspace, registry] = await Promise.all([
    WorkspaceService.create(options.workspaceRoot),
    loadThemeRegistry(options.themesRoot),
  ])
  const delegate = new GatewayBrowserCaptureDelegate(workspace.root)
  const service = new FastPptMcpService({
    ...options,
    workspace,
    registry,
    workspaceName: basename(workspace.root),
    browserCapture: delegate,
    imageProduction: delegate,
  })
  const skills = new ManagedSkillInstaller({
    workspaceRoot: workspace.root,
    commonSkillRoot: options.commonSkillRoot,
    registry,
  })
  return { service, server: createFastPptMcpServer(service), skills }
}
