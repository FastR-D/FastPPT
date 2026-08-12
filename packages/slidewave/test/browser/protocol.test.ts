import { describe, expect, it } from 'vitest'

import {
  SLIDEWAVE_CAPTURE_PROTOCOL_VERSION,
  isSlidewaveCaptureMessage,
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
