import {
  ApiErrorBodySchema,
  ApplicationStateSchema,
  BrowserInspectionJobSchema,
  DeckSummarySchema,
  ExportJobSchema,
  FileContentSchema,
  FileNodeSchema,
  HarnessStatusSchema,
  McpConfigStatusSchema,
  RunAuditRecordSchema,
  MarkdownFormatResultSchema,
  SessionPageSchema,
  SkillInstallStatusSchema,
  SlidevProcessStateSchema,
  SlidewaveSnapshotSchema,
  ThemeSummarySchema,
  ThemeSkillDocumentSchema,
  UnifiedSessionSchema,
  WorkspaceInfoSchema,
  WorkspaceImageAssetSchema,
} from '@fastppt/protocol'
import { z } from 'zod'

import type {
  FileContent,
  FileNode,
  DeckSummary,
  SlidevProcessState,
  ThemeSummary,
  ThemeSkillDocument,
  WorkspaceInfo,
  WorkspaceImageAsset,
  WriteFileRequest,
  ApprovalDecision,
  ApplicationState,
  HarnessStatus,
  HarnessKind,
  SessionPage,
  UnifiedSession,
  SkillInstallStatus,
  McpConfigStatus,
  RunAuditRecord,
  MarkdownFormatResult,
  ExportJob,
  BrowserInspectionJob,
} from '@fastppt/protocol'

// 本地 gateway 固定跑在 http://127.0.0.1:4317(见 @fastppt/config 的 loadGatewayConfig)。
// 部署页(https)访问环回地址属于浏览器允许的 potentially-trustworthy 请求,无需域名/证书配置。
const GATEWAY_URL = 'http://127.0.0.1:4317'

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown
}

export function resolveGatewayUrl(): string {
  return GATEWAY_URL
}

export function useGatewayClient() {
  const baseUrl = resolveGatewayUrl()

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...init.headers,
      },
    })
    const payload = await readJson(response)
    if (!response.ok) {
      const body = ApiErrorBodySchema.safeParse(payload)
      const error = new Error(
        body.success
          ? body.data.error.message
          : `Gateway request failed (${response.status})`,
      )
      Object.assign(error, {
        code: body.success ? body.data.error.code : 'INTERNAL_ERROR',
        status: response.status,
      })
      throw error
    }
    return schema.parse(payload)
  }

  function getWorkspace(signal?: AbortSignal): Promise<WorkspaceInfo> {
    return request('/api/v1/workspace', WorkspaceInfoSchema, {
      ...(signal ? { signal } : {}),
    })
  }

  function getApplicationState(
    signal?: AbortSignal,
  ): Promise<ApplicationState> {
    return request('/api/v1/application-state', ApplicationStateSchema, {
      ...(signal ? { signal } : {}),
    })
  }

  function listFiles(signal?: AbortSignal): Promise<FileNode[]> {
    return request('/api/v1/workspace/files', z.array(FileNodeSchema), {
      ...(signal ? { signal } : {}),
    })
  }

  function readFile(path: string, signal?: AbortSignal): Promise<FileContent> {
    return request(
      `/api/v1/workspace/files/content?path=${encodeURIComponent(path)}`,
      FileContentSchema,
      { ...(signal ? { signal } : {}) },
    )
  }

  function writeFile(input: WriteFileRequest): Promise<FileContent> {
    return request('/api/v1/workspace/files/content', FileContentSchema, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async function uploadImageAsset(file: File): Promise<WorkspaceImageAsset> {
    const dataUrl = await new Promise<string>((resolveData, rejectData) => {
      const reader = new FileReader()
      reader.addEventListener('load', () =>
        typeof reader.result === 'string'
          ? resolveData(reader.result)
          : rejectData(new Error('无法读取图片附件')),
      )
      reader.addEventListener('error', () =>
        rejectData(reader.error ?? new Error('无法读取图片附件')),
      )
      reader.readAsDataURL(file)
    })
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return request(
      '/api/v1/workspace/assets/images',
      WorkspaceImageAssetSchema,
      {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          mediaType: file.type,
          base64,
        }),
      },
    )
  }

  function listThemes(signal?: AbortSignal): Promise<ThemeSummary[]> {
    return request('/api/v1/themes', z.array(ThemeSummarySchema), {
      ...(signal ? { signal } : {}),
    })
  }

  function getThemeSkill(themeId: string): Promise<ThemeSkillDocument> {
    return request(
      `/api/v1/themes/${encodeURIComponent(themeId)}/skill`,
      ThemeSkillDocumentSchema,
    )
  }

  function listDecks(signal?: AbortSignal): Promise<DeckSummary[]> {
    return request('/api/v1/decks', z.array(DeckSummarySchema), {
      ...(signal ? { signal } : {}),
    })
  }

  function previewAction(
    deckId: string,
    action: 'start' | 'restart' | 'stop',
  ): Promise<SlidevProcessState> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/preview/${action}`,
      SlidevProcessStateSchema,
      { method: 'POST' },
    )
  }

  function getPreviewStatus(deckId: string): Promise<SlidevProcessState> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/preview/status`,
      SlidevProcessStateSchema,
    )
  }

  function formatDeck(
    deckId: string,
    expectedRevision?: string,
  ): Promise<MarkdownFormatResult> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/format`,
      MarkdownFormatResultSchema,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(expectedRevision ? { expectedRevision } : {}),
        }),
      },
    )
  }

  function createExport(
    deckId: string,
    outputName: string,
  ): Promise<ExportJob> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/exports`,
      ExportJobSchema,
      {
        method: 'POST',
        body: JSON.stringify({ format: 'editable-pptx', outputName }),
      },
    )
  }

  function getInspection(inspectionId: string): Promise<BrowserInspectionJob> {
    return request(
      `/api/v1/inspections/${encodeURIComponent(inspectionId)}`,
      BrowserInspectionJobSchema,
    )
  }

  function submitInspectionResult(
    inspectionId: string,
    result: unknown,
  ): Promise<BrowserInspectionJob> {
    return request(
      `/api/v1/inspections/${encodeURIComponent(inspectionId)}/result`,
      BrowserInspectionJobSchema,
      {
        method: 'POST',
        body: JSON.stringify(result),
      },
    )
  }

  function getExport(exportId: string): Promise<ExportJob> {
    return request(
      `/api/v1/exports/${encodeURIComponent(exportId)}`,
      ExportJobSchema,
    )
  }

  function submitExportSnapshot(
    exportId: string,
    snapshot: unknown,
  ): Promise<ExportJob> {
    return request(
      `/api/v1/exports/${encodeURIComponent(exportId)}/snapshot`,
      ExportJobSchema,
      {
        method: 'POST',
        body: JSON.stringify(SlidewaveSnapshotSchema.parse(snapshot)),
      },
    )
  }

  function reportExportCaptureProgress(
    exportId: string,
    completed: number,
    total: number,
  ): Promise<ExportJob> {
    return request(
      `/api/v1/exports/${encodeURIComponent(exportId)}/capture-progress`,
      ExportJobSchema,
      {
        method: 'POST',
        body: JSON.stringify({ completed, total }),
      },
    )
  }

  function cancelExport(exportId: string): Promise<ExportJob> {
    return request(
      `/api/v1/exports/${encodeURIComponent(exportId)}/cancel`,
      ExportJobSchema,
      { method: 'POST' },
    )
  }

  async function downloadExport(job: ExportJob): Promise<void> {
    const response = await fetch(
      `${baseUrl}/api/v1/exports/${encodeURIComponent(job.id)}/download`,
    )
    if (!response.ok) {
      const body = ApiErrorBodySchema.safeParse(await readJson(response))
      throw new Error(
        body.success ? body.data.error.message : '导出文件下载失败',
      )
    }
    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = job.outputName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    setTimeout(() => {
      anchor.remove()
      URL.revokeObjectURL(url)
    }, 1000)
  }

  function listHarnesses(signal?: AbortSignal): Promise<HarnessStatus[]> {
    return request('/api/v1/harnesses', z.array(HarnessStatusSchema), {
      ...(signal ? { signal } : {}),
    })
  }

  function getManagedStatus(signal?: AbortSignal): Promise<{
    registryVersion: string
    skills: SkillInstallStatus[]
    mcp: McpConfigStatus[]
  }> {
    return request(
      '/api/v1/managed/status',
      z.object({
        registryVersion: z.string(),
        skills: z.array(SkillInstallStatusSchema),
        mcp: z.array(McpConfigStatusSchema),
      }),
      { ...(signal ? { signal } : {}) },
    )
  }

  function listSessions(
    harness: HarnessKind,
    signal?: AbortSignal,
    cursor?: string,
  ): Promise<SessionPage> {
    const query = new URLSearchParams({ harness })
    if (cursor) query.set('cursor', cursor)
    return request(`/api/v1/sessions?${query.toString()}`, SessionPageSchema, {
      ...(signal ? { signal } : {}),
    })
  }

  function getSession(
    harness: HarnessKind,
    sessionId: string,
  ): Promise<UnifiedSession> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}`,
      UnifiedSessionSchema,
    )
  }

  function createSession(
    harness: HarnessKind,
    title?: string,
  ): Promise<{ sessionId: string }> {
    return request(
      '/api/v1/sessions',
      z.object({ harness: z.literal(harness), sessionId: z.string() }),
      {
        method: 'POST',
        body: JSON.stringify({
          harness,
          ...(title ? { title } : {}),
          cwd: '/',
        }),
      },
    )
  }

  function updateSessionAlias(
    harness: HarnessKind,
    sessionId: string,
    alias: string,
  ): Promise<{ harness: HarnessKind; sessionId: string; alias: string }> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/alias`,
      z.object({
        harness: z.literal(harness),
        sessionId: z.string(),
        alias: z.string(),
      }),
      { method: 'PUT', body: JSON.stringify({ alias }) },
    )
  }

  function resumeSession(
    harness: HarnessKind,
    sessionId: string,
  ): Promise<{ sessionId: string }> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/resume`,
      z.object({
        harness: z.literal(harness),
        sessionId: z.string(),
        cwd: z.string(),
      }),
      { method: 'POST' },
    )
  }

  function forkSession(
    harness: HarnessKind,
    sessionId: string,
  ): Promise<{ harness: HarnessKind; sessionId: string }> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/fork`,
      z.object({ harness: z.literal(harness), sessionId: z.string() }),
      { method: 'POST' },
    )
  }

  function sendSessionMessage(
    harness: HarnessKind,
    sessionId: string,
    content: string,
    themeId: string,
    attachments: readonly WorkspaceImageAsset[],
  ): Promise<{ runId?: string | undefined }> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/messages`,
      z.object({ runId: z.string().optional() }),
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          attachments: attachments.map((attachment) => ({
            type: 'image',
            path: attachment.path,
          })),
          themeId,
        }),
      },
    )
  }

  async function getLatestRunAudit(
    harness: HarnessKind,
    sessionId: string,
  ): Promise<RunAuditRecord | undefined> {
    const response = await fetch(
      `${baseUrl}/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/runs/latest`,
    )
    if (response.status === 204) return undefined
    const payload = await readJson(response)
    if (!response.ok) {
      const body = ApiErrorBodySchema.safeParse(payload)
      throw new Error(
        body.success ? body.data.error.message : '无法读取运行审计记录',
      )
    }
    return RunAuditRecordSchema.parse(payload)
  }

  function cancelSession(
    harness: HarnessKind,
    sessionId: string,
  ): Promise<{ cancelled: boolean }> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/cancel`,
      z.object({ cancelled: z.boolean() }),
      { method: 'POST' },
    )
  }

  function resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<{ resolved: boolean }> {
    return request(
      `/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`,
      z.object({ resolved: z.boolean() }),
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      },
    )
  }

  return {
    getWorkspace,
    getApplicationState,
    listFiles,
    readFile,
    writeFile,
    uploadImageAsset,
    listThemes,
    getThemeSkill,
    listDecks,
    previewAction,
    getPreviewStatus,
    formatDeck,
    createExport,
    getInspection,
    submitInspectionResult,
    getExport,
    submitExportSnapshot,
    reportExportCaptureProgress,
    cancelExport,
    downloadExport,
    listHarnesses,
    getManagedStatus,
    listSessions,
    getSession,
    createSession,
    updateSessionAlias,
    resumeSession,
    forkSession,
    sendSessionMessage,
    getLatestRunAudit,
    cancelSession,
    resolveApproval,
  }
}
