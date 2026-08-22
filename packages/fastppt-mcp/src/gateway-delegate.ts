import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  BrowserInspectionJobSchema,
  DeckQualityReportSchema,
  DeckSummarySchema,
  ExportJobSchema,
  SlidevProcessStateSchema,
} from '@fastppt/protocol'
import { z } from 'zod'

import type { BrowserCaptureDelegate } from './server.js'

const RuntimeSchema = z.object({
  version: z.literal(1),
  url: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1'
  }, 'Gateway must use the IPv4 loopback interface.'),
  pid: z.number().int().positive(),
  delegationTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(15 * 60_000),
})

const WAIT_INTERVAL_MS = 250

export class GatewayBrowserCaptureDelegate implements BrowserCaptureDelegate {
  readonly #workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.#workspaceRoot = workspaceRoot
  }

  async inspectOverflow(input: { path: string; slide: number }) {
    const deck = await this.#resolveDeck(input.path)
    const job = await this.#request(
      `/api/v1/decks/${encodeURIComponent(deck.id)}/inspections/overflow`,
      BrowserInspectionJobSchema,
      { method: 'POST', body: JSON.stringify({ slide: input.slide }) },
    )
    const completed = await this.#wait(
      `/api/v1/inspections/${encodeURIComponent(job.id)}`,
      BrowserInspectionJobSchema,
      (candidate) => candidate.status !== 'queued',
    )
    if (completed.status !== 'completed' || !completed.result)
      throw new Error(completed.error ?? 'Browser overflow inspection failed.')
    return completed.result
  }

  async inspectQuality(input: { path: string; slide: number }) {
    const deck = await this.#resolveDeck(input.path)
    const job = await this.#request(
      `/api/v1/decks/${encodeURIComponent(deck.id)}/inspections/quality`,
      BrowserInspectionJobSchema,
      { method: 'POST', body: JSON.stringify({ slide: input.slide, policy: 'standard' }) },
    )
    const completed = await this.#wait(
      `/api/v1/inspections/${encodeURIComponent(job.id)}`,
      BrowserInspectionJobSchema,
      (candidate) => candidate.status !== 'queued',
    )
    if (completed.status !== 'completed' || !completed.result)
      throw new Error(completed.error ?? 'Browser quality inspection failed.')
    return completed.result
  }

  async getQualityReport(path: string) {
    const deck = await this.#resolveDeck(path)
    return await this.#request(
      `/api/v1/decks/${encodeURIComponent(deck.id)}/quality-report`,
      DeckQualityReportSchema,
    )
  }

  async getPreviewStatus(path: string) {
    const deck = await this.#resolveDeck(path)
    return await this.#request(
      `/api/v1/decks/${encodeURIComponent(deck.id)}/preview/status`,
      SlidevProcessStateSchema,
    )
  }

  async exportEditablePptx(input: { path: string; outputName: string }) {
    const deck = await this.#resolveDeck(input.path)
    const job = await this.#request(
      `/api/v1/decks/${encodeURIComponent(deck.id)}/exports`,
      ExportJobSchema,
      {
        method: 'POST',
        body: JSON.stringify({
          format: 'editable-pptx',
          outputName: input.outputName,
        }),
      },
    )
    const completed = await this.#wait(
      `/api/v1/exports/${encodeURIComponent(job.id)}`,
      ExportJobSchema,
      (candidate) => !['queued', 'running'].includes(candidate.status),
    )
    if (completed.status !== 'completed')
      throw new Error(
        completed.error?.message ?? 'Editable PPTX export failed.',
      )
    const runtime = await this.#runtime()
    const response = await fetch(
      `${runtime.url}/api/v1/exports/${encodeURIComponent(completed.id)}/download`,
    )
    if (!response.ok)
      throw new Error(`PPTX download failed (${response.status}).`)
    const outputDirectory = join(
      this.#workspaceRoot,
      '.fastppt',
      'exports',
      'mcp',
      completed.id,
    )
    await mkdir(outputDirectory, { recursive: true })
    const outputPath = join(outputDirectory, completed.outputName)
    const temporary = `${outputPath}.partial`
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()))
    await rename(temporary, outputPath)
    return {
      ...completed,
      path: outputPath,
    }
  }

  async #resolveDeck(path: string) {
    const decks = await this.#request(
      '/api/v1/decks',
      z.array(DeckSummarySchema),
    )
    const normalized = path.replaceAll('\\', '/')
    const deck = decks.find((candidate) => candidate.entryFile === normalized)
    if (!deck) throw new Error(`Gateway does not manage deck: ${path}`)
    return deck
  }

  async #wait<T>(
    path: string,
    schema: z.ZodType<T>,
    complete: (value: T) => boolean,
  ): Promise<T> {
    const runtime = await this.#runtime()
    const deadline = Date.now() + runtime.delegationTimeoutMs + 10_000
    while (Date.now() < deadline) {
      const value = await this.#request(path, schema)
      if (complete(value)) return value
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, WAIT_INTERVAL_MS),
      )
    }
    throw new Error('FastPPT browser delegation timed out.')
  }

  async #request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const runtime = await this.#runtime()
    const response = await fetch(`${runtime.url}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    const payload = await response.json()
    if (!response.ok) {
      const message = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(payload)
      throw new Error(
        message.success
          ? message.data.error.message
          : `Gateway request failed (${response.status}).`,
      )
    }
    return schema.parse(payload)
  }

  async #runtime() {
    try {
      return RuntimeSchema.parse(
        JSON.parse(
          await readFile(
            join(this.#workspaceRoot, '.fastppt', 'runtime', 'gateway.json'),
            'utf8',
          ),
        ) as unknown,
      )
    } catch (cause) {
      throw new Error(
        `An active FastPPT Gateway is required: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
  }
}
