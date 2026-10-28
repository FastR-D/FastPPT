import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { materializeMasterObjects } from '../src/server/master-objects.js'
import { parseXml, PRESENTATION_NS } from '../src/server/slide-xml.js'
import type { NativeMasterLayout } from '../src/server/master-layout.js'
const objects = { canvas: { width: 100, height: 100 }, objects: [{ name: 'Brand', x: 10, y: 20, width: 30, height: 40, text: 'Shared & editable', fontSize: 12 }] }
it('stores shared objects once in the related master with unique IDs and scaled geometry', async () => {
  const zip = new JSZip()
  const master = `<m:sldMaster xmlns:m="${PRESENTATION_NS}"><m:cSld><m:spTree><m:nvGrpSpPr><m:cNvPr id="1"/></m:nvGrpSpPr><m:grpSpPr/><m:sp><m:nvSpPr><m:cNvPr id="20"/></m:nvSpPr></m:sp></m:spTree></m:cSld></m:sldMaster>`
  zip.file('ppt/slideMasters/custom.xml', master)
  const layouts: NativeMasterLayout[] = ['A', 'B'].map(name => ({ name, masterId: 'Brand', masterObjects: objects, placeholders: [] }))
  for (const name of ['A', 'B']) {
    zip.file(`ppt/slideLayouts/${name}.xml`, '<unchanged/>')
    zip.file(`ppt/slideLayouts/_rels/${name}.xml.rels`, '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/custom.xml"/></Relationships>')
  }
  await materializeMasterObjects(zip, layouts, new Map(layouts.map(layout => [layout.name, `ppt/slideLayouts/${layout.name}.xml`])), { width: 200, height: 300 })
  const xml = await zip.file('ppt/slideMasters/custom.xml')!.async('string')
  expect(xml.match(/Shared &amp; editable/g)).toHaveLength(1)
  expect(xml).toContain('id="21" name="Brand"')
  expect(xml).toContain('<a:off x="20" y="60"/>')
  expect(xml).toContain('<a:ext cx="60" cy="120"/>')
  expect(xml).toContain('sz="2400"')
  expect(() => parseXml(xml)).not.toThrow()
  expect(await zip.file('ppt/slideLayouts/A.xml')!.async('string')).toBe('<unchanged/>')
  expect(objects.objects[0]!.x).toBe(10)
})
it('rejects conflicting group objects before any mutation', async () => {
  const zip = new JSZip()
  await expect(materializeMasterObjects(zip, [
    { name: 'A', placeholders: [], masterObjects: objects },
    { name: 'B', placeholders: [], masterObjects: { ...objects, objects: [] } },
  ], new Map())).rejects.toThrow('Conflicting fixed objects')
  expect(Object.keys(zip.files)).toHaveLength(0)
})
