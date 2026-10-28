import { z } from 'zod'
import {
  AnimationDocumentV1Schema,
  SpeakerNotesDocumentV1Schema,
  CreationDecisionV1Schema,
  ImportAnalysisV1Schema,
  PptxRenderEvidenceV1Schema,
} from '@fastppt/presentation-ir'

export {
  AnimationDocumentV1Schema,
  SpeakerNotesDocumentV1Schema,
  MasterSnapshotV1Schema,
  NativeMasterLayoutSchema,
  CreationDecisionV1Schema,
  ImportAnalysisV1Schema,
  ImportLayoutCandidateSchema,
  ExportCapabilityReportSchema,
  digest as presentationDigest,
  normalizeAnimation,
  estimateNotesSeconds,
  NarrationProviderSchema,
  NarrationManifestV1Schema,
  NarrationProviderStatusV1Schema,
  cuesToSrt,
} from '@fastppt/presentation-ir'
export type {
  AnimationDocumentV1,
  SpeakerNotesDocumentV1,
  MasterSnapshotV1,
  CreationDecisionV1,
  ImportAnalysisV1,
  ImportLayoutCandidate,
  ExportCapabilityReport,
  NarrationManifestV1,
  NarrationProviderStatusV1,
} from '@fastppt/presentation-ir'

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

export const ArtifactRouteSchema = z.enum([
  'generate',
  'edit-slidev',
  'create-template',
  'fill-native-pptx',
  'enhance-native-pptx',
])
export type ArtifactRoute = z.infer<typeof ArtifactRouteSchema>

export const CommunicationIntentSchema = z.enum([
  'decision',
  'instruction',
  'persuasion',
  'showcase',
  'briefing',
])
export type CommunicationIntent = z.infer<typeof CommunicationIntentSchema>

export const NarrativeModeSchema = z.enum([
  'pyramid',
  'instructional',
  'narrative',
  'showcase',
  'briefing',
])
export type NarrativeMode = z.infer<typeof NarrativeModeSchema>

export const ReviewPolicySchema = z.enum(['fast', 'standard', 'strict'])
export type ReviewPolicy = z.infer<typeof ReviewPolicySchema>

export const SessionConversationModeSchema = z.enum([
  'general',
  'create-slide',
  'edit-deck',
  'edit-page',
])
export type SessionConversationMode = z.infer<
  typeof SessionConversationModeSchema
>

export const SessionThemeSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('registered'), themeId: z.string().min(1) }),
  z.object({ mode: z.literal('preserve-source') }),
])
export type SessionThemeSelection = z.infer<typeof SessionThemeSelectionSchema>

export const PreservationPolicySchema = z.object({
  wording: z.enum(['free', 'preserve']).default('free'),
  pageCount: z.enum(['free', 'preserve']).default('free'),
  pageOrder: z.enum(['free', 'preserve']).default('free'),
  visualStructure: z.enum(['free', 'preserve']).default('free'),
})
export type PreservationPolicy = z.infer<typeof PreservationPolicySchema>

export const SessionDeckProfileSchema = z.object({
  version: z.literal(1),
  conversationMode: SessionConversationModeSchema.default('create-slide'),
  target: z
    .object({
      markdownPath: z.string().min(1).optional(),
      slide: z.number().int().positive().optional(),
    })
    .optional(),
  artifactRoute: ArtifactRouteSchema,
  audience: z.string().trim().min(1).max(160),
  communicationIntent: CommunicationIntentSchema,
  narrativeMode: NarrativeModeSchema,
  language: z.enum(['zh-CN', 'en-US', 'source']),
  durationMinutes: z.number().int().min(1).max(240).optional(),
  theme: SessionThemeSelectionSchema,
  preservation: PreservationPolicySchema,
  reviewPolicy: ReviewPolicySchema,
  creationDecisions: z.array(CreationDecisionV1Schema).optional(),
  deliveryOptions: z
    .object({
      master: z.boolean(),
      notes: z.boolean(),
      animations: z.boolean(),
    })
    .optional(),
})
export type SessionDeckProfile = z.infer<typeof SessionDeckProfileSchema>

export const ManagedInstallStateSchema = z.enum([
  'on-demand',
  'missing',
  'installed',
  'update-available',
  'conflict',
  'disabled',
])

export const SkillInstallStatusSchema = z.object({
  harness: HarnessKindSchema,
  skillId: z.string().min(1),
  kind: z.enum(['base', 'capability', 'theme']),
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

export const ColorPaletteSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/),
  title: z.string(),
  family: z.string(),
  kind: z.enum(['categorical', 'sequential', 'diverging', 'cyclical', 'theme', 'design']),
  colors: z.array(z.string().regex(/^#[0-9A-F]{6}$/)).min(2).max(12),
  source: z.string(),
  sourceUrl: z.string().url(),
  sources: z.array(z.string().url()),
  license: z.string(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  originalColorCount: z.number().int().min(2),
})
export type ColorPalette = z.infer<typeof ColorPaletteSchema>
export const PaletteSearchResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  items: z.array(ColorPaletteSchema),
})
export const PaletteRecommendationSchema = z.object({
  query: z.string(),
  recommendations: z.array(z.object({ palette: ColorPaletteSchema, reason: z.string() })),
})

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

export const ImagePurposeSchema = z.enum(['generate', 'edit', 'variation'])
export type ImagePurpose = z.infer<typeof ImagePurposeSchema>

export const ImageRunStatusSchema = z.enum([
  'draft',
  'candidate-ready',
  'accepted',
  'rejected',
  'superseded',
])
export type ImageRunStatus = z.infer<typeof ImageRunStatusSchema>

export const ImageAssetSourceSchema = z.enum(['generated', 'manual', 'remote'])
export type ImageAssetSource = z.infer<typeof ImageAssetSourceSchema>

export const ImageAssetStatusSchema = z.enum([
  'candidate',
  'accepted',
  'rejected',
])
export type ImageAssetStatus = z.infer<typeof ImageAssetStatusSchema>

export const ImageRunSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().min(1),
  deckRevision: z.string().min(1),
  slide: z.number().int().positive(),
  purpose: ImagePurposeSchema,
  prompt: z.string().trim().min(1).max(8_000),
  status: ImageRunStatusSchema,
  inputAssetIds: z.array(z.string().uuid()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type ImageRun = z.infer<typeof ImageRunSchema>

export const ImageAssetSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().min(1),
  runId: z.string().uuid().optional(),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.enum(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  source: ImageAssetSourceSchema,
  sourceUrl: z.string().url().optional(),
  license: z.string().trim().min(1).max(300).optional(),
  attribution: z.string().trim().min(1).max(1_000).optional(),
  status: ImageAssetStatusSchema,
  accepted: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type ImageAsset = z.infer<typeof ImageAssetSchema>

export const CreateImageRunRequestSchema = z.object({
  slide: z.number().int().positive(),
  purpose: ImagePurposeSchema,
  prompt: z.string().trim().min(1).max(8_000),
  inputAssetIds: z.array(z.string().uuid()).max(8).default([]),
})
export type CreateImageRunRequest = z.infer<typeof CreateImageRunRequestSchema>

export const RegisterImageAssetRequestSchema = z
  .object({
    path: z.string().min(1),
    runId: z.string().uuid().optional(),
    source: ImageAssetSourceSchema,
    sourceUrl: z.string().url().optional(),
    license: z.string().trim().min(1).max(300).optional(),
    attribution: z.string().trim().min(1).max(1_000).optional(),
  })
  .superRefine((asset, context) => {
    if (asset.source === 'remote' && !asset.sourceUrl)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'A remote image requires its final source URL.',
      })
    if (
      asset.source === 'remote' &&
      asset.sourceUrl &&
      !/^https:\/\//i.test(asset.sourceUrl)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: 'A remote image source URL must use HTTPS.',
      })
    if (asset.source === 'remote' && !asset.license)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['license'],
        message: 'A remote image requires license or rights information.',
      })
  })
export type RegisterImageAssetRequest = z.infer<
  typeof RegisterImageAssetRequestSchema
>

export const CreateExportRequestSchema = z.object({
  format: z.literal('editable-pptx'),
  outputName: z.string().min(1).max(160),
  /** Require an explicit visual confirmation before the export is published. */
  review: z.boolean().optional(),
  reviewPolicy: ReviewPolicySchema.optional(),
  profileDigest: z.string().min(1).nullable().optional(),
  options: z
    .object({
      policy: z
        .enum(['editable', 'strict-editable', 'visual-fidelity'])
        .optional(),
      master: z.boolean().default(true),
      notes: z.boolean().default(true),
      animations: z.boolean().default(true),
      diagrams: z.boolean().default(true),
      review: z.boolean().default(true),
    })
    .default({
      master: true,
      notes: true,
      animations: true,
      diagrams: true,
      review: true,
    }),
})
export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>

export const DeckNotesDocumentSchema = z.object({
  version: z.literal(1),
  notes: z.array(SpeakerNotesDocumentV1Schema),
})
export type DeckNotesDocument = z.infer<typeof DeckNotesDocumentSchema>
export const DeckAnimationsDocumentSchema = z.object({
  version: z.literal(1),
  animations: z.array(AnimationDocumentV1Schema),
})
export type DeckAnimationsDocument = z.infer<
  typeof DeckAnimationsDocumentSchema
>
export const PutDiagramDocumentSchema = z.object({ document: z.unknown() })
export type PutDiagramDocument = z.infer<typeof PutDiagramDocumentSchema>

export const CreationWizardSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  status: z.enum(['draft', 'committed', 'abandoned']).default('draft'),
  currentStep: z.string().default('task'),
  decisions: z.array(CreationDecisionV1Schema).default([]),
  profileDigest: z.string().optional(),
  updatedAt: z.iso.datetime(),
})
export type CreationWizard = z.infer<typeof CreationWizardSchema>

export const ReviewExportRequestSchema = z.object({
  approved: z.boolean(),
})

export const ImportPptxThemeRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  dataBase64: z.string().min(1),
  themeName: z.string().min(1).max(64).optional(),
  harness: HarnessKindSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
})
export type ImportPptxThemeRequest = z.infer<
  typeof ImportPptxThemeRequestSchema
>

export const ImportPptxThemeResultSchema = z.object({
  jobId: z.string().uuid(),
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
  analysis: ImportAnalysisV1Schema.optional(),
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

const ExportObjectBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export const ExportObjectReportSchema = z.object({
  layoutRepair: z
    .object({
      source: ExportObjectBoxSchema,
      proposed: ExportObjectBoxSchema,
      applied: z.boolean(),
    })
    .optional(),
  slideId: z.string(),
  elementId: z.string(),
  source: z.object({
    tag: z.string(),
    path: z.string(),
    className: z.string().optional(),
    anchor: z.string().optional(),
    pseudo: z.enum(['before', 'after']).optional(),
  }),
  kind: z.enum(['shape', 'line', 'text', 'image', 'table']),
  semanticKind: z.literal('table').optional(),
  requiredRepresentation: z.literal('native-table').optional(),
  representation: z.enum(['native-table', 'native-shapes', 'native-text', 'image']).optional(),
  semanticPreserved: z.boolean().optional(),
  structureOwnerId: z.string().optional(),
  childIds: z.array(z.string()).optional(),
  pptxObjectName: z.string().optional(),
  verification: z.object({ structure: z.enum(['passed', 'unverified']), visual: z.literal('unverified'), application: z.literal('unverified') }).optional(),
  nativeCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  imageKinds: z
    .object({
      vector: z.number().int().nonnegative(),
      raster: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    })
    .optional(),
  status: z.enum(['native', 'image', 'mixed', 'missing']),
  editableRequired: z.boolean(),
  fonts: z
    .object({
      requested: z.array(z.string()),
      emitted: z.array(z.string()),
      substituted: z.boolean(),
    })
    .optional(),
  reasons: z.array(z.string()),
})

export const ExportJobSchema = z.object({
  snapshotVersions: z.array(z.union([z.literal(1), z.literal(2)])).min(1).optional(),
  themeRules: z.object({
    revision: z.string().min(1), digest: z.string().nullable(),
    binding: z.lazy(() => ThemeRuleExceptionBindingSchema).optional(),
    exceptions: z.array(z.lazy(() => ThemeRuleExceptionSchema)).optional(),
    stage: z.enum(['pre-export', 'post-export']),
    issues: z.array(z.lazy(() => ThemeRuleIssueSchema)),
    readback: z.object({
      source: z.literal('pptx-xml'), sha256: z.string().regex(/^[a-f0-9]{64}$/),
      checkedAt: z.iso.datetime(), status: z.enum(['passed', 'issues', 'failed']),
      issues: z.array(z.lazy(() => ThemeRuleIssueSchema)), error: z.string().optional(),
      render: PptxRenderEvidenceV1Schema.optional(),
      slides: z.array(z.object({ index: z.number().int().positive(), part: z.string(), slideId: z.string().optional(), layoutPart: z.string().optional(), layout: z.string().optional(), masterPart: z.string().optional(), master: z.string().optional() })),
    }).optional(),
  }).optional(),
  objects: z.array(ExportObjectReportSchema).optional(),
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

export const ThemeRuleMeasurementSchema = z.object({
  slide: z.number().int().positive(),
  textLines: z.number().int().nonnegative(),
  density: z.number().min(0).max(1),
  tokens: z.array(z.string().min(1)),
})
export const BrowserQualityResultSchema = z.object({
  inspectionAvailable: z.literal(true),
  slide: z.number().int().positive(),
  slideCount: z.number().int().nonnegative(),
  issues: z.array(z.lazy(() => DeckQualityIssueSchema)),
  ruleMeasurement: ThemeRuleMeasurementSchema.optional(),
})
export type BrowserQualityResult = z.infer<typeof BrowserQualityResultSchema>

export const BrowserInspectionKindSchema = z.enum(['overflow', 'quality'])
export type BrowserInspectionKind = z.infer<typeof BrowserInspectionKindSchema>

export const BrowserInspectionJobSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().min(1),
  slide: z.number().int().positive(),
  kind: BrowserInspectionKindSchema.default('overflow'),
  revision: z.string().min(1).optional(),
  themeId: z.string().min(1).nullable().optional(),
  themeDigest: z.string().min(1).nullable().optional(),
  masterDigest: z.string().nullable().optional(),
  profileDigest: z.string().min(1).nullable().optional(),
  policy: ReviewPolicySchema.optional(),
  status: z.enum(['queued', 'completed', 'failed']),
  createdAt: z.iso.datetime(),
  result: z
    .union([BrowserOverflowResultSchema, BrowserQualityResultSchema])
    .optional(),
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
  sessionProfile: SessionDeckProfileSchema.nullable().default(null),
  profileDigest: z.string().nullable().default(null),
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
  profile: SessionDeckProfileSchema,
})

export const SessionProfileRecordSchema = z.object({
  harness: HarnessKindSchema,
  sessionId: z.string().min(1),
  profile: SessionDeckProfileSchema,
  profileDigest: z.string().min(1),
  registryVersion: z.string().min(1),
  themeSkillId: z.string().nullable(),
  themeSkillVersion: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type SessionProfileRecord = z.infer<typeof SessionProfileRecordSchema>

export const UpdateSessionAliasRequestSchema = z.object({
  alias: z.string().trim().min(1).max(120),
})

export const SendMessageRequestSchema = z.object({
  content: z.string().min(1),
  themeId: z.string().min(1).optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image']),
        path: z.string().min(1),
      }),
    )
    .default([]),
  model: z.string().trim().min(1).max(120).optional(),
})

export const DeckQualityIssueSchema = z.object({
  layer: z.enum(['schema', 'pretext', 'geometry', 'visual', 'pptx']),
  severity: z.enum(['error', 'warning', 'needs-human']),
  code: z.string().min(1),
  message: z.string().min(1),
  slide: z.number().int().positive().optional(),
  elementId: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    })
    .optional(),
  metric: z
    .object({
      actual: z.number(),
      expected: z.number(),
      unit: z.string().min(1),
    })
    .optional(),
  suggestedFix: z.string().min(1).optional(),
})
export type DeckQualityIssue = z.infer<typeof DeckQualityIssueSchema>

export const ThemeRuleIssueSchema = z.object({
  ruleId: z.string().min(1),
  severity: z.enum(['error', 'warning', 'needs-human']),
  code: z.string().min(1),
  message: z.string().min(1),
  slide: z.number().int().positive().optional(),
  status: z.enum(['violation', 'unverified']).optional(),
  source: z.string().optional(),
  suggestedFix: z.string().optional(),
  exception: z.object({ id: z.string().uuid(), reason: z.string(), approvedAt: z.iso.datetime() }).optional(),
  locator: z.object({ layout: z.string().optional(), master: z.string().optional(), placeholderIndex: z.number().int().nonnegative().optional(), objectName: z.string().optional(), token: z.string().optional() }).optional(),
})
export type ThemeRuleIssue = z.infer<typeof ThemeRuleIssueSchema>

export const ThemeRuleExceptionBindingSchema = z.object({
  deckId: z.string().min(1), revision: z.string().min(1),
  themeId: z.string().nullable(), themeDigest: z.string().nullable(), ruleDigest: z.string().nullable(),
  masterDigest: z.string().nullable(), profileDigest: z.string().nullable(),
  optionsDigest: z.string().regex(/^[a-f0-9]{64}$/), authoredDigest: z.string().regex(/^[a-f0-9]{64}$/),
})
export type ThemeRuleExceptionBinding = z.infer<typeof ThemeRuleExceptionBindingSchema>
export const ThemeRuleExceptionSchema = z.object({
  id: z.string().uuid(), binding: ThemeRuleExceptionBindingSchema,
  phase: z.enum(['export', 'readback']), issueFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  issue: ThemeRuleIssueSchema.omit({ exception: true }), reason: z.string().trim().min(1).max(1000),
  actor: z.literal('user'), approvedAt: z.iso.datetime(), revokedAt: z.iso.datetime().optional(),
})
export type ThemeRuleException = z.infer<typeof ThemeRuleExceptionSchema>
export const ThemeRuleExceptionDocumentSchema = z.object({ version: z.literal(1), entries: z.array(ThemeRuleExceptionSchema) })
export const ThemeRuleExceptionContextRequestSchema = z.object({
  phase: z.enum(['export', 'readback']).default('export'), exportId: z.string().uuid().optional(),
  profileDigest: z.string().min(1).nullable().default(null), options: CreateExportRequestSchema.shape.options,
})
export type ThemeRuleExceptionContextRequest = z.infer<typeof ThemeRuleExceptionContextRequestSchema>
export const ApproveThemeRuleExceptionSchema = ThemeRuleExceptionContextRequestSchema.extend({
  expectedBinding: ThemeRuleExceptionBindingSchema, issueFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(1000),
})
export const ThemeRuleExceptionReviewSchema = z.object({
  binding: ThemeRuleExceptionBindingSchema, phase: z.enum(['export', 'readback']),
  issues: z.array(z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), issue: ThemeRuleIssueSchema })),
  entries: z.array(z.object({ exception: ThemeRuleExceptionSchema, state: z.enum(['active', 'expired', 'revoked']) })),
})
export type ThemeRuleExceptionReview = z.infer<typeof ThemeRuleExceptionReviewSchema>

export const ThemeRuleApprovalReportSchema = z.object({
  version: z.literal(1), scope: z.literal('theme-catalog'), checkedAt: z.iso.datetime(),
  digest: z.string().nullable(), catalogDigest: z.string().regex(/^[a-f0-9]{64}$/), layouts: z.array(z.string()), valid: z.boolean(),
  issues: z.array(ThemeRuleIssueSchema),
})
export type ThemeRuleApprovalReport = z.infer<typeof ThemeRuleApprovalReportSchema>

export const DeckValidationResultSchema = z.object({
  deckId: z.string().min(1),
  revision: z.string().min(1),
  valid: z.boolean(),
  themeId: z.string().optional(),
  themeSkillId: z.string().optional(),
  themeRuleDigest: z.string().nullable().default(null),
  themeRuleIssues: z.array(ThemeRuleIssueSchema).default([]),
  errors: z.array(
    z.object({ code: z.string().min(1), message: z.string().min(1) }),
  ),
})
export type DeckValidationResult = z.infer<typeof DeckValidationResultSchema>

export const DeckQualityReportSchema = z.object({
  version: z.literal(1),
  deckId: z.string().min(1),
  revision: z.string().min(1),
  themeId: z.string().nullable(),
  themeDigest: z.string().nullable(),
  masterDigest: z.string().nullable().default(null),
  profileDigest: z.string().nullable(),
  checkedAt: z.iso.datetime(),
  policy: ReviewPolicySchema,
  ok: z.boolean(),
  issues: z.array(DeckQualityIssueSchema),
  themeRuleDigest: z.string().nullable().default(null),
  themeRuleIssues: z.array(ThemeRuleIssueSchema).default([]),
  ruleMeasurements: z.array(ThemeRuleMeasurementSchema).default([]),
})
export type DeckQualityReport = z.infer<typeof DeckQualityReportSchema>

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

// Resource-library responses are shared by the gallery and agent tools.
export const LayoutResourceSummarySchema = z.object({
  id: z.string(), title: z.string(), kind: z.enum(['layout', 'diagram']),
  description: z.string(), tags: z.array(z.string()), style: z.string(),
  scenarios: z.string(), source: z.string(), sourcePage: z.number().int().positive(),
  file: z.string(), aspect: z.number().positive(), density: z.enum(['airy', 'balanced', 'dense']),
  status: z.enum(['reconstructed', 'needs-review', 'excluded']), warnings: z.array(z.string()),
  license: z.string(), stats: z.record(z.string(), z.number()), revision: z.string().optional(),
  renderQa: z.object({ textOverflow: z.number(), missingImages: z.number(), textOutsidePage: z.number().optional(), blockSsim: z.number().optional(), normalizedMae: z.number().optional(), error: z.string().optional() }).optional(),
})
export type LayoutResourceSummary = z.infer<typeof LayoutResourceSummarySchema>
export const ResourceSearchResultSchema = z.object({
  total: z.number(), offset: z.number(), limit: z.number(),
  items: z.array(LayoutResourceSummarySchema.extend({ score: z.number(), matched: z.array(z.string()) })),
})
export const ResourceDetailSchema = z.object({ resource: LayoutResourceSummarySchema, markdown: z.string() })
export const SlideRegionSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine(box => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001, 'Region exceeds slide bounds')
export type SlideRegion = z.infer<typeof SlideRegionSchema>

export const CreativeAnimationSummarySchema = z.object({
  id:z.string(),title:z.string(),category:z.string(),scope:z.enum(['object','multi-object']),source:z.string(),sourcePage:z.number(),file:z.string(),motionFile:z.string(),aspect:z.number(),targets:z.array(z.string()),effects:z.number(),durationMs:z.number(),warnings:z.array(z.string()),origin:z.enum(['creative-library','layout-motion']),tags:z.array(z.string()),useCases:z.array(z.string()).default([]),revision:z.string(),
})
export type CreativeAnimationSummary=z.infer<typeof CreativeAnimationSummarySchema>
export const CreativeAnimationSearchSchema=z.object({total:z.number(),offset:z.number(),limit:z.number(),items:z.array(CreativeAnimationSummarySchema)})
export const CreativeAnimationDetailSchema=z.object({resource:CreativeAnimationSummarySchema,motion:AnimationDocumentV1Schema,markdown:z.string()})
