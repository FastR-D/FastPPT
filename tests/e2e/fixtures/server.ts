import { layoutSystemSfc } from '@fastppt/fastppt-mcp/theme-design'
import { cp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { NativeMasterLayout } from '@fastppt/slidewave/server'
import { writeEditablePptx } from '@fastppt/slidewave/server'

import { createGateway } from '@fastppt/gateway/app'
import {
  HarnessCapabilitiesSchema,
  HarnessStatusSchema,
  SessionPageSchema,
  UnifiedAgentEventSchema,
  UnifiedSessionSchema,
} from '@fastppt/protocol'

import type {
  ApprovalDecisionInput,
  CancelRunInput,
  CreateSessionInput,
  ForkSessionInput,
  GetSessionInput,
  HarnessAdapter,
  ListSessionsInput,
  ResumeSessionInput,
  SendMessageInput,
  SessionHandle,
  SessionReference,
} from '@fastppt/harness-core'
import type {
  HarnessKind,
  SessionPage,
  UnifiedAgentEvent,
  UnifiedMessage,
  UnifiedSession,
} from '@fastppt/protocol'
import type {
  EditablePptxExporter,
  ExportDeckInput,
} from '@fastppt/gateway/app'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')
export const E2E_WORKSPACE = '/tmp/fastppt-e2e-workspace'
const fixtureThemesRoot = '/tmp/fastppt-e2e-themes'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

class BrowserFixtureHarness implements HarnessAdapter {
  readonly sessions = new Map<string, UnifiedMessage[]>()
  #sessionCounter = 0
  #runCounter = 0

  constructor(readonly kind: HarnessKind) {
    this.sessions.set(`${kind}-history-1`, [])
    this.sessions.set(`${kind}-history-2`, [])
  }

  getStatus() {
    return Promise.resolve(
      HarnessStatusSchema.parse({
        kind: this.kind,
        status: 'available',
        version: `${this.kind}-e2e-fixture`,
        verifiedVersionRange: 'fixture',
        compatible: true,
        capabilities: this.capabilities(),
      }),
    )
  }

  getCapabilities() {
    return Promise.resolve(this.capabilities())
  }

  listSessions(input: ListSessionsInput): Promise<SessionPage> {
    const ids = [...this.sessions.keys()]
    const pageIds =
      input.cursor === 'history-page-2' ? ids.slice(1) : ids.slice(0, 1)
    return Promise.resolve(
      SessionPageSchema.parse({
        data: pageIds.map((id) => ({
          id,
          harness: this.kind,
          title: `${this.kind} ${id.endsWith('-2') ? 'second' : 'first'} history`,
          preview: 'FastPPT browser fixture',
          cwd: E2E_WORKSPACE,
          createdAt: '2026-08-03T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
          status: 'idle',
        })),
        nextCursor:
          input.cursor === 'history-page-2' || ids.length < 2
            ? null
            : 'history-page-2',
      }),
    )
  }

  getSession(input: GetSessionInput): Promise<UnifiedSession> {
    const messages = this.sessions.get(input.sessionId) ?? []
    return Promise.resolve(
      UnifiedSessionSchema.parse({
        summary: {
          id: input.sessionId,
          harness: this.kind,
          title: `${this.kind} ${input.sessionId.endsWith('-2') ? 'second' : 'first'} history`,
          preview: 'FastPPT browser fixture',
          cwd: E2E_WORKSPACE,
          createdAt: '2026-08-03T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
          status: 'idle',
        },
        messages,
      }),
    )
  }

  createSession(_input: CreateSessionInput): Promise<SessionReference> {
    void _input
    const sessionId = `${this.kind}-e2e-${++this.#sessionCounter}`
    this.sessions.set(sessionId, [])
    return Promise.resolve({ harness: this.kind, sessionId })
  }

  resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    this.sessions.set(input.sessionId, this.sessions.get(input.sessionId) ?? [])
    return Promise.resolve({
      harness: this.kind,
      sessionId: input.sessionId,
      cwd: input.cwd,
    })
  }

  forkSession(input: ForkSessionInput): Promise<SessionReference> {
    return this.createSession({ cwd: input.cwd })
  }

  async *sendMessage(
    input: SendMessageInput,
  ): AsyncIterable<UnifiedAgentEvent> {
    const runId = `${this.kind}-run-${++this.#runCounter}`
    const base = {
      harness: this.kind,
      sessionId: input.sessionId,
      runId,
      themeId: input.themeId,
      themeSkillId: input.themeSkillId,
      themeSkillVersion: input.themeSkillVersion,
    }
    let sequence = 0
    const event = (type: string, data: unknown) =>
      UnifiedAgentEventSchema.parse({
        ...base,
        eventId: `${runId}-${++sequence}`,
        sequence,
        timestamp: new Date().toISOString(),
        type,
        data,
      })
    yield event('run.started', {})
    await delay(120)
    yield event('skill.discovery.confirmed', {
      skills: input.skills,
      mechanism: `${this.kind}-e2e-discovery`,
      simulated: true,
    })
    yield event('skill.invocation.requested', {
      skills: input.skills,
      mechanism: `${this.kind}-e2e-invocation`,
      simulated: true,
    })
    yield event('skill.invocation.unknown', {
      skills: input.skills,
      mechanism: `${this.kind}-e2e-invocation`,
      evidence: null,
      simulated: true,
    })
    yield event('assistant.delta', {
      delta: `Streaming ${input.themeSkillId}`,
    })
    await delay(120)
    const messages = this.sessions.get(input.sessionId) ?? []
    messages.push(
      { id: `${runId}-user`, role: 'user', content: input.content },
      {
        id: `${runId}-assistant`,
        role: 'assistant',
        content: `Completed with ${input.themeSkillId}`,
      },
    )
    this.sessions.set(input.sessionId, messages)
    yield event('run.completed', {})
  }

  cancelRun(_input: CancelRunInput): Promise<void> {
    void _input
    return Promise.resolve()
  }

  approveRequest(_input: ApprovalDecisionInput): Promise<void> {
    void _input
    return Promise.resolve()
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  private capabilities() {
    return HarnessCapabilitiesSchema.parse({
      sessionHistory: true,
      sessionFork: true,
      approvals: true,
      commandExecution: true,
      fileEdits: true,
      mcp: true,
      skillDiscovery: true,
      perRunSkillInvocation: true,
      skillInvocationObservation: false,
      imageInput: true,
      structuredEvents: true,
    })
  }
}

class BrowserFixtureExporter implements EditablePptxExporter {
  getStatus() {
    return Promise.resolve({ status: 'available' as const, version: 'e2e' })
  }

  async export(input: ExportDeckInput) {
    if (
      input.snapshot.source !== 'slidev' ||
      input.snapshot.slides.length === 0 ||
      input.snapshot.slides.some((slide) => slide.elements.length === 0)
    )
      throw new Error('E2E export requires a real Slidev iframe snapshot')
    input.onProgress?.({ phase: 'capturing-slides', progress: 50 })
    const result = await writeEditablePptx(input.snapshot, input.outputPath, {
      embedFonts: false,
      ...(input.options?.policy ? { policy: input.options.policy } : {}),
      ...(input.masterLayoutDefinitions ? { masterLayoutDefinitions: input.masterLayoutDefinitions } : {}),
      ...(input.masterLayouts ? { masterLayouts: input.masterLayouts } : {}),
      ...(input.slideLayouts ? { slideLayouts: input.slideLayouts } : {}),
    })
    return { ...result, outputPath: input.outputPath }
  }
}

await rm(E2E_WORKSPACE, { recursive: true, force: true })
await rm(fixtureThemesRoot, { recursive: true, force: true })
await mkdir(E2E_WORKSPACE, { recursive: true })
await mkdir(resolve(E2E_WORKSPACE, 'layouts'), { recursive: true })
const { sourceLayoutSfc } = await import(pathToFileURL(resolve(repositoryRoot, 'scripts/lib/source-layouts.mjs')).href) as { sourceLayoutSfc: (layout: NativeMasterLayout) => string }
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-import.vue'), sourceLayoutSfc({
  name: 'source-import', canvas: { width: 10000000, height: 5625000 },
  masterObjects: { canvas: { width: 10000000, height: 5625000 }, objects: [{ name: 'Brand', anchor: 'source-brand', x: 7000000, y: 4000000, width: 2000000, height: 500000, fill: '2255AA' }] },
  placeholders: [{ index: 0, type: 'title', x: 1000000, y: 562500, width: 7000000, height: 562500, textStyle: { fontFamily: 'Arial', fontFamilies: { ea: 'Noto Serif SC', cs: 'Noto Sans Arabic' }, fontSize: 24, color: '112233', bold: false, italic: true } }],
}))
const levelStyle: NonNullable<NativeMasterLayout['placeholders'][number]['textStyle']> = {
  fontFamily: 'Arial', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 24, bold: true, color: '112233',
  paragraph: { align: 'left', marginLeft: 0, marginRight: 0, indent: 0, lineSpacing: { unit: 'percent', value: 120 }, spaceBefore: { unit: 'points', value: 0 }, spaceAfter: { unit: 'points', value: 0 } },
  levels: [{ level: 2, textStyle: { fontSize: 16, bold: false, fontFamilies: { ea: 'Noto Sans SC' } }, paragraph: { align: 'right', marginLeft: 914400, indent: -182880, lineSpacing: { unit: 'percent', value: 150 }, spaceBefore: { unit: 'points', value: 4 }, spaceAfter: { unit: 'points', value: 6 } } }],
}
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-levels.vue'), sourceLayoutSfc({
  name: 'source-levels', canvas: { width: 10000000, height: 5625000 },
  placeholders: [{ index: 0, type: 'body', x: 1000000, y: 562500, width: 8000000, height: 4500000, textStyle: levelStyle }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-languages.vue'), sourceLayoutSfc({
  name: 'source-languages', canvas: { width: 10000000, height: 5625000 },
  fixedObjects: [{ name: 'Footer', anchor: 'language-footer', x: 500000, y: 5100000, width: 5000000, height: 300000, text: 'Fixed language', fontFamily: 'Arial', fontSize: 12, language: 'de-DE', alternativeLanguage: '' }],
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 300000, width: 9000000, height: 4500000,
    textStyle: { language: 'de-DE', alternativeLanguage: 'en-GB', fontFamily: 'Arial', fontSize: 16, color: '112233', levels: [
      { level: 2, textStyle: { language: '', alternativeLanguage: 'fr-FR' } },
      { level: 3, textStyle: { alternativeLanguage: '' } },
    ] },
  }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-text-body.vue'), sourceLayoutSfc({
  name: 'source-text-body', canvas: { width: 10000000, height: 5625000 },
  placeholders: [{ index: 0, type: 'body', x: 1000000, y: 562500, width: 8000000, height: 4500000, textStyle: levelStyle, textBody: { insets: { left: 0, right: 300000, top: 200000, bottom: 100000 }, verticalAlign: 'bottom', wrap: false, autoFit: 'none' } }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-tabs.vue'), sourceLayoutSfc({
  name: 'source-tabs', canvas: { width: 10000000, height: 5625000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 300000, width: 9000000, height: 5000000,
    textStyle: { fontFamily: 'Arial', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 18, color: '112233', paragraph: { marginLeft: 500000, defaultTabSize: 600000, tabStops: [{ position: 1000000, align: 'left' }, { position: 2000000, align: 'left' }, { position: 4000000, align: 'left' }] }, levels: [
      { level: 2, paragraph: { defaultTabSize: 800000, tabStops: [] } },
      { level: 3, paragraph: { defaultTabSize: 0, tabStops: [{ position: 1500000, align: 'left' }, { position: 3000000, align: 'left' }] } },
      { level: 4, paragraph: { defaultTabSize: 800000, tabStops: [], marginLeft: 700000, indent: -300000 } },
      { level: 5, paragraph: { tabStops: [{ position: 1500000, align: 'center' }, { position: 3500000, align: 'center' }] } },
      { level: 6, paragraph: { tabStops: [{ position: 1500000, align: 'right' }, { position: 3500000, align: 'right' }] } },
      { level: 7, paragraph: { decimalTab: { separator: '.', provenance: 'user-declared', reason: 'Fixture author confirms period', targetProfile: 'libreoffice-7.3.7.2-linux-en-US' }, tabStops: [{ position: 1500000, align: 'decimal' }, { position: 3500000, align: 'decimal' }] } },
      { level: 8, paragraph: { decimalTab: { separator: ',', provenance: 'user-declared', reason: 'Fixture author confirms comma', targetProfile: 'libreoffice-7.3.7.2-linux-de-DE' }, tabStops: [{ position: 1500000, align: 'decimal' }, { position: 3500000, align: 'decimal' }] } },
      { level: 9, paragraph: { decimalTab: null } },
    ] },
  }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-wrapped-tabs.vue'), sourceLayoutSfc({
  name: 'source-wrapped-tabs', canvas: { width: 12192000, height: 6858000 },
  placeholders: [0, 1, 2, 3].map(index => ({ index, type: 'body', x: (40 + index * 226) * 12700, y: 40 * 12700, width: 186 * 12700, height: 460 * 12700,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, verticalAlign: 'top', autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Mono', fontSize: 20, color: '112233', paragraph: { lineSpacing: { unit: 'points', value: 30 }, spaceAfter: { unit: 'points', value: 15 }, defaultTabSize: 72 * 12700, tabStops: [{ position: 72 * 12700, align: 'left' }] }, levels: [
      { level: 2, paragraph: { tabStops: [{ position: 72 * 12700, align: 'center' }] } },
      { level: 3, paragraph: { tabStops: [{ position: 72 * 12700, align: 'right' }] } },
      { level: 4, paragraph: { decimalTab: { separator: '.', provenance: 'user-declared', reason: 'Fixture author confirms period', targetProfile: 'libreoffice-7.3.7.2-linux-en-US' }, tabStops: [{ position: 72 * 12700, align: 'decimal' }] } },
      { level: 5, paragraph: { tabStops: [] } },
      { level: 6, paragraph: { tabStops: [{ position: 240 * 12700, align: 'left' }] } },
      { level: 7, paragraph: { marginLeft: 40 * 12700, indent: -20 * 12700 } },
      { level: 8, paragraph: { marginLeft: 20 * 12700, indent: 20 * 12700 } },
    ] },
  })),
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-numbering.vue'), sourceLayoutSfc({
  name: 'source-numbering', canvas: { width: 10000000, height: 5625000 },
  placeholders: [{ index: 0, type: 'body', x: 700000, y: 300000, width: 8500000, height: 5000000,
    textStyle: { fontFamily: 'Arial', fontSize: 16, color: '112233', paragraph: { bullet: { kind: 'auto-number', scheme: 'arabicPeriod', startAt: 5 }, marginLeft: 900000, indent: -700000 }, levels: [
      { level: 2, paragraph: { bullet: { kind: 'auto-number', scheme: 'alphaUcParenR', startAt: 27 }, marginLeft: 1600000 } },
    ] },
  }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-bullet-geometry.vue'), sourceLayoutSfc({
  name: 'source-bullet-geometry', canvas: { width: 12192000, height: 6858000 },
  placeholders: (['left', 'center', 'right', 'justify'] as const).map((align, index) => ({
    index, type: 'body', x: (20 + index * 235) * 12700, y: 40 * 12700, width: 186 * 12700, height: 450 * 12700,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none', wrap: true, verticalAlign: 'top' },
    textStyle: { fontFamily: 'Liberation Mono', fontSize: 20, color: '112233', paragraph: { align, lineSpacing: { unit: 'points', value: 30 }, bullet: { kind: 'character', character: '*' }, bulletFont: { kind: 'font', fontFamily: 'Liberation Mono' }, marginLeft: 40 * 12700, indent: -20 * 12700 }, levels: [
      { level: 2, paragraph: { indent: 0 } },
      { level: 3, paragraph: { indent: 20 * 12700 } },
      { level: 4, paragraph: { indent: 0, bulletSize: { kind: 'percent', value: 50 } } },
      { level: 5, paragraph: { indent: 0, bulletSize: { kind: 'percent', value: 200 } } },
      { level: 6, paragraph: { indent: 20 * 12700, bulletSize: { kind: 'points', value: 36 } } },
      { level: 7, paragraph: { bullet: { kind: 'auto-number', scheme: 'arabicPeriod', startAt: 1234 } } },
      { level: 8, paragraph: { indent: 160 * 12700 } },
    ] },
  })), fixedObjects: [],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'mcp-kerning.vue'), layoutSystemSfc({
  id: 'mcp-kerning', label: 'Kerning', purpose: 'Fixed text', composition: 'centered', regions: ['content'],
  nativeCanvas: { width: 12192000, height: 6858000 },
  nativeFixedObjects: [{ name: 'MCP Pairs', text: 'AVATAR To WA', x: 500000, y: 500000, width: 9000000, height: 800000, fontFamily: 'Liberation Serif', fontSize: 20, kerningThreshold: 30 }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-rtl.vue'), sourceLayoutSfc({
  name: 'source-rtl', canvas: { width: 12192000, height: 6858000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 400000, width: 11000000, height: 5500000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' },
    textStyle: { fontFamily: 'DejaVu Sans', fontSize: 20, language: 'en-US', color: '224466',
      paragraph: { direction: 'rtl', align: 'right', lineSpacing: { unit: 'points', value: 30 } },
      levels: [{ level: 2, paragraph: { align: 'center' } }, { level: 3, paragraph: { align: 'left', indent: 20 * 12700, marginLeft: 30 * 12700, marginRight: 50 * 12700 } }, { level: 4, paragraph: { direction: 'ltr', align: 'left' } }, { level: 5, paragraph: { indent: -20 * 12700, marginRight: 40 * 12700 } }, { level: 6, paragraph: { bullet: { kind: 'character', character: '*' }, marginLeft: 30 * 12700 } }],
    },
  }],
  fixedObjects: [{ name: 'RTL Footer', anchor: 'rtl-footer', x: 500000, y: 6200000, width: 10000000, height: 450000, text: 'שלום 123 ABC', direction: 'rtl', fontFamily: 'DejaVu Sans', fontSize: 16 }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-capitalization.vue'), sourceLayoutSfc({
  name: 'source-capitalization', canvas: { width: 12192000, height: 6858000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10000000, height: 4800000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Serif', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', capitalization: 'all', kerningThreshold: 0,
      levels: [{ level: 2, textStyle: { capitalization: 'none' } }, { level: 3, textStyle: { capitalization: 'small' } }, { level: 4, textStyle: { capitalization: 'small', fontFamily: 'EB Garamond 12' } }, { level: 5, paragraph: { defaultTabSize: 180 * 12700 } }, { level: 6, paragraph: { bullet: { kind: 'character', character: 'a' }, indent: -20 * 12700, marginLeft: 20 * 12700 } }],
      paragraph: { lineSpacing: { unit: 'points', value: 30 } },
    },
  }, { index: 1, type: 'body', x: 500000, y: 5500000, width: 130 * 12700, height: 1000000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Serif', fontSize: 20, capitalization: 'all', paragraph: { defaultTabSize: 60 * 12700, lineSpacing: { unit: 'points', value: 30 } } },
  }, { index: 2, type: 'body', x: 2800000, y: 5600000, width: 7000000, height: 800000,
    textStyle: { fontFamily: 'Liberation Serif', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, capitalization: 'all' },
  }],
  fixedObjects: [{ name: 'Caps Footer', anchor: 'caps-footer', x: 6500000, y: 6200000, width: 5000000, height: 500000, text: 'Straße', fontFamily: 'Liberation Serif', fontSize: 20, capitalization: 'all' }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'mcp-capitalization.vue'), layoutSystemSfc({
  id: 'mcp-capitalization', label: 'Capitalization', purpose: 'Fixed text', composition: 'centered', regions: ['content'],
  nativeCanvas: { width: 12192000, height: 6858000 },
  nativeFixedObjects: [{ name: 'MCP Capitals', text: 'Straße', x: 500000, y: 500000, width: 9000000, height: 800000, fontFamily: 'Liberation Serif', fontSize: 20, capitalization: 'small' }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-kerning.vue'), sourceLayoutSfc({
  name: 'source-kerning', canvas: { width: 12192000, height: 6858000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10000000, height: 4200000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Serif', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', kerningThreshold: 20,
      levels: [{ level: 2, textStyle: { kerningThreshold: 0 } }, { level: 3, textStyle: { kerningThreshold: 21 } }, { level: 4, textStyle: { fontSize: 19 } }, { level: 5, paragraph: { defaultTabSize: 180 * 12700 } }],
      paragraph: { lineSpacing: { unit: 'points', value: 30 } },
    },
  }, ...[0, 30].map((kerningThreshold, index) => ({ index: index + 1, type: 'body' as const, x: 500000 + index * 3500000, y: 4600000, width: 143 * 12700, height: 1400000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, autoFit: 'none' as const },
    textStyle: { fontFamily: 'Liberation Serif', fontSize: 20, color: '224466', kerningThreshold, paragraph: { lineSpacing: { unit: 'points' as const, value: 30 } } },
  })), { index: 3, type: 'body', x: 500000, y: 6050000, width: 5500000, height: 500000,
    textStyle: { fontFamily: 'Liberation Serif', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', kerningThreshold: 30 },
  }],
  fixedObjects: [{ name: 'Kerning Footer', anchor: 'kerning-footer', x: 6500000, y: 6050000, width: 5000000, height: 500000, text: 'AVATAR To WA', fontFamily: 'Liberation Serif', fontSize: 20, color: '224466', kerningThreshold: 30, baselinePercent: -10 }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-baseline.vue'), sourceLayoutSfc({
  name: 'source-baseline', canvas: { width: 12192000, height: 6858000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 500000, width: 10500000, height: 4300000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', baselinePercent: 30,
      levels: [{ level: 2, textStyle: { baselinePercent: 0 } }, { level: 3, textStyle: { baselinePercent: -25 } },
        { level: 4, paragraph: { defaultTabSize: 72 * 12700 } },
        { level: 5, paragraph: { bullet: { kind: 'character', character: '*' }, marginLeft: 30 * 12700, indent: -20 * 12700 } }],
      paragraph: { lineSpacing: { unit: 'points', value: 30 } },
    },
  }, { index: 1, type: 'body', x: 500000, y: 4600000, width: 140 * 12700, height: 1400000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, wrap: true, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Mono', fontSize: 20, color: '224466', baselinePercent: 30, paragraph: { defaultTabSize: 36 * 12700, lineSpacing: { unit: 'points', value: 30 } } },
  }, { index: 2, type: 'body', x: 5000000, y: 5300000, width: 6000000, height: 1200000,
    textStyle: { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', baselinePercent: 30 },
  }],
  fixedObjects: [{ name: 'Baseline Footer', anchor: 'baseline-footer', x: 3000000, y: 6000000, width: 8000000, height: 650000, text: 'Fixed baseline', fontFamily: 'Liberation Mono', fontSize: 20, color: '224466', baselinePercent: -25 }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-letter-spacing.vue'), sourceLayoutSfc({
  name: 'source-letter-spacing', canvas: { width: 12192000, height: 6858000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 300000, width: 11000000, height: 4100000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', letterSpacing: 2,
      paragraph: { lineSpacing: { unit: 'points', value: 30 } }, levels: [
        { level: 2, textStyle: { letterSpacing: 0 } }, { level: 3, textStyle: { letterSpacing: -2 } },
        { level: 4, textStyle: { letterSpacing: 1.25 } }, { level: 5, paragraph: { defaultTabSize: 72 * 12700 } },
      ],
    },
  }, ...[-2, 0, 2].map((letterSpacing, index) => ({ index: index + 1, type: 'body' as const, x: 500000 + index * 2000000, y: 4500000, width: 100 * 12700, height: 1400000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' as const },
    textStyle: { fontFamily: 'Liberation Mono', fontSize: 20, color: '224466', letterSpacing, paragraph: { lineSpacing: { unit: 'points' as const, value: 30 } } },
  })), { index: 4, type: 'body', x: 7000000, y: 6300000, width: 4800000, height: 450000, textStyle: { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 16, color: '224466', letterSpacing: 1.25 } }],
  fixedObjects: [{ name: 'Spaced Footer', anchor: 'spaced-footer', x: 500000, y: 6300000, width: 6000000, height: 450000, text: 'Compact fixed text', fontFamily: 'Liberation Mono', fontSize: 16, color: '224466', letterSpacing: -1.25 }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-decorations.vue'), sourceLayoutSfc({
  name: 'source-decorations', canvas: { width: 12192000, height: 6858000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 300000, width: 11000000, height: 5800000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' },
    textStyle: { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '224466', underline: true, strike: true, levels: [
      { level: 2, textStyle: { underline: false } },
      { level: 3, textStyle: { strike: false } },
      { level: 4, paragraph: { bullet: { kind: 'character', character: '*' }, marginLeft: 600000, indent: -400000 } },
      { level: 5, paragraph: { defaultTabSize: 120 * 12700 } },
      { level: 9, textStyle: { underline: false, strike: false } },
    ] },
  }, { index: 1, type: 'body', x: 8700000, y: 6300000, width: 3000000, height: 450000, textStyle: { fontFamily: 'Liberation Mono', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 12, color: '224466', underline: true, strike: true } }], fixedObjects: [{ name: 'Decorated Footer', anchor: 'decorated-footer', x: 500000, y: 6300000, width: 8000000, height: 450000, text: 'Fixed underline and strike', fontFamily: 'Liberation Mono', fontSize: 16, color: '224466', underline: true, strike: true }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'source-bullets.vue'), sourceLayoutSfc({
  name: 'source-bullets', canvas: { width: 10000000, height: 5625000 },
  placeholders: [{ index: 0, type: 'body', x: 500000, y: 300000, width: 9000000, height: 5000000,
    textBody: { insets: { left: 0, right: 0, top: 0, bottom: 0 }, autoFit: 'none' },
    textStyle: { fontFamily: 'Arial', fontFamilies: { ea: 'Noto Serif SC' }, fontSize: 20, color: '112233', paragraph: { bullet: { kind: 'character', character: '•' }, bulletFont: { kind: 'text' }, bulletSize: { kind: 'text' }, bulletColor: { kind: 'text' }, marginLeft: 600000, indent: -400000 }, levels: [
      { level: 2, paragraph: { bullet: { kind: 'character', character: '◆' }, bulletFont: { kind: 'font', fontFamily: 'Times New Roman' }, bulletSize: { kind: 'points', value: 14 }, bulletColor: { kind: 'color', color: 'AA5500' }, marginLeft: 1000000 } },
      { level: 3, paragraph: { bullet: { kind: 'none' }, marginLeft: 0, indent: 0 } },
      { level: 9, paragraph: { bullet: { kind: 'character', character: '▸' }, bulletSize: { kind: 'percent', value: 80 } } },
    ] },
  }],
}))
await writeFile(resolve(E2E_WORKSPACE, 'layouts', 'default.vue'), layoutSystemSfc({
  id: 'default', label: 'Fixed brand', purpose: 'Browser integration fixture', composition: 'centered', regions: ['content'],
  nativeCanvas: { width: 12192000, height: 6858000 },
  nativeMasterObjects: { canvas: { width: 10000000, height: 10000000 }, objects: [{ anchor: 'shared-brand', name: 'Brand', x: 7000000, y: 8000000, width: 2000000, height: 1000000, text: 'Master brand', fontFamily: 'Arial', fontSize: 20, color: '112233' }] },
  nativeFixedObjects: [{ name: 'Brand', x: 1219200, y: 685800, width: 2438400, height: 685800, fill: '112233', text: 'Brand {{ literal }} <text>', fontFamily: 'Arial', fontSize: 24, color: 'FFFFFF' }],
}))
await writeFile(
  resolve(E2E_WORKSPACE, 'slides.md'),
  '---\ntheme: slidev-theme-academy\ntitle: Academy E2E\n---\n\n# Academy E2E\n\n---\n\n# Academy E2E second slide\n',
)
await writeFile(
  resolve(E2E_WORKSPACE, 'landing.md'),
  '---\ntheme: slidev-theme-landing\ntitle: Landing E2E\n---\n\n# Landing E2E\n\n---\n\n# Landing E2E second slide\n',
)
await writeFile(
  resolve(E2E_WORKSPACE, 'notes-qa.md'),
  '---\ntheme: slidev-theme-academy\ntitle: Notes E2E\n---\n\n# Notes page 1\n\n---\n\n# Notes page 2\n\n---\n\n# Notes page 3\n\n---\n\n# Notes page 4\n',
)

const copyTheme = (source: string, target: string) => cp(source, target, { recursive: true, filter: path => !['.theme-build', 'dist', '.turbo'].includes(basename(path)) })
await copyTheme(resolve(repositoryRoot, 'themes'), fixtureThemesRoot)
const ruleThemeId = 'slidev-theme-rule-exceptions'
const ruleThemeRoot = resolve(fixtureThemesRoot, ruleThemeId)
await copyTheme(resolve(repositoryRoot, 'themes/slidev-theme-landing'), ruleThemeRoot)
for (const themeName of await readdir(fixtureThemesRoot)) {
  if (!themeName.startsWith('slidev-theme-')) continue
  const configPath = resolve(fixtureThemesRoot, themeName, 'tsconfig.json')
  const source = await readFile(configPath, 'utf8').catch((cause: unknown) => { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw cause })
  if (source) await writeFile(configPath, source.replace(/"extends"\s*:\s*"[^"]+"/, `"extends": ${JSON.stringify(resolve(repositoryRoot, 'tsconfig.base.json'))}`))
}
const ruleManifest = JSON.parse(await readFile(resolve(ruleThemeRoot, 'agent/theme-manifest.json'), 'utf8')) as {
  id: string; packageName: string; displayName: string; skill: { id: string }; machineRulesFile?: string
}
ruleManifest.id = ruleManifest.packageName = ruleThemeId
ruleManifest.displayName = 'Rule Exceptions'
ruleManifest.skill.id = 'fastppt-theme-rule-exceptions'
ruleManifest.machineRulesFile = 'agent/theme-rules.json'
await writeFile(resolve(ruleThemeRoot, 'agent/theme-manifest.json'), JSON.stringify(ruleManifest))
const rulePackage = JSON.parse(await readFile(resolve(ruleThemeRoot, 'package.json'), 'utf8')) as { name: string }
rulePackage.name = ruleThemeId
await writeFile(resolve(ruleThemeRoot, 'package.json'), JSON.stringify(rulePackage))
await writeFile(resolve(ruleThemeRoot, 'agent/SKILL.md'), (await readFile(resolve(ruleThemeRoot, 'agent/SKILL.md'), 'utf8')).replaceAll('fastppt-theme-landing', 'fastppt-theme-rule-exceptions'))
await writeFile(resolve(ruleThemeRoot, 'agent/theme-rules.json'), JSON.stringify({ version: 1, rules: [{ id: 'deck.pages', kind: 'max-slides', value: 1, severity: 'error' }] }))
await writeFile(resolve(E2E_WORKSPACE, 'rule-exceptions.md'), `---\ntheme: ${ruleThemeId}\nlayout: default\n---\n\n# First review page\n\n---\n\n# Second review page\n`)

const app = await createGateway(
  {
    host: '127.0.0.1',
    port: 4317,
    allowedWebOrigins: [
      'http://127.0.0.1:4317',
      'http://127.0.0.1:4328',
    ],
    workspaceRoot: E2E_WORKSPACE,
    workspaceName: 'fastppt-e2e-workspace',
    themesRoot: fixtureThemesRoot,
    exportTimeoutMs: 10_000,
    maxConcurrentRunsPerHarness: 1,
  },
  {
    watchThemes: false,
    harnesses: {
      claude: new BrowserFixtureHarness('claude'),
      codex: new BrowserFixtureHarness('codex'),
    },
    exporter: new BrowserFixtureExporter(),
  },
)
await app.listen({ host: '127.0.0.1', port: 4317 })

let closing = false
async function close(): Promise<void> {
  if (closing) return
  closing = true
  try {
    await app.close()
  } finally {
    await rm(E2E_WORKSPACE, { recursive: true, force: true })
    await rm(fixtureThemesRoot, { recursive: true, force: true })
  }
}
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
