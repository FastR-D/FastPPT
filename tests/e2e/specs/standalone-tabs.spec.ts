import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { writeEditablePptx } from '@fastppt/slidewave/server'

test('generated theme preserves source tabs in standalone Slidev without the host hook', async ({
  page,
}) => {
  const repository = fileURLToPath(new URL('../../..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-standalone-tabs-'))
  const hostRequire = createRequire(
    join(repository, 'packages/slidev-host/package.json'),
  )
  let server: ReturnType<typeof spawn> | undefined
  let serverOutput = ''
  try {
    const source = join(directory, 'source.pptx')
    await writeEditablePptx(
      HtmlDeckSnapshotSchema.parse({
        version: 1,
        source: 'slidev',
        warnings: [],
        slides: [
          {
            version: 1,
            id: '1',
            width: 960,
            height: 540,
            elements: [],
            warnings: [],
          },
        ],
      }),
      source,
      { embedFonts: false },
    )
    await promisify(execFile)(process.execPath, [
      join(repository, 'scripts/extract-theme.mjs'),
      source,
      '--name',
      'standalone-tabs',
      '--out',
      directory,
    ])
    const theme = join(directory, 'slidev-theme-standalone-tabs')
    const manifest = JSON.parse(
      await readFile(join(theme, 'package.json'), 'utf8'),
    ) as { files: string[] }
    expect(manifest.files).toContain('setup')
    await cp(
      '/tmp/fastppt-e2e-workspace/layouts/source-tabs.vue',
      join(theme, 'layouts/source-tabs.vue'),
    )
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-wrapped-tabs.vue', join(theme, 'layouts/source-wrapped-tabs.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-bullet-geometry.vue', join(theme, 'layouts/source-bullet-geometry.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-decorations.vue', join(theme, 'layouts/source-decorations.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-letter-spacing.vue', join(theme, 'layouts/source-letter-spacing.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-baseline.vue', join(theme, 'layouts/source-baseline.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-kerning.vue', join(theme, 'layouts/source-kerning.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/mcp-kerning.vue', join(theme, 'layouts/mcp-kerning.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-capitalization.vue', join(theme, 'layouts/source-capitalization.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/source-rtl.vue', join(theme, 'layouts/source-rtl.vue'))
    await cp('/tmp/fastppt-e2e-workspace/layouts/mcp-capitalization.vue', join(theme, 'layouts/mcp-capitalization.vue'))
    // Link only the theme's declared local font dependency, as an installation would.
    await mkdir(join(theme, 'node_modules/@fastppt'), { recursive: true })
    await symlink(
      resolve(repository, 'packages/fonts'),
      join(theme, 'node_modules/@fastppt/fonts'),
    )
    const entry = join(directory, 'slides.md')
    await writeFile(
      entry,
      '---\ntheme: slidev-theme-standalone-tabs\nlayout: source-tabs\n---\n\n::ph-0::\n\n<div id="standalone-frame" data-fastppt-text-box><p>A\tB&#9;C</p></div><div id="standalone-decimal" data-fastppt-text-box><p data-fastppt-level="7">A\t12<strong data-separator>.</strong>34</p><p data-fastppt-level="8">A&#9;12<strong data-separator>,</strong>34</p></div>\n\n---\nlayout: source-wrapped-tabs\n---\n\n::ph-0::\n\n<div id="standalone-flow" data-fastppt-text-box><p data-fastppt-level="5">ABCDEFGHIJKLMN\tB</p><p data-fastppt-level="6">A\tB</p></div>\n\n---\nlayout: source-bullet-geometry\n---\n\n::ph-1::\n\n<div id="standalone-bullets" data-fastppt-text-box><p data-fastppt-level="3">AAAA BBBB</p><p data-fastppt-level="7">AAAA BBBB</p><p data-fastppt-level="6">Points</p></div>\n\n---\nlayout: source-decorations\n---\n\n::ph-0::\n\n<div id="standalone-decorations" data-fastppt-text-box><p>Both 中文</p><p data-fastppt-level="2">Strike only</p><p data-fastppt-level="3">Underline<br>Next</p><p data-fastppt-level="5">A&#9;B</p><p data-fastppt-underline="false">Strike <span data-fastppt-strike="false">Neither</span></p></div>\n\n::ph-1::\n\n<p id="ordinary-decoration">Ordinary</p>\n\n---\nlayout: source-letter-spacing\n---\n\n::ph-0::\n\n<div id="standalone-spacing" data-fastppt-text-box><p>Expanded</p><p data-fastppt-level="2">Zero</p><p data-fastppt-level="3">Compact</p><p data-fastppt-level="5">A&#9;B</p><p>Latin中文</p></div>\n\n---\nlayout: source-baseline\n---\n\n::ph-0::\n\n<div id="standalone-baseline" data-fastppt-text-box><p>Raised</p><p data-fastppt-level="3">Lowered</p><p data-fastppt-baseline="0">Reset</p><p data-fastppt-level="4">A&#9;B</p></div>\n\n---\nlayout: source-kerning\n---\n\n::ph-0::\n\n<div id="standalone-kerning" data-fastppt-text-box><p>AVATAR</p><p data-fastppt-level="3">AVATAR</p><p data-fastppt-level="5">AV&#9;To</p></div>\n\n---\nlayout: mcp-kerning\n---\n\n---\nlayout: source-capitalization\n---\n\n::ph-0::\n\n<div id="standalone-capitalization" data-fastppt-text-box><p>Straße</p><p data-fastppt-level="3">Abc</p><p data-fastppt-level="5">Straße&#9;i</p></div>\n\n---\nlayout: mcp-capitalization\n---\n\n---\nlayout: source-rtl\n---\n\n::ph-0::\n\n<div id="standalone-rtl" data-fastppt-text-box><p>مرحبا بالعالم 123 ABC</p><p data-fastppt-level="2">שלום עולם 123 ABC</p></div>\n',
    )
    server = spawn(
      process.execPath,
      [
        hostRequire.resolve('@slidev/cli/bin/slidev.mjs'),
        entry,
        '--theme',
        theme,
        '--port',
        '4332',
      ],
      { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    server.stdout?.on('data', (data: Buffer) => {
      serverOutput += data.toString()
    })
    server.stderr?.on('data', (data: Buffer) => {
      serverOutput += data.toString()
    })
    const failed = new Promise<never>((_, reject) => {
      server!.once('error', reject)
      server!.once('exit', (code) =>
        reject(new Error(`Standalone Slidev exited ${code}: ${serverOutput}`)),
      )
    })
    await Promise.race([
      expect
        .poll(
          async () => {
            try {
              return (await fetch('http://127.0.0.1:4332')).ok
            } catch {
              return false
            }
          },
          { timeout: 30_000 },
        )
        .toBe(true),
      failed,
    ]).catch((cause: unknown) => {
      throw new Error(`Standalone Slidev did not become ready: ${serverOutput}`, { cause })
    })
    await page.goto('http://127.0.0.1:4332/1')
    const frame = page.locator('#standalone-frame')
    await expect(frame.locator('[data-fastppt-tab]')).toHaveCount(2)
    expect(await frame.textContent()).toBe('A\tB\tC')
    await expect
      .poll(() =>
        frame.locator('[data-fastppt-tab]').evaluateAll((elements) =>
          elements.map((element) => {
            const paragraph = element.closest('[data-fastppt-text-level]')!,
              root = element.closest('.source-layout')!
            return Math.round(
              ((element.getBoundingClientRect().right -
                paragraph.getBoundingClientRect().left) /
                root.getBoundingClientRect().width) *
                1000,
            )
          }),
        ),
      )
      .toEqual([100, 200])
    const decimal = page.locator('#standalone-decimal')
    expect(await decimal.textContent()).toBe('A\t12.34A\t12,34')
    await expect.poll(() => decimal.locator('[data-separator]').evaluateAll(elements => elements.map(element => {
      const paragraph = element.closest('[data-fastppt-text-level]')!, root = element.closest('.source-layout')!
      return Math.round((element.getBoundingClientRect().left - paragraph.getBoundingClientRect().left) / root.getBoundingClientRect().width * 1000)
    }))).toEqual([150, 150])
    await expect(decimal.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await page.goto('http://127.0.0.1:4332/2')
    const flow = page.locator('#standalone-flow')
    await expect(flow).toBeVisible()
    await expect.poll(() => flow.locator('[data-fastppt-tab]').evaluateAll(elements => elements.map(element => {
      const paragraph = element.closest('[data-fastppt-text-level]')!, root = element.closest('.source-layout')!, factor = 960 / root.getBoundingClientRect().width
      return [Math.round((element.getBoundingClientRect().left - paragraph.getBoundingClientRect().left) * factor), Math.round(element.getBoundingClientRect().width * factor), Math.round((element.getBoundingClientRect().top - paragraph.getBoundingClientRect().top) * factor)]
    }))).toEqual([[0, 72, 30], [0, 240, 30]])
    await expect(flow.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await page.goto('http://127.0.0.1:4332/3')
    const bullets = page.locator('#standalone-bullets')
    await expect(bullets).toBeVisible()
    const measured = () => bullets.locator('p').evaluateAll(elements => elements.map(element => {
      const root = element.closest('.source-layout')!, factor = 960 / parseFloat(getComputedStyle(root).width)
      const marker = element.querySelector('[data-fastppt-bullet-marker]')!, anchor = element.querySelector('[data-fastppt-bullet-anchor]')!, baseline = marker.querySelector('[data-fastppt-bullet-baseline]')!
      return { label: marker.textContent, prefix: Math.round(parseFloat(getComputedStyle(element).textIndent) * factor * 10) / 10, baseline: Math.round((baseline.getBoundingClientRect().top - anchor.getBoundingClientRect().top) * factor) }
    }))
    await expect.poll(measured).toEqual([{ label: '*', prefix: 32, baseline: 0 }, { label: '1234.', prefix: 40, baseline: 0 }, { label: '*', prefix: 41.6, baseline: 0 }])
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect.poll(measured).toEqual([{ label: '*', prefix: 32, baseline: 0 }, { label: '1234.', prefix: 40, baseline: 0 }, { label: '*', prefix: 41.6, baseline: 0 }])
    await expect(bullets.locator('[data-fastppt-bullet-error]')).toHaveCount(0)
    await page.goto('http://127.0.0.1:4332/4')
    const decorations = page.locator('#standalone-decorations')
    await expect(decorations).toBeVisible()
    const decorationStyles = () => decorations.locator('[data-fastppt-text-decoration-run]').evaluateAll(elements => elements.map(element => ({ text: element.textContent, line: getComputedStyle(element).textDecorationLine, skipInk: getComputedStyle(element).textDecorationSkipInk })))
    const expectedDecorations = [
      { text: 'Both ', line: 'underline line-through', skipInk: 'none' },
      { text: '中文', line: 'underline line-through', skipInk: 'none' },
      { text: 'Strike only', line: 'line-through', skipInk: 'none' },
      { text: 'Underline', line: 'underline', skipInk: 'none' },
      { text: 'Neither', line: 'none', skipInk: 'none' },
    ]
    await expect.poll(decorationStyles).toEqual(expect.arrayContaining(expectedDecorations))
    await expect(decorations.locator('[data-fastppt-tab]')).toHaveCount(1)
    await expect(decorations.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await expect(page.locator('#ordinary-decoration [data-fastppt-text-decoration-run]')).toHaveCSS('text-decoration-line', 'underline line-through')
    await page.setViewportSize({ width: 1500, height: 900 })
    await expect.poll(decorationStyles).toEqual(expect.arrayContaining(expectedDecorations))
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('Strike only', 'Edited strike').replace('data-fastppt-level="2"', 'data-fastppt-level="9"'))
    await expect(decorations).toContainText('Edited strike')
    await expect.poll(decorationStyles).toEqual(expect.arrayContaining([{ text: 'Edited strike', line: 'none', skipInk: 'none' }]))
    await page.goto('http://127.0.0.1:4332/5')
    const spacing = page.locator('#standalone-spacing')
    await expect(spacing).toBeVisible()
    const spacingValues = () => spacing.locator('p').evaluateAll(elements => elements.map(element => Number(((parseFloat(getComputedStyle(element).letterSpacing) || 0) * 960 / parseFloat(getComputedStyle(element.closest('.source-layout')!).width)).toFixed(2))))
    await expect.poll(spacingValues).toEqual([2, 0, -2, 2, 2])
    await expect(spacing.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect.poll(spacingValues).toEqual([2, 0, -2, 2, 2])
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('data-fastppt-level="2">Zero', 'data-fastppt-level="3">Edited compact'))
    await expect(spacing).toContainText('Edited compact')
    await expect.poll(spacingValues).toEqual([2, -2, -2, 2, 2])
    await page.goto('http://127.0.0.1:4332/6')
    const baseline = page.locator('#standalone-baseline')
    await expect(baseline).toBeVisible()
    const baselines = () => baseline.locator('[data-fastppt-text-baseline-run]').evaluateAll(elements => elements.map(element => {
      const css = getComputedStyle(element)
      return Number((-100 * parseFloat(css.top) / parseFloat(css.fontSize)).toFixed(2)) || 0
    }))
    await expect.poll(baselines).toEqual([30, -25, 0, 30, 30, 30])
    await page.setViewportSize({ width: 1500, height: 900 })
    await expect.poll(baselines).toEqual([30, -25, 0, 30, 30, 30])
    await expect(baseline.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('data-fastppt-baseline="0">Reset', 'data-fastppt-baseline="-10">Edited baseline'))
    await expect(baseline).toContainText('Edited baseline')
    await expect.poll(baselines).toEqual([30, -25, -10, 30, 30, 30])
    await page.goto('http://127.0.0.1:4332/7')
    const kerning = page.locator('#standalone-kerning')
    await expect(kerning).toBeVisible()
    const modes = () => kerning.locator('p > [data-fastppt-script-text] > span').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontKerning))
    await expect.poll(modes).toEqual(['normal', 'none', 'normal', 'normal'])
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect.poll(modes).toEqual(['normal', 'none', 'normal', 'normal'])
    await expect(kerning.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('data-fastppt-level="3">AVATAR', 'data-fastppt-level="2">Edited AVATAR'))
    await expect(kerning).toContainText('Edited AVATAR')
    await expect.poll(modes).toEqual(['normal', 'normal', 'normal', 'normal'])
    await page.goto('http://127.0.0.1:4332/8')
    const fixedKerning = page.locator('[data-fastppt-layout-object="MCP Pairs"] > span')
    await expect(fixedKerning).toHaveCSS('font-kerning', 'none')
    await fixedKerning.evaluate(element => { (element as HTMLElement).style.fontSize = '4cqw' })
    await expect(fixedKerning).toHaveCSS('font-kerning', 'normal')
    await page.goto('http://127.0.0.1:4332/9')
    const capitalization = page.locator('#standalone-capitalization')
    await expect(capitalization).toBeVisible()
    const capitalizationText = () => capitalization.locator('p').evaluateAll(elements => elements.map(element => ({ original: element.textContent, display: (element as HTMLElement).innerText })))
    await expect.poll(capitalizationText).toEqual([{ original: 'Straße', display: 'STRASSE' }, { original: 'Abc', display: 'Abc' }, { original: 'Straße\ti', display: 'STRASSE\tI' }])
    await expect(capitalization.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await page.setViewportSize({ width: 1500, height: 900 })
    await expect(capitalization.locator('[data-fastppt-tab-error]')).toHaveCount(0)
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('<p>Straße</p>', '<p data-fastppt-capitalization="none">Edited Straße</p>'))
    await expect(capitalization.locator('p').first()).toHaveJSProperty('innerText', 'Edited Straße')
    await page.goto('http://127.0.0.1:4332/10')
    await expect(page.locator('[data-fastppt-layout-object="MCP Capitals"] > span')).toHaveCSS('font-variant-caps', 'small-caps')

    await page.goto('http://127.0.0.1:4332/11')
    const rtl = page.locator('#standalone-rtl')
    await expect(rtl).toBeVisible()
    expect(await rtl.textContent()).toBe('مرحبا بالعالم 123 ABCשלום עולם 123 ABC')
    await expect(rtl.locator('p').first()).toHaveCSS('direction', 'rtl')
    await expect(rtl.locator('p').first()).toHaveCSS('text-align', 'right')
    await expect(rtl.locator('p').nth(1)).toHaveCSS('text-align', 'center')
    const rtlGeometry = await rtl.locator('p').evaluateAll(elements => elements.map(element => {
      const range = document.createRange(); range.selectNodeContents(element)
      const box = element.getBoundingClientRect(), visual = range.getBoundingClientRect()
      return { text: element.textContent, left: Math.round(visual.left - box.left), right: Math.round(box.right - visual.right), width: Math.round(visual.width) }
    }))
    expect(rtlGeometry[0]!.right).toBeLessThan(rtlGeometry[0]!.left + rtlGeometry[0]!.width)
    expect(rtlGeometry[0]!.width).toBeGreaterThan(0)
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('مرحبا بالعالم 123 ABC', 'אבג ABC 123 (x)'))
    await expect(rtl.locator('p').first()).toHaveText('אבג ABC 123 (x)')
    const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
    const captured = await page.locator('.source-layout:visible').evaluate(async (element, path) => {
      const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
      return captureHtmlSlide(element as HTMLElement)
    }, capturePath)
    const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
    expect(snapshot.slides[0]!.warnings).toEqual([])
    const capturedFrame = snapshot.slides[0]!.elements.find(element => element.kind === 'text' && element.source.anchor === 'standalone-rtl')
    expect(capturedFrame && capturedFrame.kind === 'text' ? capturedFrame.paragraphs?.map(paragraph => ({ direction: paragraph.style.direction, align: paragraph.style.align })) : []).toEqual([{ direction: 'rtl', align: 'right' }, { direction: 'rtl', align: 'center' }])
    const exported = await writeEditablePptx(snapshot, join(directory, 'rtl-native.pptx'), { embedFonts: false })
    expect(exported.qa.ok).toBe(true)

  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise<void>((resolveStop) =>
        server!.once('exit', () => resolveStop()),
      )
      server.kill('SIGTERM')
      await stopped
    }
    await rm(directory, { recursive: true, force: true })
  }
})
