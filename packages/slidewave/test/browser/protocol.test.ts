import { describe, expect, it } from 'vitest'

import {
  SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
  isSlidewaveCaptureMessage,
  negotiateSnapshotVersion,
} from '../../src/browser/protocol.js'

describe('Slidewave iframe protocol', () => {
  it('accepts complete versioned messages', () => {
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.capture.request',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        requestId: 'request-1',
        theme: 'auto',
      }),
    ).toBe(true)
    expect(isSlidewaveCaptureMessage({ type: 'fastppt.slidewave.animation.preview', version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION, slide: 1, effect: { target: 'hero', kind: 'appear' } })).toBe(true)
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.capture.request',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        requestId: 'ustc-request',
        theme: 'academy',
      }),
    ).toBe(true)
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.overflow.request',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        requestId: 'overflow-1',
        slide: 2,
      }),
    ).toBe(true)
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.capture.progress',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        requestId: 'capture-progress',
        completed: 12,
        total: 80,
      }),
    ).toBe(true)
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.preview.state',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        page: 2,
        path: '/2',
      }),
    ).toBe(true)
  })

  it('rejects unknown, incomplete, and malformed messages', () => {
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.capture.request',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
      }),
    ).toBe(false)
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.preview.state',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
        page: 0,
        path: '/',
      }),
    ).toBe(false)
    expect(
      isSlidewaveCaptureMessage({
        type: 'fastppt.slidewave.capture.unknown',
        version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
      }),
    ).toBe(false)
  })
})


describe('animation preview timing and reset contract', () => {
  const base = { type: 'fastppt.slidewave.animation.preview', version: SLIDEWAVE_CAPTURE_PROTOCOL_VERSION }
  const effect = { target: 'brand', kind: 'entrance_fade', durationMs: 400 }
  it('accepts reset, page previews and negative pre-effect positions', () => {
    for (const message of [{ reset: true }, { slide: 2, effect, elapsedMs: -50 }, { effect, elapsedMs: 200 }, { slide: 1, effect }, { reset: true, motionPreference: 'reduce' }, { effect, motionPreference: 'full' }]) {
      expect(isSlidewaveCaptureMessage({ ...base, ...message })).toBe(true)
    }
  })
  it('rejects malformed timing, page scope, reset and effect payloads', () => {
    for (const message of [
      {}, { effect, motionPreference: 'invalid' }, { effect, motionPreference: 1 }, { reset: true, effect }, { reset: true, elapsedMs: 0 }, { reset: 'yes' },
      ...[0, -1, 1.5, Infinity, NaN, '2'].map(slide => ({ slide, effect })),
      ...[Infinity, NaN, '200'].map(elapsedMs => ({ effect, elapsedMs })),
      ...[0, -1, Infinity, NaN, '400'].map(durationMs => ({ effect: { ...effect, durationMs } })),
      { effect: { ...effect, target: ' ' } }, { effect: { ...effect, kind: '' } },
    ]) expect(isSlidewaveCaptureMessage({ ...base, ...message })).toBe(false)
  })
})


describe('snapshot version negotiation', () => {
  it('chooses the newest shared snapshot version independently of message protocol V1', () => {
    expect(negotiateSnapshotVersion([1, 2], [1, 2])).toBe(2)
    expect(negotiateSnapshotVersion([1, 2], [1])).toBe(1)
    expect(negotiateSnapshotVersion([1], [1, 2])).toBe(1)
    expect(negotiateSnapshotVersion()).toBe(1)
    expect(negotiateSnapshotVersion([2], [1])).toBeUndefined()
    for (const snapshotVersion of [1, 2]) {
      expect(isSlidewaveCaptureMessage({ type: 'fastppt.slidewave.capture.request', version: 1, requestId: 'native-table', snapshotVersion })).toBe(true)
      expect(isSlidewaveCaptureMessage({ type: 'fastppt.slidewave.capture.completed', version: 1, requestId: 'native-table', snapshot: { version: snapshotVersion, source: 'slidev', slides: [], warnings: [] } })).toBe(true)
    }
    expect(isSlidewaveCaptureMessage({ type: 'fastppt.slidewave.capture.ready', version: 1, snapshotVersions: [1, 2] })).toBe(true)
    expect(isSlidewaveCaptureMessage({ type: 'fastppt.slidewave.capture.ready', version: 1, snapshotVersions: [3] })).toBe(false)
    expect(isSlidewaveCaptureMessage({ type: 'fastppt.slidewave.capture.request', version: 1, requestId: 'unknown', snapshotVersion: 3 })).toBe(false)
  })
})

it('validates preview canvas bounds used by visual region editing', () => {
  const state = { type: 'fastppt.slidewave.preview.state', version: 1, page: 1, path: '/1', bounds: { x: .1, y: .2, width: .8, height: .6 } }
  expect(isSlidewaveCaptureMessage(state)).toBe(true)
  expect(isSlidewaveCaptureMessage({ ...state, bounds: { x: .8, y: .2, width: .8, height: .6 } })).toBe(false)
  expect(isSlidewaveCaptureMessage({ ...state, bounds: { x: 0, y: 0, width: NaN, height: .6 } })).toBe(false)
  expect(isSlidewaveCaptureMessage({ ...state, bounds: { x: 0, y: 0, width: 0, height: .6 } })).toBe(false)
})

it('accepts intrinsic slide dimensions for fitting standard, wide and portrait previews', () => {
  const state = { type: 'fastppt.slidewave.preview.state', version: 1, page: 1, path: '/1' }
  for (const slideSize of [{ width: 1280, height: 720 }, { width: 960, height: 720 }, { width: 720, height: 1280 }]) {
    expect(isSlidewaveCaptureMessage({ ...state, slideSize })).toBe(true)
  }
  for (const slideSize of [{ width: 0, height: 720 }, { width: -1, height: 720 }, { width: 1280, height: NaN }, { width: Infinity, height: 720 }, { width: '1280', height: 720 }, {}, null]) {
    expect(isSlidewaveCaptureMessage({ ...state, slideSize })).toBe(false)
  }
})
