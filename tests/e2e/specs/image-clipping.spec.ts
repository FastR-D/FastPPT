import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import type { HtmlImageElement, HtmlSlideSnapshot } from '@fastppt/slidewave/snapshot'
import { writeEditablePptx } from '@fastppt/slidewave/server'

const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+QWc9WQAAAABJRU5ErkJggg=='
const fixture = `<style>
#clip-root { position:relative;width:980px;height:552px;background:white;transform-origin:top left; }
#clip-root img { position:absolute;max-width:none; }
#clip-root .frame { position:absolute;left:30px;top:70px;width:200px;height:150px;border:10px solid black;overflow:hidden;box-sizing:content-box; }
</style><div id="clip-root"><h1 style="margin:0;font:24px Arial">Editable crop</h1>
<div class="frame"><img alt="cropped" src="${data}" style="left:0;top:-50px;width:200px;height:200px"></div>
<div style="position:absolute;left:300px;top:70px;width:100px;height:100px;overflow:hidden"><img alt="hidden" src="${data}" style="left:120px;top:0;width:20px;height:20px"></div>
<img alt="untouched" src="${data}" style="left:500px;top:70px;width:100px;height:100px">
</div>`

async function capture(page: Page) {
  return page.evaluate(async path => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement, options: { snapshotVersion: number }) => Promise<HtmlSlideSnapshot> }
    return captureHtmlSlide(document.querySelector<HTMLElement>('#clip-root')!, { snapshotVersion: 2 })
  }, capturePath)
}
const images = (slide: HtmlSlideSnapshot) => slide.elements.filter((e): e is HtmlImageElement => e.kind === 'image')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(html => { document.body.innerHTML = html }, fixture)
})

test('preserves the padding-box crop through scaled browser capture and native PPTX export', async ({ page }, testInfo) => {
  const slide = await capture(page)
  expect(images(slide).map(e => e.alt)).toEqual(['cropped', 'untouched'])
  const cropped = images(slide)[0]!
  expect(cropped.box).toEqual({ x: 40, y: 80, width: 200, height: 150 })
  expect(cropped.crop).toEqual({ left: 0, top: 0.25, right: 0, bottom: 0 })
  expect(images(slide)[1]!.crop).toBeUndefined()
  expect(cropped.data).toBe(data)
  await page.evaluate(() => { document.querySelector<HTMLElement>('#clip-root')!.style.transform = 'scale(.8)' })
  const scaled = await capture(page)
  const scaledImage = images(scaled)[0]!
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(scaledImage.box[key]).toBeCloseTo(cropped.box[key], 3)
  expect(scaledImage.crop!.top).toBeCloseTo(0.25, 4)
  const deck = HtmlDeckSnapshotSchema.parse({ version: 2, source: 'slidev', warnings: scaled.warnings, slides: [scaled] })
  const path = testInfo.outputPath('image-clipping.pptx')
  await writeEditablePptx(deck, path, { policy: 'strict-editable', embedFonts: false })
  const zip = await JSZip.loadAsync(await readFile(path))
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(xml).toContain('<a:srcRect l="0" r="0" t="25000" b="0"/>')
  expect(xml.match(/<p:pic>/g)).toHaveLength(2)
  expect(xml).toContain('Editable crop')
  const pngs = Object.keys(zip.files).filter(name => /^ppt\/media\/.*\.png$/.test(name))
  expect(pngs.length).toBeGreaterThan(0)
  for (const name of pngs) expect(await zip.file(name)!.async('base64')).toBe(data.split(',')[1])
})

test('intersects nested scroll and clip containers before deriving source fractions', async ({ page }) => {
  await page.evaluate(data => {
    document.querySelector('#clip-root')!.innerHTML = `<div style="position:absolute;left:50px;top:50px;width:150px;height:160px;overflow:auto"><div style="position:relative;left:-20px;top:-30px;width:200px;height:200px;overflow:clip"><img src="${data}" style="left:-10px;top:-10px;width:240px;height:240px"></div></div>`
  }, data)
  const image = images(await capture(page))[0]!
  expect(image.box.x).toBeCloseTo(50)
  expect(image.box.y).toBeCloseTo(50)
  expect(image.box.width).toBeCloseTo(150)
  expect(image.box.height).toBeCloseTo(160)
  expect(image.crop!.left).toBeCloseTo(30 / 240)
  expect(image.crop!.top).toBeCloseTo(40 / 240)
  expect(image.crop!.right).toBeCloseTo(60 / 240)
  expect(image.crop!.bottom).toBeCloseTo(40 / 240)
})
