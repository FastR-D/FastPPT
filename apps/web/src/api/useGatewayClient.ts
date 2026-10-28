import {
  PaletteSearchResponseSchema,
  PaletteRecommendationSchema,
  ResourceSearchResultSchema,
  CreativeAnimationSearchSchema,
  CreativeAnimationDetailSchema,
  ResourceDetailSchema,
  ApiErrorBodySchema,
  ApplicationStateSchema,
  BrowserInspectionJobSchema,
  DeckSummarySchema,
  DeckValidationResultSchema,
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
  ThemeRuleApprovalReportSchema,
  ThemeRuleExceptionReviewSchema,
  ThemeRuleExceptionSchema,
  ThemeRuleExceptionContextRequestSchema,
  ApproveThemeRuleExceptionSchema,
  UnifiedSessionSchema,
  WorkspaceInfoSchema,
  WorkspaceImageAssetSchema,
  ImportPptxThemeResultSchema,
  ImportPptxThemeStatusSchema,
  SessionProfileRecordSchema,
  DeckNotesDocumentSchema,
  DeckAnimationsDocumentSchema,
  ExportCapabilityReportSchema,
  CreationWizardSchema,
  ImportAnalysisV1Schema,
  MasterSnapshotV1Schema,
} from '@fastppt/protocol'
import { z } from 'zod'

import type {
  FileContent,
  FileNode,
  DeckSummary,
  DeckValidationResult,
  SlidevProcessState,
  ThemeSummary,
  ThemeSkillDocument,
  ThemeRuleApprovalReport,
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
  ImportPptxThemeResult,
  ImportPptxThemeStatus,
  SessionDeckProfile,
  SessionProfileRecord,
  DeckNotesDocument,
  DeckAnimationsDocument,
  ExportCapabilityReport,
  CreationWizard,
  ImportAnalysisV1,
  MasterSnapshotV1,
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

  function validateDeck(deckId: string): Promise<DeckValidationResult> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/validate`,
      DeckValidationResultSchema,
      { method: 'POST' },
    )
  }

  function reviewRuleExceptions(deckId: string, input: z.input<typeof ThemeRuleExceptionContextRequestSchema>) {
    return request(`/api/v1/decks/${encodeURIComponent(deckId)}/rule-exceptions/review`, ThemeRuleExceptionReviewSchema, { method: 'POST', body: JSON.stringify(ThemeRuleExceptionContextRequestSchema.parse(input)) })
  }
  function approveRuleException(deckId: string, input: z.input<typeof ApproveThemeRuleExceptionSchema>) {
    return request(`/api/v1/decks/${encodeURIComponent(deckId)}/rule-exceptions`, ThemeRuleExceptionSchema, { method: 'POST', body: JSON.stringify(ApproveThemeRuleExceptionSchema.parse(input)) })
  }
  function revokeRuleException(deckId: string, exceptionId: string) {
    return request(`/api/v1/decks/${encodeURIComponent(deckId)}/rule-exceptions/${encodeURIComponent(exceptionId)}/revoke`, ThemeRuleExceptionSchema, { method: 'POST' })
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

  function getNotes(deckId: string): Promise<DeckNotesDocument> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/notes`,
      DeckNotesDocumentSchema,
    )
  }
  function putNotes(
    deckId: string,
    document: DeckNotesDocument,
  ): Promise<DeckNotesDocument> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/notes`,
      DeckNotesDocumentSchema,
      { method: 'PUT', body: JSON.stringify(document) },
    )
  }
  function getAnimations(deckId: string): Promise<DeckAnimationsDocument> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/animations`,
      DeckAnimationsDocumentSchema,
    )
  }
  function putAnimations(
    deckId: string,
    document: DeckAnimationsDocument,
  ): Promise<DeckAnimationsDocument> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/animations`,
      DeckAnimationsDocumentSchema,
      { method: 'PUT', body: JSON.stringify(document) },
    )
  }
  function getExportCapabilities(
    deckId: string,
  ): Promise<ExportCapabilityReport> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/export-capabilities`,
      ExportCapabilityReportSchema,
    )
  }
  function getExportCapabilityHistory(
    deckId: string,
  ): Promise<{
    deckId: string
    savedAt: string | null
    report: ExportCapabilityReport | null
  }> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/export-capabilities/history`,
      z.object({
        deckId: z.string(),
        savedAt: z.string().nullable(),
        report: ExportCapabilityReportSchema.nullable(),
      }),
    )
  }
  function getDeckMaster(deckId: string): Promise<MasterSnapshotV1> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/master`,
      MasterSnapshotV1Schema,
    )
  }
  function createCreationWizard(): Promise<CreationWizard> {
    return request('/api/v1/creation-wizards', CreationWizardSchema, {
      method: 'POST',
      body: '{}',
    })
  }
  function getCreationWizard(id: string): Promise<CreationWizard> {
    return request(
      `/api/v1/creation-wizards/${encodeURIComponent(id)}`,
      CreationWizardSchema,
    )
  }
  function updateCreationWizard(
    id: string,
    input: { currentStep?: string; decision?: unknown },
  ): Promise<CreationWizard> {
    return request(
      `/api/v1/creation-wizards/${encodeURIComponent(id)}/steps`,
      CreationWizardSchema,
      { method: 'PATCH', body: JSON.stringify(input) },
    )
  }
  function commitCreationWizard(id: string): Promise<CreationWizard> {
    return request(
      `/api/v1/creation-wizards/${encodeURIComponent(id)}/commit`,
      CreationWizardSchema,
      { method: 'POST', body: '{}' },
    )
  }
  function validateDiagram(
    document: unknown,
  ): Promise<{ ok: boolean; issues: string[] }> {
    return request(
      '/api/v1/diagrams/validate',
      z.object({ ok: z.boolean(), issues: z.array(z.string()) }),
      { method: 'POST', body: JSON.stringify({ document }) },
    )
  }
  function renderDiagram(document: unknown): Promise<{ svg: string }> {
    return request('/api/v1/diagrams/render', z.object({ svg: z.string() }), {
      method: 'POST',
      body: JSON.stringify({ document }),
    })
  }
  function getDiagram(
    deckId: string,
    diagramId: string,
  ): Promise<Record<string, unknown>> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/diagrams/${encodeURIComponent(diagramId)}`,
      z.record(z.string(), z.unknown()),
    )
  }
  function putDiagram(
    deckId: string,
    diagramId: string,
    document: unknown,
  ): Promise<Record<string, unknown>> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/diagrams/${encodeURIComponent(diagramId)}`,
      z.record(z.string(), z.unknown()),
      { method: 'PUT', body: JSON.stringify({ document }) },
    )
  }
  function insertDiagram(
    deckId: string,
    diagramId: string,
  ): Promise<{ assetPath: string }> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/diagrams/${encodeURIComponent(diagramId)}/insert`,
      z.object({ assetPath: z.string() }),
      { method: 'POST', body: '{}' },
    )
  }
  function initializeDeckIdentities(
    deckId: string,
  ): Promise<{
    deckId: string
    revision: string
    slides: Array<{ slideId: string; anchors: string[] }>
  }> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/identities`,
      z.object({
        deckId: z.string(),
        revision: z.string(),
        slides: z.array(
          z.object({ slideId: z.string(), anchors: z.array(z.string()) }),
        ),
      }),
      { method: 'POST' },
    )
  }
  function getDeckIr(
    deckId: string,
  ): Promise<{
    deckId: string
    revision: string
    motionPreset?: 'static' | 'business' | 'teaching' | 'reveal' | undefined
    slides: unknown[]
  }> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/ir`,
      z.object({
        deckId: z.string(),
        revision: z.string(),
        motionPreset: z
          .enum(['static', 'business', 'teaching', 'reveal'])
          .optional(),
        slides: z.array(z.unknown()),
      }),
    )
  }
  function getThemeImportAnalysis(themeId: string): Promise<ImportAnalysisV1> {
    return request(
      `/api/v1/imports/pptx-theme/${encodeURIComponent(themeId)}/analysis`,
      ImportAnalysisV1Schema,
    )
  }
  function saveThemeImportDecisions(
    themeId: string,
    decisions: unknown[],
  ): Promise<{ themeId: string; decisions: unknown[] }> {
    return request(
      `/api/v1/imports/pptx-theme/${encodeURIComponent(themeId)}/decisions`,
      z.object({ themeId: z.string(), decisions: z.array(z.unknown()) }),
      { method: 'POST', body: JSON.stringify(decisions) },
    )
  }
  function approveThemeImport(
    themeId: string,
  ): Promise<{ themeId: string; approvedAt: string }> {
    return request(
      `/api/v1/imports/pptx-theme/${encodeURIComponent(themeId)}/approve`,
      z.object({ themeId: z.string(), approvedAt: z.string() }),
      { method: 'POST', body: '{}' },
    )
  }
  function getThemeImportRuleReview(themeId: string): Promise<ThemeRuleApprovalReport | null> {
    return request(`/api/v1/imports/pptx-theme/${encodeURIComponent(themeId)}/rule-review`, ThemeRuleApprovalReportSchema.nullable())
  }
  function getPptxImportJob(jobId: string): Promise<unknown> {
    return request(
      `/api/v1/imports/jobs/${encodeURIComponent(jobId)}`,
      z.record(z.string(), z.unknown()),
    )
  }
  function listPptxImportJobs(themeId?: string): Promise<unknown[]> {
    return request(
      `/api/v1/imports/jobs${themeId ? `?themeId=${encodeURIComponent(themeId)}` : ''}`,
      z.array(z.record(z.string(), z.unknown())),
    )
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
    review?: boolean,
    options?: {
      policy?: 'editable' | 'strict-editable' | 'visual-fidelity'
      master?: boolean
      notes?: boolean
      animations?: boolean
      diagrams?: boolean
    },
  ): Promise<ExportJob> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/exports`,
      ExportJobSchema,
      {
        method: 'POST',
        body: JSON.stringify({
          format: 'editable-pptx',
          outputName,
          review,
          options,
        }),
      },
    )
  }

  function retryExport(exportId: string): Promise<ExportJob> {
    return request(
      `/api/v1/exports/${encodeURIComponent(exportId)}/retry`,
      ExportJobSchema,
      { method: 'POST', body: JSON.stringify({}) },
    )
  }

  function reviewExport(
    exportId: string,
    approved: boolean,
  ): Promise<ExportJob> {
    return request(
      `/api/v1/exports/${encodeURIComponent(exportId)}/review`,
      ExportJobSchema,
      { method: 'POST', body: JSON.stringify({ approved }) },
    )
  }

  function importPptxTheme(
    fileName: string,
    dataBase64: string,
    themeName?: string,
    harness?: HarnessKind,
    model?: string,
  ): Promise<ImportPptxThemeResult> {
    return request('/api/v1/imports/pptx-theme', ImportPptxThemeResultSchema, {
      method: 'POST',
      body: JSON.stringify({ fileName, dataBase64, themeName, harness, model }),
    })
  }

  function getThemeImportStatus(
    themeId: string,
  ): Promise<ImportPptxThemeStatus> {
    return request(
      `/api/v1/imports/pptx-theme/${encodeURIComponent(themeId)}`,
      ImportPptxThemeStatusSchema,
    )
  }

  function getInspection(inspectionId: string): Promise<BrowserInspectionJob> {
    return request(
      `/api/v1/inspections/${encodeURIComponent(inspectionId)}`,
      BrowserInspectionJobSchema,
    )
  }

  function createQualityInspection(
    deckId: string,
    slide: number,
  ): Promise<BrowserInspectionJob> {
    return request(
      `/api/v1/decks/${encodeURIComponent(deckId)}/inspections/quality`,
      BrowserInspectionJobSchema,
      { method: 'POST', body: JSON.stringify({ slide, policy: 'standard' }) },
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
    profile: SessionDeckProfile,
    title?: string,
  ): Promise<{ sessionId: string }> {
    return request(
      '/api/v1/sessions',
      z.object({ harness: z.literal(harness), sessionId: z.string() }),
      {
        method: 'POST',
        body: JSON.stringify({
          harness,
          profile,
          ...(title ? { title } : {}),
          cwd: '/',
        }),
      },
    )
  }

  function getSessionProfile(
    harness: HarnessKind,
    sessionId: string,
  ): Promise<SessionProfileRecord> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/profile`,
      SessionProfileRecordSchema,
    )
  }

  function updateSessionProfile(
    harness: HarnessKind,
    sessionId: string,
    profile: SessionDeckProfile,
  ): Promise<SessionProfileRecord> {
    return request(
      `/api/v1/sessions/${harness}/${encodeURIComponent(sessionId)}/profile`,
      SessionProfileRecordSchema,
      { method: 'PUT', body: JSON.stringify(profile) },
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
    model?: string,
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
          ...(model ? { model } : {}),
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

  function getResourceFacets(signal?: AbortSignal) {
    return request('/api/v1/resources/facets', z.object({ sources: z.array(z.object({ path: z.string(), label: z.string(), count: z.number() })) }), signal ? { signal } : {})
  }
  function searchResources(params: { query?: string; kind?: string; density?: string; source?: string; status?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal) {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
    return request(`/api/v1/resources?${search}`, ResourceSearchResultSchema, signal ? { signal } : {})
  }
  function readResource(id: string, signal?: AbortSignal) {
    return request(`/api/v1/resources/${encodeURIComponent(id)}`, ResourceDetailSchema, signal ? { signal } : {})
  }
  function searchCreativeAnimations(params: { query?:string;category?:string;scope?:string;offset?:number;limit?:number }={},signal?:AbortSignal) {
    const search=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)]))
    return request(`/api/v1/animations?${search}`,CreativeAnimationSearchSchema,signal?{signal}:{})
  }
  function readCreativeAnimation(id:string,signal?:AbortSignal){return request(`/api/v1/animations/${encodeURIComponent(id)}`,CreativeAnimationDetailSchema,signal?{signal}:{})}
  return {
    searchPalettes(params: { query?: string; source?: string; kind?: string; count?: number; offset?: number; limit?: number } = {}, signal?: AbortSignal) {
      const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
      return request(`/api/v1/palettes?${search}`, PaletteSearchResponseSchema, signal ? { signal } : {})
    },
    getPaletteFacets(signal?: AbortSignal) {
      return request('/api/v1/palettes/facets', z.object({ total: z.number(), sources: z.array(z.string()), kinds: z.array(z.string()) }), signal ? { signal } : {})
    },
    recommendPalettes(query: string, harness: HarnessKind, signal?: AbortSignal, filters: { source?: string; kind?: string } = {}) {
      return request('/api/v1/palettes/recommend', PaletteRecommendationSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, harness, ...(filters.source ? { source: filters.source } : {}), ...(filters.kind ? { kind: filters.kind } : {}) }), ...(signal ? { signal } : {}) })
    },
    searchCreativeAnimations,
    readCreativeAnimation,
    getResourceFacets,
    searchResources,
    readResource,
    getWorkspace,
    getApplicationState,
    listFiles,
    validateDeck,
    reviewRuleExceptions,
    approveRuleException,
    revokeRuleException,
    readFile,
    writeFile,
    uploadImageAsset,
    listThemes,
    getThemeSkill,
    listDecks,
    getNotes,
    putNotes,
    getAnimations,
    putAnimations,
    getExportCapabilities,
    getExportCapabilityHistory,
    getDeckMaster,
    createCreationWizard,
    getCreationWizard,
    updateCreationWizard,
    commitCreationWizard,
    validateDiagram,
    renderDiagram,
    getDiagram,
    putDiagram,
    insertDiagram,
    getDeckIr,
    initializeDeckIdentities,
    getThemeImportAnalysis,
    saveThemeImportDecisions,
    approveThemeImport,
    getThemeImportRuleReview,
    getPptxImportJob,
    listPptxImportJobs,
    previewAction,
    getPreviewStatus,
    formatDeck,
    createExport,
    reviewExport,
    retryExport,
    importPptxTheme,
    getThemeImportStatus,
    getInspection,
    submitInspectionResult,
    createQualityInspection,
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
    getSessionProfile,
    updateSessionProfile,
    updateSessionAlias,
    resumeSession,
    forkSession,
    sendSessionMessage,
    getLatestRunAudit,
    cancelSession,
    resolveApproval,
  }
}
