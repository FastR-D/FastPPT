import { describe, expect, it, vi } from 'vitest'

import { BrowserInspectionManager } from '../src/browser-delegation.js'

const result = {
  inspectionAvailable: true as const,
  overflow: true,
  slide: 1,
  slideCount: 1,
  viewport: { width: 100, height: 80 },
  overflowBy: { top: 0, right: 10, bottom: 10, left: 0 },
  elements: [
    {
      selector: 'p.summary',
      text: 'overflow',
      overflow: { top: 0, right: 10, bottom: 10, left: 0 },
    },
  ],
}

describe('BrowserInspectionManager', () => {
  it('derives overflow evidence from browser snapshots', () => {
    const manager = new BrowserInspectionManager({ timeoutMs: 1000 })
    const job = manager.enqueue('deck', 1)
    expect(manager.pending()).toEqual([job])
    const completed = manager.submitResult(job.id, result)
    expect(manager.pending()).toEqual([])
    expect(completed).toMatchObject({
      status: 'completed',
      result: {
        overflow: true,
        slide: 1,
        slideCount: 1,
        viewport: { width: 100, height: 80 },
        overflowBy: { right: 10, bottom: 10 },
        elements: [{ selector: 'p.summary', text: 'overflow' }],
      },
    })
    manager.dispose()
  })

  it('fails queued inspections after the browser timeout', () => {
    vi.useFakeTimers()
    const updates: unknown[] = []
    const manager = new BrowserInspectionManager({
      timeoutMs: 1000,
      onUpdate: (job) => updates.push(job),
    })
    const job = manager.enqueue('deck', 1)
    vi.advanceTimersByTime(1000)
    expect(manager.get(job.id)).toMatchObject({
      status: 'failed',
      error: 'Browser capture timed out.',
    })
    expect(updates).toHaveLength(2)
    manager.dispose()
    vi.useRealTimers()
  })
})
