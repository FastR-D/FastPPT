import { describe, expect, it } from 'vitest'
import { parseXml } from '@fastppt/slidewave/xml'
import {
  resolveColorElement,
  resolveSourceColor,
  mergeThemeDefinition,
  resolveThemeColors,
  type ThemeDefinitionLike,
} from '../src/color-resolution.js'
import { DRAWING_NS } from '../src/relationships.js'

const theme = (colors: ThemeDefinitionLike['colors']): ThemeDefinitionLike => ({
  part: 'ppt/theme/theme1.xml',
  colors,
})

describe('typed theme color resolution', () => {
  it('retains alpha through scheme references and rejects unsupported transforms', () => {
    const source = theme([
      {
        role: 'accent1',
        kind: 'srgbClr',
        attributes: { val: 'FF0000' },
        transforms: [{ kind: 'alpha', attributes: { val: '50000' } }],
      },
    ])
    expect(
      resolveSourceColor(
        {
          kind: 'schemeClr',
          attributes: { val: 'accent1' },
          transforms: [{ kind: 'alphaMod', attributes: { val: '50000' } }],
        },
        { theme: source },
      ),
    ).toMatchObject({ value: '#FF0000', alpha: 0.25 })
    expect(
      resolveSourceColor(
        {
          kind: 'srgbClr',
          attributes: { val: 'FF0000' },
          transforms: [{ kind: 'hueOff', attributes: { val: '7200000' } }],
        },
        { theme: source },
      )?.value,
    ).toBe('#00FF00')
    expect(
      resolveSourceColor(
        {
          kind: 'srgbClr',
          attributes: { val: 'FF0000' },
          transforms: [
            { kind: 'unknownTransform', attributes: { val: '50000' } },
          ],
        },
        { theme: source },
      ),
    ).toBeUndefined()
    expect(
      resolveSourceColor(
        {
          kind: 'srgbClr',
          attributes: { val: 'FF0000' },
          transforms: [{ kind: 'alpha', attributes: { val: 'invalid' } }],
        },
        { theme: source },
      ),
    ).toBeUndefined()
  })
  it('merges a local theme override without overwriting source facts', () => {
    const base = theme([
      {
        role: 'accent1',
        kind: 'srgbClr',
        attributes: { val: '224466' },
        transforms: [],
      },
    ])
    const override = theme([
      {
        role: 'accent1',
        kind: 'srgbClr',
        attributes: { val: 'CC5533' },
        transforms: [],
      },
    ])
    const merged = mergeThemeDefinition(base, override)
    expect(resolveThemeColors(base).colors.accent1?.value).toBe('#224466')
    expect(resolveThemeColors(merged).colors.accent1?.value).toBe('#CC5533')
  })
  it('resolves scheme colors through a page mapping without inventing unresolved values', () => {
    const result = resolveThemeColors(
      theme([
        {
          role: 'lt1',
          kind: 'sysClr',
          attributes: { val: 'windowText', lastClr: 'FDFDFD' },
          transforms: [],
        },
        {
          role: 'dk1',
          kind: 'sysClr',
          attributes: { val: 'windowText', lastClr: '111111' },
          transforms: [],
        },
        {
          role: 'accent1',
          kind: 'srgbClr',
          attributes: { val: '224466' },
          transforms: [],
        },
        {
          role: 'accent2',
          kind: 'srgbClr',
          attributes: { val: 'CC5533' },
          transforms: [],
        },
        {
          role: 'unknown',
          kind: 'schemeClr',
          attributes: { val: 'missing' },
          transforms: [],
        },
      ]),
      { accent1: 'accent2' },
    )
    expect(result.colors.accent1?.value).toBe('#224466')
    expect(result.colors.unknown).toBeUndefined()
    expect(result.unresolved).toEqual(['unknown'])
    expect(
      resolveThemeColors(
        theme([
          {
            role: 'accent1',
            kind: 'srgbClr',
            attributes: { val: '224466' },
            transforms: [],
          },
        ]),
        { accent1: 'accent2' },
      ).colors.accent1?.value,
    ).toBe('#224466')
  })

  it('uses sysClr lastClr and preserves alpha and transform order', () => {
    const result = resolveThemeColors(
      theme([
        {
          role: 'accent1',
          kind: 'sysClr',
          attributes: { val: 'windowText', lastClr: '808080' },
          transforms: [
            { kind: 'tint', attributes: { val: '50000' } },
            { kind: 'alpha', attributes: { val: '25000' } },
          ],
        },
      ]),
    )
    expect(result.colors.accent1).toMatchObject({
      value: '#CDCDCD',
      alpha: 0.25,
    })
    expect(result.colors.accent1?.transforms).toEqual([
      { kind: 'tint', value: 0.5 },
      { kind: 'alpha', value: 0.25 },
    ])
  })

  it('resolves phClr and explicit color transforms from DrawingML', () => {
    const source = `<a:solidFill xmlns:a="${DRAWING_NS}"><a:schemeClr val="phClr"><a:lumMod val="50000"/></a:schemeClr></a:solidFill>`
    const result = resolveColorElement(parseXml(source), {
      theme: theme([
        {
          role: 'accent1',
          kind: 'srgbClr',
          attributes: { val: '224466' },
          transforms: [],
        },
      ]),
      phClrBase: '#FFFFFF',
      sourcePart: 'ppt/slides/slide1.xml',
    })
    expect(result).toMatchObject({
      value: '#808080',
      source: {
        kind: 'schemeClr',
        role: 'phClr',
        sourcePart: 'ppt/slides/slide1.xml',
      },
    })
  })
})
