import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, rm } from 'node:fs/promises'
import JSZip from 'jszip'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import type {
  HtmlSlideSnapshot,
  HtmlTableElement,
} from '@fastppt/slidewave/snapshot'
import {
  writeEditablePptx,
  EditablePptxPolicyError,
} from '@fastppt/slidewave/server'

const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
const fixture = `<style>
#native-root { position:relative; width:980px; height:552px; background:white; color:black; font:16px Arial; transform-origin:top left; }
#native-root table { position:absolute; left:40px; top:80px; width:800px; border-collapse:collapse; table-layout:fixed; margin:0; font:16px Arial; line-height:24px; }
#native-root th, #native-root td { border:1px solid #808080; padding:4px 8px; vertical-align:middle; text-align:left; height:64px; color:black; }
#native-root th { background:#3b99d4; color:white; font-weight:700; }
#native-root a { color:#174EA6; }
#native-root caption { caption-side:top; text-align:left; color:black; }
</style><div id="native-root"><h1 style="position:absolute;left:40px;top:10px;font:24px Arial">原生表格</h1>
<table id="metrics" data-fastppt-group="metrics"><caption>季度指标</caption><colgroup><col style="width:35%"><col style="width:65%"></colgroup><thead><tr><th>指标 <span style="font-weight:400">Metric</span></th><th>数值 Value</th></tr></thead><tbody><tr><td>中文 <strong>加粗</strong></td><td><a href="https://example.com/data">100 &amp; 200</a><br>下一行</td></tr><tr><td></td><td>one <em>two</em> three long text that should wrap naturally in the measured cell</td></tr></tbody></table></div>`

async function capture(page: Page, version: 1 | 2 = 2) {
  return page.evaluate(
    async ({ path, version }) => {
      const { captureHtmlSlide } = (await import(path)) as {
        captureHtmlSlide: (
          root: HTMLElement,
          options: { snapshotVersion: number },
        ) => Promise<HtmlSlideSnapshot>
      }
      return captureHtmlSlide(
        document.querySelector<HTMLElement>('#native-root')!,
        { snapshotVersion: version },
      )
    },
    { path: capturePath, version },
  )
}
const deck = (slide: HtmlSlideSnapshot) =>
  HtmlDeckSnapshotSchema.parse({
    version: slide.version,
    source: 'slidev',
    warnings: slide.warnings,
    slides: [slide],
  })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate((html) => {
    document.body.innerHTML = html
  }, fixture)
})

test('captures the table once, preserves caption/rich text and writes an editable native table after scaling and editing', async ({
  page,
}, testInfo) => {
  const slide = await capture(page)
  const tables = slide.elements.filter(
    (element): element is HtmlTableElement => element.kind === 'table',
  )
  expect(slide.warnings).toEqual([])
  expect(tables).toHaveLength(1)
  const table = tables[0]!
  expect(table.columnWidthsPx).toHaveLength(2)
  expect(table.rowHeightsPx).toHaveLength(3)
  expect(table.cells.map((cell) => cell.text)).toEqual([
    '指标 Metric',
    '数值 Value',
    '中文 加粗',
    '100 & 200\n下一行',
    '',
    'one two three long text that should wrap naturally in the measured cell',
  ])
  expect(
    table.cells[2]!.runs.some(
      (run) => run.text === '加粗' && run.style.fontWeight === 700,
    ),
  ).toBe(true)
  expect(
    table.cells[3]!.runs.some(
      (run) => run.hyperlink === 'https://example.com/data',
    ),
  ).toBe(true)
  expect(
    slide.elements.some(
      (element) => element.kind === 'text' && element.text === '季度指标',
    ),
  ).toBe(true)
  expect(
    slide.elements.filter(
      (element) =>
        element !== table &&
        element.source.path.startsWith(`${table.source.path}/`) &&
        !element.source.path.includes('caption'),
    ),
  ).toHaveLength(0)
  await page
    .locator('#native-root')
    .screenshot({ path: testInfo.outputPath('browser.png') })
  await writeFile(testInfo.outputPath('snapshot.json'), JSON.stringify(deck(slide), null, 2))
  const path = testInfo.outputPath('native-table.pptx')
  const result = await writeEditablePptx(deck(slide), path, {
    policy: 'strict-editable',
    embedFonts: false,
  })
  expect(
    result.objects.find((object) => object.kind === 'table')?.verification
      ?.structure,
  ).toBe('passed')
  const zip = await JSZip.loadAsync(await readFile(path)),
    xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(xml.match(/<a:tbl>/g)).toHaveLength(1)
  expect(xml.match(/<a:tc>/g)).toHaveLength(6)
  expect(xml).toContain('name="fastppt:metrics"')
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#native-root')!.style.transform =
      'scale(.8)'
    document.querySelectorAll('#metrics td')[0]!.textContent = '编辑后的中文'
  })
  const changed = await capture(page),
    edited = changed.elements.find((element) => element.kind === 'table')!
  expect(edited.cells[2]!.text).toBe('编辑后的中文')
  expect(edited.box.x).toBeCloseTo(table.box.x, 2)
  expect(edited.box.width).toBeCloseTo(table.box.width, 2)
  await writeEditablePptx(deck(changed), testInfo.outputPath('edited.pptx'), {
    policy: 'strict-editable',
    embedFonts: false,
  })
})

test('keeps V1 capture compatible and marks unsupported V2 merged cells as semantic loss', async ({
  page,
}, testInfo) => {
  const legacy = await capture(page, 1)
  expect(legacy.version).toBe(1)
  expect(legacy.elements.some((element) => element.kind === 'table')).toBe(
    false,
  )
  expect(legacy.elements.some((element) => element.structure)).toBe(false)
  deck(legacy)
  await page.evaluate(() => {
    const row =
      document.querySelector<HTMLTableRowElement>('#metrics thead tr')!
    row.cells[0]!.colSpan = 2
    row.cells[1]!.remove()
  })
  const fallback = await capture(page)
  expect(
    fallback.warnings.some((warning) => warning.code === 'unsupported-table'),
  ).toBe(true)
  expect(
    fallback.elements.some((element) => element.structure?.kind === 'table'),
  ).toBe(true)
  await expect(
    writeEditablePptx(deck(fallback), testInfo.outputPath('rejected.pptx'), {
      policy: 'strict-editable',
    }),
  ).rejects.toBeInstanceOf(EditablePptxPolicyError)
  const result = await writeEditablePptx(
    deck(fallback),
    testInfo.outputPath('fallback.pptx'),
    { policy: 'editable' },
  )
  expect(
    result.objects.some((object) => object.semanticPreserved === false),
  ).toBe(true)
})

test('rejects incomplete grids instead of losing cells and reports unsupported effects explicitly', async ({
  page,
}) => {
  await page.evaluate(() => {
    document
      .querySelector<HTMLTableRowElement>('#metrics tbody tr')!
      .cells[1]!.remove()
  })
  const invalid = await capture(page)
  expect(
    invalid.warnings.some((warning) => warning.code === 'invalid-snapshot'),
  ).toBe(true)
  await page.evaluate((html) => {
    document.body.innerHTML = html
  }, fixture)
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#metrics td')!.style.backgroundImage =
      'linear-gradient(red, blue)'
  })
  const unsupported = await capture(page)
  expect(
    unsupported.warnings.some(
      (warning) => warning.code === 'unsupported-table',
    ),
  ).toBe(true)
  expect(unsupported.elements.some((element) => element.structure)).toBe(true)
})

test('negotiates V2 through the workbench and Gateway for an actual Markdown table export', async ({
  page,
  request,
}, testInfo) => {
  const source = '/tmp/fastppt-e2e-workspace/native-structured.md'
  await writeFile(
    source,
    `---
theme: slidev-theme-academy
layout: default
---

# 原生数据表格

| 指标 | 数值 |
| --- | --- |
| **吞吐量** | 100 |
| 延迟 | 20 ms |

<style>
table { border-collapse: collapse !important; width: 80%; font-size: 18px; line-height: 1.4; }
th, td { border: 1px solid #808080 !important; border-radius: 0 !important; padding: 8px; vertical-align: middle; }
</style>
`,
  )
  try {
    await page.goto('/')
    const picker = page.getByLabel('Preview deck')
    await expect(picker).toBeVisible()
    await picker.selectOption({ label: 'native-structured' })
    await expect(
      page
        .getByTitle('Slidev preview')
        .contentFrame()
        .getByRole('heading', { name: '原生数据表格' }),
    ).toBeVisible()
    await page.locator('.export-options summary').click()
    await page.getByLabel('导出策略').selectOption('strict-editable')
    await page.getByLabel('导出审查', { exact: true }).uncheck()
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/decks\/[^/]+\/exports$/.test(new URL(response.url()).pathname),
    )
    const submitted = page.waitForRequest((request) =>
      /\/exports\/[^/]+\/snapshot$/.test(new URL(request.url()).pathname),
    )
    await page.getByRole('button', { name: '导出 PPTX', exact: true }).click()
    const job = (await (await started).json()) as {
      id: string
      snapshotVersions: number[]
    }
    expect(job.snapshotVersions).toEqual([1, 2])
    const snapshot = (await submitted).postDataJSON() as {
      snapshot?: unknown
      version?: number
    }
    const parsed = HtmlDeckSnapshotSchema.parse(snapshot.snapshot ?? snapshot)
    expect(parsed.version).toBe(2)
    expect(
      parsed.slides[0]!.elements.some((element) => element.kind === 'table'),
    ).toBe(true)
    await expect
      .poll(
        async () =>
          (
            (await (
              await request.get(
                `http://127.0.0.1:4317/api/v1/exports/${job.id}`,
              )
            ).json()) as { status: string }
          ).status,
      )
      .toBe('completed')
    const result = (await (
      await request.get(`http://127.0.0.1:4317/api/v1/exports/${job.id}`)
    ).json()) as {
      objects: Array<{
        kind: string
        semanticPreserved: boolean
        verification: { structure: string }
      }>
    }
    expect(
      result.objects.find((object) => object.kind === 'table'),
    ).toMatchObject({
      semanticPreserved: true,
      verification: { structure: 'passed' },
    })
    const download = await request.get(
      `http://127.0.0.1:4317/api/v1/exports/${job.id}/download`,
    )
    expect(download.ok()).toBe(true)
    const bytes = await download.body()
    await writeFile(testInfo.outputPath('workbench.pptx'), bytes)
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain(
      '<a:tbl>',
    )
  } finally {
    await rm(source, { force: true })
  }
})
