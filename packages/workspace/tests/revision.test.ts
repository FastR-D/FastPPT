import { describe, expect, it } from 'vitest'

import { isBinaryContent } from '../src/revision.js'

describe('isBinaryContent', () => {
  it('accepts valid UTF-8 when a multibyte character crosses 8192 bytes', () => {
    const content = Buffer.concat([
      Buffer.alloc(8191, 'a'),
      Buffer.from('中文内容'),
    ])

    expect(isBinaryContent(content)).toBe(false)
  })

  it('rejects null bytes and invalid UTF-8', () => {
    expect(isBinaryContent(Buffer.from([0x61, 0x00, 0x62]))).toBe(true)
    expect(isBinaryContent(Buffer.from([0x61, 0xff, 0x62]))).toBe(true)
  })
})
