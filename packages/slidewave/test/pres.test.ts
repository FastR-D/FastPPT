import { describe, expect, it } from 'vitest'

import { Pres } from '../src/pres'

describe('Pres', () => {
  it('builds and previews native primitives through the public API', async () => {
    const pres = new Pres({ theme: { primary: '#336699' } })
    const slide = pres.addSlide({ background: { color: '#FFFFFF' } })

    expect(slide.addStatCard({
      x: 0.5, y: 0.5, w: 3, h: 1.5,
      value: 42, label: 'Active users', delta: 8,
    })).toBe(slide)
    slide.addCallout({
      x: 0.5, y: 2.4, w: 4, h: 1.2,
      title: 'Important', body: 'Typed layout primitive', variant: 'info',
    })

    await pres.flush()
    const svg = pres.renderSvg()

    expect(pres.slideCount).toBe(1)
    expect(svg).toContain('Active users')
    expect(svg).toContain('42')
    expect(svg).toContain('Important')
  })

  it('renders all slides and serializes a presentation', async () => {
    const pres = new Pres({ title: 'Regression deck' })
    pres.addSlide().addText('First', { x: 1, y: 1, w: 4, h: 1 })
    pres.addSlide().addText('Second', { x: 1, y: 1, w: 4, h: 1 })

    await pres.flush()
    expect(pres.renderAllSvg()).toHaveLength(2)

    const bytes = new Uint8Array(await pres.toArrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1_000)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
  })
})
