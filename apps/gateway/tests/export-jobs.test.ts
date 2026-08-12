import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ExportJobManager,
  ExportServiceError,
  cleanupAbandonedExportArtifacts,
  sanitizePptxFilename,
} from '../src/export-jobs.js'

import type {
  EditablePptxExporter,
  ExportDeckInput,
  ExportDeckResult,
} from '../src/export-jobs.js'
import type { SlidewaveSnapshot } from '@fastppt/protocol'

const snapshot: SlidewaveSnapshot = {
  version: 1,
  source: 'slidev',
  slides: [
    {
      version: 1,
      id: '1',
      width: 1280,
      height: 720,
      elements: [],
      warnings: [],
    },
  ],
  warnings: [],
}

const temporaryDirectories = new Set<string>()

async function exportRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-exports-'))
  temporaryDirectories.add(directory)
  return directory
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
})

class FakeExporter implements EditablePptxExporter {
  active = 0
  peak = 0
  release: (() => void) | undefined

  getStatus() {
    return Promise.resolve({
      status: 'available' as const,
      version: 'slidewave fixture',
    })
  }

  async export(input: ExportDeckInput): Promise<ExportDeckResult> {
    this.active++
    this.peak = Math.max(this.peak, this.active)
    input.onProgress?.({ phase: 'capturing-slides', progress: 50 })
    await new Promise<void>((resolve, reject) => {
      this.release = resolve
      input.signal.addEventListener(
        'abort',
        () => reject(new DOMException('cancelled', 'AbortError')),
        { once: true },
      )
    })
    await writeFile(input.outputPath, 'fixture pptx')
    this.active--
    return {
      outputPath: input.outputPath,
      warnings: [{ code: 'fixture-warning', message: 'Fixture warning' }],
      elementCount: 12,
      slideCount: 2,
    }
  }
}

describe('ExportJobManager', () => {
  it('cleans abandoned partial and empty export directories', async () => {
    const outputRoot = await exportRoot()
    try {
      const abandoned = join(outputRoot, 'abandoned')
      const completed = join(outputRoot, 'completed')
      const active = join(outputRoot, 'active')
      await mkdir(abandoned)
      await mkdir(completed)
      await mkdir(active)
      await writeFile(join(abandoned, '.deck.pptx.partial.pptx'), 'partial')
      await writeFile(join(completed, '.deck.pptx.partial.pptx'), 'partial')
      await writeFile(join(completed, 'deck.pptx'), 'complete')
      await writeFile(join(active, '.deck.pptx.partial.pptx'), 'partial')
      await writeFile(
        join(active, '.fastppt-export-owner.json'),
        JSON.stringify({ pid: process.pid }),
      )

      await cleanupAbandonedExportArtifacts(outputRoot)

      await expect(access(abandoned)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(completed)).toEqual(['deck.pptx'])
      expect(await readdir(active)).toEqual([
        '.deck.pptx.partial.pptx',
        '.fastppt-export-owner.json',
      ])
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('sanitizes output names and completes one editable export', async () => {
    expect(sanitizePptxFilename('../bad:name?.PPTX')).toBe('bad-name-.pptx')
    const outputRoot = await exportRoot()
    const exporter = new FakeExporter()
    const updates: string[] = []
    const manager = new ExportJobManager({
      outputRoot,
      exporter,
      onUpdate: (job) => updates.push(`${job.status}:${job.phase}`),
    })
    const created = manager.enqueue({
      deckId: 'deck-1',
      title: 'Fixture',
      outputName: 'deck.pptx',
    })
    expect(created.phase).toBe('awaiting-browser-capture')
    expect(manager.pendingBrowserCapture()).toEqual([created])
    manager.submitSnapshot(created.id, snapshot)
    expect(manager.pendingBrowserCapture()).toEqual([])
    await vi.waitFor(() => expect(exporter.release).toBeTypeOf('function'))
    exporter.release?.()
    await vi.waitFor(() =>
      expect(manager.get(created.id)?.status).toBe('completed'),
    )
    expect(manager.get(created.id)).toMatchObject({
      progress: 100,
      slideCount: 2,
      elementCount: 12,
      warnings: [{ code: 'fixture-warning' }],
    })
    await expect(manager.download(created.id)).resolves.toMatchObject({
      name: 'deck.pptx',
    })
    expect(updates).toContain('running:capturing-slides')
    await manager.dispose()
  })

  it('refreshes browser capture timeout and reports captured pages', async () => {
    const outputRoot = await exportRoot()
    const manager = new ExportJobManager({ outputRoot, captureTimeoutMs: 30 })
    const created = manager.enqueue({
      deckId: 'deck-1',
      outputName: 'deck.pptx',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.reportCaptureProgress(created.id, 2, 80)).toMatchObject({
      progress: 6,
      slideCount: 80,
      capturedSlideCount: 2,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.get(created.id)?.status).toBe('queued')
    await manager.dispose()
  })

  it('runs serially and cancels a queued export without entering the exporter', async () => {
    const outputRoot = await exportRoot()
    const exporter = new FakeExporter()
    const manager = new ExportJobManager({ outputRoot, exporter })
    const first = manager.enqueue({
      deckId: 'deck-1',
      outputName: 'first.pptx',
    })
    const second = manager.enqueue({
      deckId: 'deck-2',
      outputName: 'second.pptx',
    })
    manager.submitSnapshot(first.id, snapshot)
    manager.submitSnapshot(second.id, snapshot)
    await vi.waitFor(() => expect(exporter.release).toBeTypeOf('function'))
    expect(manager.cancel(second.id)).toMatchObject({ status: 'cancelled' })
    expect(exporter.peak).toBe(1)
    exporter.release?.()
    await vi.waitFor(() =>
      expect(manager.get(first.id)?.status).toBe('completed'),
    )
    expect(manager.get(second.id)?.status).toBe('cancelled')
    await manager.dispose()
  })

  it('fails a job when browser capture times out', async () => {
    vi.useFakeTimers()
    const manager = new ExportJobManager({
      outputRoot: await exportRoot(),
      exporter: new FakeExporter(),
      captureTimeoutMs: 25,
    })
    const job = manager.enqueue({ deckId: 'deck-1', outputName: 'deck.pptx' })
    await vi.advanceTimersByTimeAsync(25)
    expect(manager.get(job.id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: { code: 'EXPORT_CAPTURE_TIMEOUT' },
    })
    await manager.dispose()
    vi.useRealTimers()
  })

  it('normalizes running cancellation and removes partial output', async () => {
    const outputRoot = await exportRoot()
    const exporter = new FakeExporter()
    const manager = new ExportJobManager({ outputRoot, exporter })
    const job = manager.enqueue({ deckId: 'deck-1', outputName: 'deck.pptx' })
    manager.submitSnapshot(job.id, snapshot)
    await vi.waitFor(() => expect(exporter.release).toBeTypeOf('function'))
    expect(manager.cancel(job.id)).toMatchObject({ status: 'running' })
    await vi.waitFor(() =>
      expect(manager.get(job.id)).toMatchObject({
        status: 'cancelled',
        error: { code: 'EXPORT_CANCELLED' },
      }),
    )
    await expect(
      access(join(outputRoot, job.id, '.deck.pptx.partial.pptx')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await manager.dispose()
  })

  it('bounds and redacts exporter failure logs', async () => {
    const outputRoot = await exportRoot()
    const exporter: EditablePptxExporter = {
      getStatus: () =>
        Promise.resolve({ status: 'available', version: 'fixture' }),
      export: () =>
        Promise.reject(
          new ExportServiceError(
            'EXPORT_FAILED',
            'token=private-export-token',
            Array.from(
              { length: 120 },
              (_, index) =>
                `line ${String(index)} Authorization: Bearer private-token`,
            ),
          ),
        ),
    }
    const manager = new ExportJobManager({ outputRoot, exporter })
    const job = manager.enqueue({ deckId: 'deck-1', outputName: 'deck.pptx' })
    manager.submitSnapshot(job.id, snapshot)
    await vi.waitFor(() => expect(manager.get(job.id)?.status).toBe('failed'))
    const failed = manager.get(job.id)
    expect(failed?.error?.message).toBe('token=[REDACTED]')
    expect(failed?.error?.logs).toHaveLength(100)
    expect(failed?.error?.logs?.[0]).toContain('Authorization: [REDACTED]')
    expect(JSON.stringify(failed)).not.toContain('private-token')
    await expect(access(join(outputRoot, job.id))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await manager.dispose()
  })
})
