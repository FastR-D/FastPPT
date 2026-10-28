import { expect, it } from 'vitest'
import { layoutSystemSfc, resolveMasterGroupThemes } from '../src/theme-design.js'
it('scopes master fonts and accents to the corresponding browser layout', () => {
  const source = layoutSystemSfc({ id: 'brand', label: 'Brand', purpose: 'Test', composition: 'centered', regions: ['content'], nativeMasterTheme: { fontFamily: 'Brand Serif', colors: ['112233', 'AABBCC'] } })
  expect(source).toContain('.fastppt-layout-brand { --fastppt-design-heading-font:"Brand Serif"')
  expect(source).toContain('--fastppt-design-primary:#112233')
  expect(source).toContain('--fastppt-design-accent:#AABBCC')
  expect(source).toContain('--ext-primary:#112233')
  expect(source).not.toContain(':root')
})
it('does not allow a font name to terminate generated scoped styles', () => {
  const source = layoutSystemSfc({ id: 'brand', label: 'Brand', purpose: 'Test', composition: 'centered', regions: ['content'], nativeMasterTheme: { fontFamily: '</style><script>bad</script>' } })
  expect(source.match(/<\/style>/g)).toHaveLength(1)
  expect(source).not.toContain('<script>')
})

it('propagates normalized group themes without changing input or leaking across groups', () => {
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'] }
  const input: Parameters<typeof resolveMasterGroupThemes>[0] = [
    { ...base, id: 'a', nativeMasterId: 'brand', nativeMasterTheme: { colors: ['aabbcc'], fontFamily: 'Inter' } },
    { ...base, id: 'b', nativeMasterId: 'brand' },
    { ...base, id: 'c', nativeMasterId: 'other' },
  ]
  const output = resolveMasterGroupThemes(input)
  expect(output[1]?.nativeMasterTheme).toEqual({ colors: ['AABBCC'], fontFamily: 'Inter' })
  expect(output[2]?.nativeMasterTheme).toBeUndefined()
  expect(input[1]).not.toHaveProperty('nativeMasterTheme')
  output[1]!.nativeMasterTheme!.colors![0] = '000000'
  expect(output[0]?.nativeMasterTheme?.colors).toEqual(['AABBCC'])
  expect(input[0]?.nativeMasterTheme?.colors).toEqual(['aabbcc'])
  expect(() => resolveMasterGroupThemes([...input, { ...base, id: 'conflict', nativeMasterId: 'brand', nativeMasterTheme: { fontFamily: 'Arial' } }])).toThrow('Conflicting theme definitions')
})

it('propagates master objects and distinguishes them from same-named layout objects', () => {
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'] }
  const object = { anchor: 'brand-logo', name: 'Brand', x: 10, y: 10, width: 20, height: 20, text: '{{ literal }} <text>', language: 'de-DE', alternativeLanguage: '' }
  const layouts = resolveMasterGroupThemes([
    { ...base, id: 'a', nativeMasterId: 'brand', nativeMasterObjects: { canvas: { width: 100, height: 100 }, objects: [object] } },
    { ...base, id: 'b', nativeMasterId: 'brand', nativeCanvas: { width: 200, height: 200 }, nativeFixedObjects: [object] },
    { ...base, id: 'c', nativeMasterId: 'other' },
  ])
  const source = layoutSystemSfc(layouts[1]!)
  expect(source).toContain('data-fastppt-group="brand-logo"')
  expect(source).toContain('data-fastppt-object-scope="master"')
  expect(source).toContain('data-fastppt-object-scope="layout"')
  expect(source).toContain('left:10%')
  expect(source).toContain('left:5%')
  expect(source).toContain('{{ literal }} &lt;text&gt;')
  expect(source.match(/lang="de-DE" data-fastppt-alt-lang=""/g)).toHaveLength(2)
  expect(layouts[2]?.nativeMasterObjects).toBeUndefined()
  layouts[1]!.nativeMasterObjects!.objects[0]!.x = 50
  expect(layouts[0]!.nativeMasterObjects!.objects[0]!.x).toBe(10)
  expect(object.x).toBe(10)
  expect(() => resolveMasterGroupThemes([layouts[0]!, layouts[1]!])).toThrow('Conflicting fixed objects')
})

it('projects uniform fixed decoration through master propagation into generated browser layouts', () => {
  const object = { name: 'Both', text: 'Brand', x: 0, y: 0, width: 100, height: 100, underline: true, strike: true }
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'], nativeMasterId: 'brand' }
  const layouts = resolveMasterGroupThemes([{ ...base, id: 'first', nativeMasterObjects: { canvas: { width: 100, height: 100 }, objects: [object] } }, { ...base, id: 'second' }])
  expect(layouts[1]!.nativeMasterObjects!.objects[0]).toMatchObject({ underline: true, strike: true })
  expect(layoutSystemSfc(layouts[1]!)).toContain('text-decoration-line:underline line-through')
  expect(layoutSystemSfc({ ...layouts[1]!, nativeMasterObjects: { canvas: { width: 100, height: 100 }, objects: [{ ...object, underline: false }] } })).toContain('text-decoration-line:line-through')
})


it('propagates fixed letter spacing through master groups and scales it with the source canvas', () => {
  const object = { name: 'Spaced', text: 'Brand', x: 0, y: 0, width: 100000, height: 100000, letterSpacing: -1.25 }
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'], nativeMasterId: 'brand' }
  const layouts = resolveMasterGroupThemes([{ ...base, id: 'first', nativeMasterObjects: { canvas: { width: 1270000, height: 1000000 }, objects: [object] } }, { ...base, id: 'second', nativeCanvas: { width: 2540000, height: 1000000 }, nativeFixedObjects: [{ ...object, letterSpacing: 0 }] }])
  expect(layouts[1]!.nativeMasterObjects!.objects[0]!.letterSpacing).toBe(-1.25)
  expect(layoutSystemSfc(layouts[1]!)).toContain('letter-spacing:-1.25cqw')
  expect(layoutSystemSfc(layouts[1]!)).toContain('letter-spacing:0cqw')
})

it('keeps fixed baseline displacement inside the object box with its declared font size and decoration', () => {
  const object = { name: 'Lowered', text: '{{ Brand }}', x: 0, y: 0, width: 100000, height: 100000, fontSize: 20, baselinePercent: -25, underline: true }
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'], nativeMasterId: 'brand' }
  const layouts = resolveMasterGroupThemes([{ ...base, id: 'first', nativeMasterObjects: { canvas: { width: 1270000, height: 1000000 }, objects: [object] } }, { ...base, id: 'second' }])
  expect(layouts[1]!.nativeMasterObjects!.objects[0]).toMatchObject({ baselinePercent: -25, fontSize: 20 })
  const source = layoutSystemSfc(layouts[1]!)
  expect(source).toContain('data-fastppt-text-baseline-run="-25"')
  expect(source).toContain('top:0.25em;vertical-align:baseline;text-decoration-line:underline')
  expect(source).toContain('font-size:20cqw')
  expect(source).toContain('{{ Brand }}</span></div>')
})

it('generates an independent kerning runtime for inherited fixed text with dynamic font sizes', () => {
  const object = { name: 'Pairs', text: '{{ AV }}', x: 0, y: 0, width: 100000, height: 100000, fontSize: 20, kerningThreshold: 30 }
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'], nativeMasterId: 'brand' }
  const layouts = resolveMasterGroupThemes([{ ...base, id: 'first', nativeMasterObjects: { canvas: { width: 1270000, height: 1000000 }, objects: [object] } }, { ...base, id: 'second' }])
  expect(layouts[1]!.nativeMasterObjects!.objects[0]!.kerningThreshold).toBe(30)
  const source = layoutSystemSfc(layouts[1]!)
  expect(source).toContain('ref="kerningRoot" data-fastppt-kerning-root')
  expect(source).toContain('data-fastppt-text-kerning="{&quot;threshold&quot;:30,&quot;canvasWidth&quot;:1270000}"')
  expect(source).toContain('MutationObserver')
  expect(source).toContain('{{ AV }}</span></div>')
})

it('projects fixed capitalization on a leaf and preserves source text through master propagation', () => {
  const object = { name: 'Caps', text: 'Straße {{ i }}', x: 0, y: 0, width: 100000, height: 100000, capitalization: 'small' as const }
  const base = { label: 'Layout', purpose: 'Test', composition: 'centered' as const, regions: ['content'], nativeMasterId: 'brand' }
  const layouts = resolveMasterGroupThemes([{ ...base, id: 'first', nativeMasterObjects: { canvas: { width: 1270000, height: 1000000 }, objects: [object] } }, { ...base, id: 'second' }])
  expect(layouts[1]!.nativeMasterObjects!.objects[0]).toMatchObject({ text: object.text, capitalization: 'small' })
  const source = layoutSystemSfc(layouts[1]!)
  expect(source).toContain('data-fastppt-text-capitalization-run="&quot;small&quot;"')
  expect(source).toContain('text-transform:none;font-variant-caps:small-caps;')
  expect(source).toContain('Straße {{ i }}')
  expect(source).toContain('v-pre')
})

it('projects fixed RTL direction into the standalone source layout contract', () => {
  const object = { name: 'RTL', text: 'שלום 123 ABC', x: 0, y: 0, width: 100000, height: 100000, direction: 'rtl' as const }
  const source = layoutSystemSfc({ id: 'rtl', label: 'RTL', purpose: 'Direction', composition: 'centered', regions: ['content'], nativeCanvas: { width: 100000, height: 100000 }, nativeFixedObjects: [object] })
  expect(source).toContain('direction:rtl')
  expect(source).toContain('dir="rtl"')
  expect(source).toContain('שלום 123 ABC')
})
