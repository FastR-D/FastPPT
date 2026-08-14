import { z } from 'zod'

export { HtmlDeckSnapshotSchema as SlidewaveSnapshotSchema } from '@fastppt/slidewave/snapshot'
export type { HtmlDeckSnapshot as SlidewaveSnapshot } from '@fastppt/slidewave/snapshot'

export const WorkspaceInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  readOnly: z.boolean(),
  startedAt: z.iso.datetime(),
})

export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>

export const ComponentHealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable']),
  message: z.string().optional(),
})

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  components: z.record(z.string(), ComponentHealthSchema).optional(),
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    retryable: z.boolean(),
    requestId: z.string(),
  }),
})

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>

export const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    path: z.string(),
    name: z.string(),
    type: z.enum(['file', 'directory']),
    size: z.number().int().nonnegative().optional(),
    modifiedAt: z.iso.datetime().optional(),
    children: z.array(FileNodeSchema).optional(),
  }),
)

export interface FileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number | undefined
  modifiedAt?: string | undefined
  children?: readonly FileNode[] | undefined
}

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  revision: z.string().min(1),
  size: z.number().int().nonnegative(),
  modifiedAt: z.iso.datetime(),
})

export type FileContent = z.infer<typeof FileContentSchema>

export const MarkdownFormatResultSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  revision: z.string().min(1),
  changed: z.boolean(),
  dryRun: z.boolean(),
  written: z.boolean(),
})
export type MarkdownFormatResult = z.infer<typeof MarkdownFormatResultSchema>

export const WriteFileRequestSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  expectedRevision: z.string().min(1).optional(),
})

export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>

export const WorkspaceImageAssetSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
})
export type WorkspaceImageAsset = z.infer<typeof WorkspaceImageAssetSchema>

export const UploadWorkspaceImageSchema = z.object({
  name: z.string().min(1).max(255),
  mediaType: WorkspaceImageAssetSchema.shape.mediaType,
  base64: z
    .string()
    .min(1)
    .max(14 * 1024 * 1024),
})
export type UploadWorkspaceImage = z.infer<typeof UploadWorkspaceImageSchema>

export const WorkspaceFileEventSchema = z.object({
  type: z.enum(['added', 'changed', 'removed', 'renamed']),
  path: z.string(),
  previousPath: z.string().optional(),
  isDirectory: z.boolean(),
})

export type WorkspaceFileEvent = z.infer<typeof WorkspaceFileEventSchema>

export const ClientSubscriptionSchema = z.object({
  type: z.literal('subscribe'),
  topics: z.array(z.string().min(1)).max(100),
})

export const ServerEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime(),
  topic: z.string(),
  type: z.string(),
  data: z.unknown(),
})

export type ServerEvent = z.infer<typeof ServerEventSchema>

export const SlidevErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  output: z.array(z.string()).max(100).optional(),
})

export type SlidevError = z.infer<typeof SlidevErrorSchema>

export const SlidevProcessStateSchema = z.object({
  deckId: z.string().min(1),
  pid: z.number().int().positive().optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  status: z.enum(['stopped', 'starting', 'ready', 'restarting', 'failed']),
  previewUrl: z.url().optional(),
  startedAt: z.iso.datetime().optional(),
  lastError: SlidevErrorSchema.optional(),
})

export type SlidevProcessState = z.infer<typeof SlidevProcessStateSchema>

export const ThemeLayoutSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

export const ThemeFeatureSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
})

export const ThemeSummarySchema = z.object({
  themeId: z.string(),
  packageName: z.string(),
  displayName: z.string(),
  version: z.string(),
  description: z.string(),
  repositoryUrl: z.url(),
  skillId: z.string(),
  skillVersion: z.string(),
  layouts: z.array(ThemeLayoutSummarySchema),
  defaultAspectRatio: z.string().optional(),
  supportedFeatures: z.array(ThemeFeatureSummarySchema),
  registryVersion: z.string(),
  available: z.boolean(),
})

export type ThemeSummary = z.infer<typeof ThemeSummarySchema>

export const ThemeSkillDocumentSchema = z.object({
  themeId: z.string(),
  skillId: z.string(),
  version: z.string(),
  fileName: z.literal('SKILL.md'),
  content: z.string(),
})

export type ThemeSkillDocument = z.infer<typeof ThemeSkillDocumentSchema>

export const HarnessKindSchema = z.enum(['claude', 'codex'])
export type HarnessKind = z.infer<typeof HarnessKindSchema>

export const ManagedInstallStateSchema = z.enum([
  'missing',
  'installed',
  'update-available',
  'conflict',
  'disabled',
])

export const SkillInstallStatusSchema = z.object({
  harness: HarnessKindSchema,
  skillId: z.string().min(1),
  kind: z.enum(['base', 'theme']),
  themeId: z.string().min(1).optional(),
  expectedVersion: z.string().min(1),
  installedVersion: z.string().min(1).optional(),
  state: ManagedInstallStateSchema,
  targetPath: z.string().min(1),
  managed: z.boolean(),
  message: z.string().optional(),
})
export type SkillInstallStatus = z.infer<typeof SkillInstallStatusSchema>

export const ThemeSkillStatusSchema = z.object({
  harness: HarnessKindSchema,
  themeId: z.string().min(1),
  skillId: z.string().min(1),
  version: z.string().min(1),
  base: SkillInstallStatusSchema,
  theme: SkillInstallStatusSchema,
  available: z.boolean(),
})
export type ThemeSkillStatus = z.infer<typeof ThemeSkillStatusSchema>

export const McpConfigStatusSchema = z.object({
  harness: HarnessKindSchema,
  state: z.enum(['missing', 'configured', 'pending-trust', 'conflict']),
  configPath: z.string().min(1),
  managed: z.boolean(),
  message: z.string().optional(),
})
export type McpConfigStatus = z.infer<typeof McpConfigStatusSchema>

export const DeckSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  entryFile: z.string().min(1),
  themeId: z.string().optional(),
  revision: z.string().min(1),
  modifiedAt: z.iso.datetime(),
})

export type DeckSummary = z.infer<typeof DeckSummarySchema>

export const CreateExportRequestSchema = z.object({
  format: z.literal('editable-pptx'),
  outputName: z.string().min(1).max(160),
  /** Require an explicit visual confirmation before the export is published. */
  review: z.boolean().optional(),
})
export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>

export const ReviewExportRequestSchema = z.object({
  approved: z.boolean(),
})

export const ImportPptxThemeRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  dataBase64: z.string().min(1),
  themeName: z.string().min(1).max(64).optional(),
})
export type ImportPptxThemeRequest = z.infer<typeof ImportPptxThemeRequestSchema>

export const ImportPptxThemeResultSchema = z.object({
  themeId: z.string().min(1),
  displayName: z.string().min(1),
  packageName: z.string().min(1),
  skillId: z.string().min(1),
  version: z.string().min(1),
  slug: z.string().min(1),
  /** True when a harness design session is enriching the theme in the background. */
  designing: z.boolean(),
})
export type ImportPptxThemeResult = z.infer<typeof ImportPptxThemeResultSchema>

export const ImportPptxThemeStageSchema = z.enum([
  'extracting',
  'designing',
  'syncing',
  'validating',
  'ready',
  'failed',
])
export type ImportPptxThemeStage = z.infer<typeof ImportPptxThemeStageSchema>

export const ImportPptxThemeStatusSchema = z.object({
  themeId: z.string().min(1),
  stage: ImportPptxThemeStageSchema,
  designing: z.boolean(),
  layouts: z.array(z.string()),
  components: z.array(z.string()),
  message: z.string().min(1),
  error: z.string().optional(),
})
export type ImportPptxThemeStatus = z.infer<typeof ImportPptxThemeStatusSchema>

export const ExportWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  elementId: z.string().optional(),
})
export type ExportWarning = z.infer<typeof ExportWarningSchema>

export const ExportJobStateSchema = z.enum([
  'queued',
  'running',
  'review-required',
  'completed',
  'failed',
  'cancelled',
])
export type ExportJobState = z.infer<typeof ExportJobStateSchema>

export const ExportQaIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  slide: z.number().int().positive().optional(),
})
export type ExportQaIssue = z.infer<typeof ExportQaIssueSchema>

export const ExportQaReportSchema = z.object({
  ok: z.boolean(),
  slideCount: z.number().int().nonnegative(),
  issues: z.array(ExportQaIssueSchema),
})
export type ExportQaReport = z.infer<typeof ExportQaReportSchema>

export const ExportJobSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  format: z.literal('editable-pptx'),
  outputName: z.string().min(1),
  status: ExportJobStateSchema,
  phase: z.string().min(1),
  progress: z.number().min(0).max(100),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  warnings: z.array(ExportWarningSchema),
  slideCount: z.number().int().nonnegative().optional(),
  capturedSlideCount: z.number().int().nonnegative().optional(),
  elementCount: z.number().int().nonnegative().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      logs: z.array(z.string()).max(100).optional(),
    })
    .optional(),
  downloadUrl: z.string().min(1).optional(),
  qa: ExportQaReportSchema.optional(),
})
export type ExportJob = z.infer<typeof ExportJobSchema>

export const BrowserOverflowResultSchema = z.object({
  inspectionAvailable: z.literal(true),
  overflow: z.boolean(),
  slide: z.number().int().positive(),
  slideCount: z.number().int().nonnegative(),
  viewport: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  overflowBy: z.object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
  }),
  elements: z.array(
    z.object({
      selector: z.string(),
      text: z.string().optional(),
      overflow: z.object({
        top: z.number().nonnegative(),
        right: z.number().nonnegative(),
        bottom: z.number().nonnegative(),
        left: z.number().nonnegative(),
      }),
    }),
  ),
})
export type BrowserOverflowResult = z.infer<typeof BrowserOverflowResultSchema>

export const BrowserInspectionJobSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().min(1),
  slide: z.number().int().positive(),
  status: z.enum(['queued', 'completed', 'failed']),
  createdAt: z.iso.datetime(),
  result: BrowserOverflowResultSchema.optional(),
  error: z.string().optional(),
})
export type BrowserInspectionJob = z.infer<typeof BrowserInspectionJobSchema>

export const HarnessCapabilitiesSchema = z.object({
  sessionHistory: z.boolean(),
  sessionFork: z.boolean(),
  approvals: z.boolean(),
  commandExecution: z.boolean(),
  fileEdits: z.boolean(),
  mcp: z.boolean(),
  skillDiscovery: z.boolean(),
  perRunSkillInvocation: z.boolean(),
  skillInvocationObservation: z.boolean(),
  imageInput: z.boolean(),
  structuredEvents: z.boolean(),
})
export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>

export const HarnessStatusSchema = z.object({
  kind: HarnessKindSchema,
  status: z.enum(['available', 'degraded', 'unavailable']),
  version: z.string().optional(),
  verifiedVersionRange: z.string().optional(),
  compatible: z.boolean(),
  capabilities: HarnessCapabilitiesSchema,
  message: z.string().optional(),
})
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>

export const SessionSummarySchema = z.object({
  id: z.string().min(1),
  harness: HarnessKindSchema,
  title: z.string().nullable(),
  preview: z.string(),
  cwd: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(['idle', 'running', 'waiting-approval', 'failed']),
})
export type SessionSummary = z.infer<typeof SessionSummarySchema>

export const UnifiedMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  createdAt: z.iso.datetime().optional(),
  providerPayload: z.unknown().optional(),
})
export type UnifiedMessage = z.infer<typeof UnifiedMessageSchema>

export const UnifiedSessionSchema = z.object({
  summary: SessionSummarySchema,
  messages: z.array(UnifiedMessageSchema),
})
export type UnifiedSession = z.infer<typeof UnifiedSessionSchema>

export const SessionPageSchema = z.object({
  data: z.array(SessionSummarySchema),
  nextCursor: z.string().nullable(),
})
export type SessionPage = z.infer<typeof SessionPageSchema>

export const AgentEventTypeSchema = z.enum([
  'run.started',
  'skill.discovery.confirmed',
  'skill.invocation.requested',
  'skill.invocation.observed',
  'skill.invocation.unknown',
  'skill.invocation.failed',
  'assistant.delta',
  'assistant.message',
  'reasoning.delta',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'command.started',
  'command.output',
  'command.completed',
  'file.change.proposed',
  'file.changed',
  'approval.requested',
  'approval.resolved',
  'run.completed',
  'run.cancelled',
  'run.failed',
  'harness.disconnected',
])

export const UnifiedAgentEventSchema = z.object({
  eventId: z.string().min(1),
  sequence: z.number().int().positive(),
  harness: HarnessKindSchema,
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  themeId: z.string().optional(),
  themeSkillId: z.string().optional(),
  themeSkillVersion: z.string().optional(),
  timestamp: z.iso.datetime(),
  type: AgentEventTypeSchema,
  data: z.unknown(),
  providerPayload: z.unknown().optional(),
})
export type UnifiedAgentEvent = z.infer<typeof UnifiedAgentEventSchema>

export const RunAuditRecordSchema = z.object({
  runId: z.string().min(1),
  harness: HarnessKindSchema,
  sessionId: z.string().min(1),
  themeId: z.string().nullable(),
  themeSkillId: z.string().nullable(),
  themeSkillVersion: z.string().nullable(),
  registryVersion: z.string().min(1),
  skillResolutionStatus: z.enum(['resolved', 'unknown']),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  invocationStatus: z.enum([
    'not-requested',
    'requested',
    'observed',
    'unknown',
    'failed',
  ]),
  invocationMechanism: z.string().nullable(),
  observationEvidence: z.unknown().nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  events: z.array(UnifiedAgentEventSchema),
})
export type RunAuditRecord = z.infer<typeof RunAuditRecordSchema>

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  harness: HarnessKindSchema,
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  kind: z.enum(['command', 'file-change']),
  title: z.string().min(1),
  reason: z.string().nullable(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  affectedFiles: z.array(z.string().min(1)).max(100).default([]),
  providerPayload: z.unknown(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

export const ApprovalDecisionSchema = z.enum([
  'approve',
  'reject',
  'approve-for-session',
])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

export const ApplicationStateSchema = z.object({
  recentHarness: HarnessKindSchema.optional(),
  recentSession: z
    .object({
      harness: HarnessKindSchema,
      sessionId: z.string().min(1),
    })
    .optional(),
  recentTheme: z.string().min(1).optional(),
  pendingApprovals: z.array(ApprovalRequestSchema),
  pendingBrowserExports: z.array(ExportJobSchema).default([]),
  pendingBrowserInspections: z.array(BrowserInspectionJobSchema).default([]),
})
export type ApplicationState = z.infer<typeof ApplicationStateSchema>

export const CreateSessionRequestSchema = z.object({
  harness: HarnessKindSchema,
  cwd: z.string().min(1),
  title: z.string().min(1).optional(),
})

export const UpdateSessionAliasRequestSchema = z.object({
  alias: z.string().trim().min(1).max(120),
})

export const SendMessageRequestSchema = z.object({
  content: z.string().min(1),
  themeId: z.string().min(1),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image']),
        path: z.string().min(1),
      }),
    )
    .default([]),
})

export const ApprovalDecisionRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
})

export const IconCollectionSummarySchema = z.object({
  prefix: z.string(),
  name: z.string(),
  total: z.number().int().nonnegative(),
})

export type IconCollectionSummary = z.infer<typeof IconCollectionSummarySchema>

export const IconSearchResultSchema = z.object({
  prefix: z.string(),
  collection: z.string(),
  name: z.string(),
  category: z.string().optional(),
  svg: z.string(),
})

export type IconSearchResult = z.infer<typeof IconSearchResultSchema>

export const IconSearchResponseSchema = z.object({
  query: z.string(),
  limit: z.number().int().nonnegative(),
  results: z.array(IconSearchResultSchema),
})

export type IconSearchResponse = z.infer<typeof IconSearchResponseSchema>

export const API_VERSION = 'v1' as const
