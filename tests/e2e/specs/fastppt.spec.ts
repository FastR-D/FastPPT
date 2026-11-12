import { rename, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { expect, test, type Locator } from '@playwright/test'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { writeEditablePptx } from '@fastppt/slidewave/server'

const workspace = '/tmp/fastppt-e2e-workspace'
const downloadPath = '/tmp/fastppt-e2e-download.pptx'

test.afterEach(async () => {
  await rm(downloadPath, { force: true })
})

test('runs the complete local workspace, Harness, editor, preview and export flow', async ({
  page,
  request,
}) => {
  const wakeLockFailures: string[] = []
  page.on('console', (message) => {
    if (/wake lock|screen-wake-lock/i.test(message.text()))
      wakeLockFailures.push(message.text())
  })
  page.on('pageerror', (error) => {
    if (/wake lock|screen-wake-lock/i.test(error.message))
      wakeLockFailures.push(error.message)
  })
  await page.goto('/')
  await expect(page.getByText('fastppt-e2e-workspace').first()).toBeVisible()
  await expect(page.getByTitle('Slidev preview')).toBeVisible()
  await expect(page.locator('.slide-placeholder')).toHaveCount(0)
  const previewFrame = page.getByTitle('Slidev preview').contentFrame()
  await expect(
    previewFrame.getByRole('heading', { name: 'Academy E2E' }),
  ).toBeVisible()
  await expect(
    previewFrame.getByRole('button', { name: 'Go to previous slide' }),
  ).toBeHidden()
  await expect(
    previewFrame.getByRole('button', { name: 'Go to next slide' }),
  ).toBeHidden()
  const gatewayJson = (path: string) =>
    page.evaluate(
      async ({ path }) => {
        const response = await fetch(`http://127.0.0.1:4317${path}`)
        if (!response.ok) return undefined
        return response.json() as Promise<unknown>
      },
      { path },
    )
  const previewSource = await page
    .getByTitle('Slidev preview')
    .getAttribute('src')
  expect(previewSource).toBeTruthy()
  const runtimeLeak = await request.get(
    new URL('.fastppt/runtime/gateway.json', String(previewSource)).toString(),
  )
  expect(runtimeLeak.status()).toBe(403)

  const deckPicker = page.getByLabel('Preview deck')
  const harnessPicker = page.getByLabel('Agent harness')
  const composer = page.getByPlaceholder('输入演示文稿需求…')
  const createSession = page.getByRole('button', { name: '新建会话' })

  await page.getByRole('tab', { name: '主题' }).click()
  await expect(page.getByRole('heading', { name: '可用主题' })).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Academy slidev-theme-academy' }),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Landing slidev-theme-landing' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '查看 Academy 详细功能' }).click()
  await expect(
    page.getByRole('dialog').getByText('学术封面', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page
    .getByRole('button', { name: '查看 fastppt-theme-academy 文件' })
    .click()
  await expect(page.getByRole('dialog')).toContainText(
    '# FastPPT Academy theme',
  )
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('tab', { name: '对话' }).click()
  await expect(composer).toBeVisible()

  const sessionSearch = page.getByLabel('搜索会话')
  await expect(
    page.getByRole('button', { name: /claude first history/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: '重命名当前会话' }).click()
  await page.getByRole('textbox', { name: '会话别名' }).fill('Renamed Claude history')
  await page.getByRole('textbox', { name: '会话别名' }).press('Enter')
  await expect(
    page.getByRole('button', { name: /Renamed Claude history/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: '加载更多会话' }).click()
  const secondHistory = page.getByRole('button', {
    name: /claude second history/,
  })
  await expect(secondHistory).toBeVisible()
  await secondHistory.click()
  await expect(composer).toBeEnabled()
  await page.getByRole('button', { name: '分叉当前会话' }).click()
  await expect
    .poll(async () => {
      const state = (await gatewayJson('/api/v1/application-state')) as {
        recentSession?: { sessionId: string }
      }
      return state.recentSession?.sessionId
    })
    .toBe('claude-e2e-1')
  await sessionSearch.fill('missing-session')
  await expect(page.getByText('没有匹配的会话')).toBeVisible()
  await sessionSearch.fill('')

  const sidebarResize = page.getByRole('separator', {
    name: '调整导航区域宽度',
  })
  await sidebarResize.focus()
  for (let index = 0; index < 10; index += 1)
    await sidebarResize.press('ArrowLeft')
  const sidebarBox = await page.locator('.workspace-sidebar').boundingBox()
  const actionsBox = await page.locator('.session-actions').boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(
    sidebarBox!.x + sidebarBox!.width,
  )
  await expect(page.getByRole('button', { name: '刷新会话' })).toBeVisible()
  await expect(createSession).toBeVisible()
  await sidebarResize.press('ArrowRight')
  const savedLayout = await page.evaluate(() =>
    localStorage.getItem('fastppt.workspace-layout.v1'),
  )
  expect(savedLayout).toContain('sidebar')
  await page.reload()
  await expect(page.getByTitle('Slidev preview')).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('fastppt.workspace-layout.v1'),
    ),
  ).toBe(savedLayout)

  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  })
  await expect(page.getByText(/diagram-.*\.png/)).toBeVisible()

  await page.setViewportSize({ width: 900, height: 800 })
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByTitle('Slidev preview')).toBeVisible()
  await page.getByRole('button', { name: '对话工作区' }).click()
  await expect(composer).toBeVisible()
  await page.setViewportSize({ width: 1600, height: 900 })

  async function pickOption(picker: Locator, label: string): Promise<void> {
    await picker.selectOption({ label })
  }

  async function createConfiguredSession(): Promise<void> {
    await createSession.click()
    const dialog = page.getByRole('dialog', { name: '新建演示文稿会话' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Academy/ }).click()
    await dialog.getByRole('button', { name: '创建会话' }).click()
    await expect(dialog).toBeHidden()
    await expect(composer).toBeEnabled()
  }

  async function sendRun(
    harness: 'claude' | 'codex',
    deckName: 'slides' | 'landing',
    themeSkillId: string,
    switchDuringRun = false,
  ): Promise<void> {
    await pickOption(deckPicker, deckName)
    await expect(page.getByTitle('Slidev preview')).toBeVisible()
    const sendButton = page.getByRole('button', { name: '发送' })
    const prompt = `Generate ${deckName} with ${harness}`
    await composer.fill(prompt)
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(
      page
        .getByText(themeSkillId, { exact: false })
        .filter({ visible: true })
        .first(),
    ).toBeVisible()
    if (switchDuringRun) {
      await pickOption(deckPicker, 'landing')
      await expect(deckPicker.locator('option:checked')).toHaveText('landing')
    }
    await expect(sendButton).toBeVisible()
  }

  for (const harness of ['claude', 'codex'] as const) {
    await pickOption(harnessPicker, harness === 'claude' ? 'Claude' : 'Codex')
    await createConfiguredSession()
    await sendRun(
      harness,
      'slides',
      'fastppt-theme-academy',
      harness === 'claude',
    )
    await sendRun(harness, 'landing', 'fastppt-theme-landing')
  }

  for (const harness of ['claude', 'codex'] as const) {
    await pickOption(harnessPicker, harness === 'claude' ? 'Claude' : 'Codex')
    await expect(composer).toBeEnabled()
    await sendRun(harness, 'slides', 'fastppt-theme-academy')
  }

  await pickOption(deckPicker, 'slides')
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.getByRole('tab', { name: '编辑' }).click()
  await expect(page.getByRole('tab', { name: '编辑' })).toHaveAttribute('aria-selected', 'true')
  await page.locator('.tree-row').filter({ hasText: 'slides.md' }).click()
  const markdown =
    '---\ntheme: slidev-theme-academy\nlayout: default\ntitle: E2E Edited\n---\n\n# E2E Edited\n\n---\n\n# E2E Edited second slide\n\n<style>\n.slidev-layout { background-color: #f0f1f2 !important; }\n</style>\n'
  await page.locator('.cm-content').fill(markdown)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('未保存')).toHaveCount(0)
  await page.getByRole('button', { name: '格式化' }).click()
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByTitle('Slidev preview')).toBeVisible()
  await expect(
    page
      .getByTitle('Slidev preview')
      .contentFrame()
      .getByRole('heading', { name: 'E2E Edited', exact: true }),
  ).toBeVisible()

  const fixedBrand = page.getByTitle('Slidev preview').contentFrame().locator('[data-fastppt-layout-object="Brand"][data-fastppt-object-scope="layout"]:visible').first()
  await expect(fixedBrand).toHaveText('Brand {{ literal }} <text>')
  const masterBrand = page.getByTitle('Slidev preview').contentFrame().locator('[data-fastppt-layout-object="Brand"][data-fastppt-object-scope="master"]:visible').first()
  await expect(masterBrand).toHaveText('Master brand')
  const masterGeometry = await masterBrand.evaluate(element => {
    const box = element.getBoundingClientRect()
    const root = element.closest('.slidev-layout')!.getBoundingClientRect()
    return { x: (box.x - root.x) / root.width, y: (box.y - root.y) / root.height, width: box.width / root.width, height: box.height / root.height }
  })
  expect(masterGeometry.x).toBeCloseTo(0.7, 2)
  expect(masterGeometry.y).toBeCloseTo(0.8, 2)
  expect(masterGeometry.width).toBeCloseTo(0.2, 2)
  expect(masterGeometry.height).toBeCloseTo(0.1, 2)
  const fixedGeometry = await fixedBrand.evaluate(element => {
    const box = element.getBoundingClientRect()
    const layout = element.closest('.slidev-layout')!.getBoundingClientRect()
    return { x: (box.x - layout.x) / layout.width, y: (box.y - layout.y) / layout.height, width: box.width / layout.width, height: box.height / layout.height }
  })
  expect(fixedGeometry.x).toBeCloseTo(0.1, 2)
  expect(fixedGeometry.y).toBeCloseTo(0.1, 2)
  expect(fixedGeometry.width).toBeCloseTo(0.2, 2)
  expect(fixedGeometry.height).toBeCloseTo(0.1, 2)

  await pickOption(deckPicker, 'slides')
  const capturedSnapshot = page.waitForRequest(request => request.method() === 'POST' && /\/api\/v1\/exports\/[^/]+\/snapshot$/.test(new URL(request.url()).pathname))
  await page.getByRole('button', { name: '导出 PPTX' }).click()
  await expect(page.locator('.export-status')).toBeVisible()
  await page.setViewportSize({ width: 900, height: 800 })
  await page.getByRole('button', { name: '预览', exact: true }).click()
  const narrowPreviewBox = await page.getByTitle('Slidev preview').boundingBox()
  const narrowExportBox = await page.locator('.export-status').boundingBox()
  expect(narrowPreviewBox).not.toBeNull()
  expect(narrowExportBox).not.toBeNull()
  expect(narrowExportBox!.y).toBeGreaterThanOrEqual(
    narrowPreviewBox!.y + narrowPreviewBox!.height,
  )
  const captureBody = (await capturedSnapshot).postDataJSON() as { slides: Array<{ elements: Array<{ kind: string; source: { role?: string; nativeLayoutObject?: { layout: string; name: string; scope?: 'master' | 'layout' } } }> }> }
  expect(captureBody.slides.flatMap(slide => slide.elements.filter(element => element.kind === 'shape').map(element => element.source))).toContainEqual(expect.objectContaining({ role: 'slide-background' }))
  expect(captureBody.slides.flatMap(slide => slide.elements.map(element => element.source.nativeLayoutObject))).toContainEqual({ layout: 'default', name: 'Brand' })
  expect(captureBody.slides.flatMap(slide => slide.elements.map(element => element.source.nativeLayoutObject))).toContainEqual({ layout: 'default', name: 'Brand', scope: 'master' })
  // The export enters visual review: confirm before it is published.
  const reviewButton = page.getByRole('button', { name: '确认导出' })
  await expect(reviewButton).toBeVisible()
  await reviewButton.click()
  const downloadButton = page.getByRole('button', { name: '下载 PPTX' })
  await expect(downloadButton).toBeVisible()
  await expect(page.locator('.export-status')).toContainText('2 页')
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('slides.pptx')
  await download.saveAs(downloadPath)
  expect(wakeLockFailures).toEqual([])

  // Common Skills are required; unselected theme Skills are loaded on demand.
  const commonSkill = `${workspace}/.claude/skills/fastppt`
  const skillBackup = `${workspace}/.claude/fastppt-e2e-skill-backup`
  await rename(commonSkill, skillBackup)
  try {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.getByRole('tab', { name: '对话' }).click()
    await pickOption(harnessPicker, 'Claude')
    await pickOption(deckPicker, 'slides')
    await page.getByRole('button', { name: '查看 Skill 与 MCP 安装状态' }).click()
    const status = page.getByRole('dialog', { name: 'Skill 与 MCP 安装状态' })
    await expect(status.locator('.status-row').filter({ has: page.locator('.row-main', { hasText: /^\s*fastppt\s*$/ }) })).toContainText('缺失')
    await status.getByRole('button', { name: '关闭', exact: true }).click()
    await composer.fill('This must not enter the Harness')
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()
    await expect(page.getByText('发送已禁用', { exact: false })).toBeVisible()
  } finally {
    await rename(skillBackup, commonSkill)
  }

  await page.locator('body').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible()
  await page.getByRole('dialog', { name: '命令面板' }).getByRole('button', { name: '打开备注' }).click()
  await expect(page.getByRole('heading', { name: '讲稿备注' })).toBeVisible()
  await page.getByPlaceholder('写下这一页要说的话…').fill('E2E presenter note')
  await page.getByRole('button', { name: '添加 cue' }).click()
  await page.getByLabel('cue 文本').fill('E2E timed cue')
  await page.getByRole('button', { name: '保存备注' }).click()
  await expect(page.getByText('备注已保存')).toBeVisible()
  const selectedDeckId = await page.evaluate(async () => {
    const decks = (await (await fetch('http://127.0.0.1:4317/api/v1/decks')).json()) as Array<{ id: string; name: string }>
    return decks.find((deck) => deck.name === 'slides')?.id
  })
  expect(selectedDeckId).toBeTruthy()
  await expect.poll(async () => page.evaluate(async (deckId) => (await fetch(`http://127.0.0.1:4317/api/v1/decks/${deckId}/notes.srt`)).text(), selectedDeckId)).toContain('E2E timed cue')
  const srtDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 SRT' }).click()
  expect((await srtDownload).suggestedFilename()).toBe('slides.srt')

  await page.getByRole('tab', { name: '动画' }).click()
  await expect(page.getByRole('heading', { name: '创意动效工作台' })).toBeVisible()
  await page.locator('.timeline-details > summary').click()
  await expect(page.locator('.timeline-details').getByLabel('对象')).toBeVisible()
  const motionFrame = page.frameLocator('iframe[title="Slidev preview"]')
  await expect(motionFrame.locator('style[data-fastppt-preview]')).toHaveCount(1)
  await expect(motionFrame.locator('.slidev-layout').first()).toBeVisible()
  await page.getByLabel('跳转到页码').fill('1')
  await page.getByLabel('跳转到页码').press('Enter')
  await expect(page.locator('.animation-page').getByText('第 1 页', { exact: true })).toBeVisible()
  await page.locator('.timeline-details').getByRole('button', { name: '下一页', exact: true }).click()
  await expect(motionFrame.getByRole('heading', { name: 'E2E Edited second slide', exact: true })).toBeVisible()
  await expect(page.locator('.animation-page').getByText('第 2 页', { exact: true })).toBeVisible()
  const secondBrand = motionFrame.locator('[data-slidev-no="2"] [data-fastppt-group="shared-brand"]').first()
  await expect(secondBrand).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', {
    detail: { slide: 2, effect: { target: 'shared-brand', kind: 'entrance_fade', durationMs: 400 }, elapsedMs: 0 },
  })))
  await expect(secondBrand).toHaveCSS('opacity', '0')
  expect(await motionFrame.locator('[data-slidev-no="1"] [data-fastppt-group="shared-brand"].fastppt-animation-preview').count()).toBe(0)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', { detail: { reset: true } })))
  await expect(secondBrand).toHaveCSS('opacity', '1')

  await page.getByLabel('跳转到页码').fill('1')
  await page.getByLabel('跳转到页码').press('Enter')
  await expect(page.locator('.animation-page').getByText('第 1 页', { exact: true })).toBeVisible()
  await motionFrame.locator('body').evaluate((body) => {
    const target = document.createElement('div')
    target.id = 'e2e-motion-target'
    target.textContent = 'Motion probe'
    target.style.animationDuration = '2s'
    target.style.setProperty('animation-delay', '75ms', 'important')
    body.append(target)
  })
  const motionTarget = motionFrame.locator('#e2e-motion-target')
  for (const elapsedMs of [0, 200, 400]) {
    await page.evaluate((elapsedMs) => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', {
      detail: { effect: { target: 'e2e-motion-target', kind: 'entrance_fade', durationMs: 400 }, elapsedMs },
    })), elapsedMs)
    await expect(motionTarget).toHaveCSS('animation-play-state', 'paused')
    await expect(motionTarget).toHaveCSS('animation-delay', `${-elapsedMs / 1000}s`)
    if (elapsedMs === 0) await expect(motionTarget).toHaveCSS('opacity', '0')
    if (elapsedMs === 200) {
      const opacity = await motionTarget.evaluate((element) => Number(getComputedStyle(element).opacity))
      expect(opacity).toBeGreaterThan(0)
      expect(opacity).toBeLessThan(1)
      const pausedTimes = await motionTarget.evaluate(async (element) => {
        const animation = element.getAnimations()[0]
        const before = animation?.currentTime
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        return { before, after: animation?.currentTime }
      })
      expect(pausedTimes.before).toBeDefined()
      expect(pausedTimes.after).toEqual(pausedTimes.before)
    }
    if (elapsedMs === 400) await expect(motionTarget).toHaveCSS('opacity', '1')
  }
  await expect(motionTarget).toHaveCSS('transform', 'none')
  for (const elapsedMs of [-1, 0, 200]) {
    await page.evaluate((elapsedMs) => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', {
      detail: { effect: { target: 'e2e-motion-target', kind: 'appear', durationMs: 400 }, elapsedMs },
    })), elapsedMs)
    await expect(motionTarget).toHaveCSS('animation-delay', `${-elapsedMs / 1000}s`)
    await expect(motionTarget).toHaveCSS('opacity', elapsedMs < 0 ? '0' : '1')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const kind of ['zoom', 'fly', 'emphasis_pulse', 'teeter']) {
    await page.evaluate(kind => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', {
      detail: { effect: { target: 'e2e-motion-target', kind, durationMs: 400 }, elapsedMs: 200 },
    })), kind)
    await expect(motionTarget).toHaveCSS('transform', 'none')
    await expect(motionTarget).toHaveCSS('animation-name', kind === 'zoom' || kind === 'fly' ? 'fastppt-preview-in' : 'none')
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(motionTarget).toHaveCSS('animation-name', 'fastppt-preview-teeter')
  await page.getByLabel('预览动态效果', { exact: true }).selectOption('reduce')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fastppt.motion-preference'))).toBe('reduce')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', {
    detail: { effect: { target: 'e2e-motion-target', kind: 'zoom', durationMs: 400 }, elapsedMs: 200 },
  })))
  await expect(motionTarget).toHaveCSS('animation-name', 'fastppt-preview-in')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByLabel('预览动态效果', { exact: true }).selectOption('full')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fastppt-animation-preview', {
    detail: { effect: { target: 'e2e-motion-target', kind: 'zoom', durationMs: 400 }, elapsedMs: 200 },
  })))
  await expect(motionTarget).toHaveCSS('animation-name', 'fastppt-preview-zoom')
  await page.getByLabel('预览动态效果', { exact: true }).selectOption('system')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  await page.getByRole('button', { name: '静态预览', exact: true }).click()
  await expect(motionTarget).not.toHaveClass(/fastppt-animation-preview/)
  await expect(motionTarget).toHaveCSS('animation-duration', '2s')
  await expect(motionTarget).toHaveCSS('animation-delay', '0.075s')
  expect(await motionTarget.evaluate((element) => element.style.getPropertyPriority('animation-delay'))).toBe('important')
  await motionTarget.evaluate((element) => element.remove())
  await page.getByRole('button', { name: '打开命令面板', exact: true }).click()
  await page.getByRole('dialog', { name: '命令面板' }).getByRole('button', { name: /^打开图表/ }).click()
  await expect(page.getByRole('heading', { name: '图表编辑' })).toBeVisible()
  await page.getByRole('button', { name: '预览' }).click()
  await expect(page.getByRole('img', { name: '图表预览' })).toBeVisible()
  await expect.poll(() => page.getByRole('img', { name: '图表预览' }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)

  await expect(page.getByRole('tab', { name: '演示', exact: true })).toHaveCount(0)

  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible()
  await page.getByRole('dialog', { name: '命令面板' }).getByRole('button', { name: '新建演示文稿' }).click()
  const wizard = page.getByRole('dialog', { name: '创建向导' })
  await expect(wizard).toBeVisible()
  await wizard.getByRole('button', { name: '关闭' }).click()
  await expect(wizard).toBeHidden()
})

test('resumes creation decisions and carries the final delivery step into a real session', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await page.goto('/')
  await expect(page.getByText('fastppt-e2e-workspace').first()).toBeVisible()
  const openWizard = async () => {
    await expect(page.getByText('fastppt-e2e-workspace').first()).toBeVisible()
    await page.keyboard.press('Control+Shift+P')
    await page.getByRole('dialog', { name: '命令面板' }).getByRole('button', { name: '新建演示文稿' }).click()
  }
  await openWizard()
  const wizard = page.getByRole('dialog', { name: '创建向导' })
  await wizard.getByLabel('推荐选项').selectOption('从零创建')
  await wizard.getByLabel('本步备注').fill('向导的任务约束')
  await wizard.getByLabel('锁定本步决策').check()
  await wizard.getByRole('button', { name: '保存并继续' }).click()
  await expect(wizard.getByLabel('推荐选项')).toHaveValue('')
  await wizard.getByLabel('推荐选项').selectOption('事实核查优先')
  await wizard.getByLabel('本步备注').fill('保留来源')
  await wizard.getByRole('button', { name: '稍后继续' }).click()
  await expect(wizard).toBeHidden()
  await page.reload()
  await openWizard()
  await expect(wizard.getByLabel('推荐选项')).toHaveValue('事实核查优先')
  await expect(wizard.getByLabel('本步备注')).toHaveValue('保留来源')
  await wizard.getByRole('button', { name: '上一步' }).click()
  await expect(wizard.getByLabel('推荐选项')).toBeDisabled()
  await expect(wizard.getByLabel('本步备注')).toHaveValue('向导的任务约束')
  await wizard.getByRole('button', { name: '保存并继续' }).click()
  await wizard.getByRole('button', { name: '保存并继续' }).click()
  await wizard.getByLabel('推荐选项').selectOption('保留主题风格')
  await wizard.getByRole('button', { name: '保存并继续' }).click()
  await wizard.getByLabel('推荐选项').selectOption('页面对象 + 动画')
  await wizard.getByLabel('本步备注').fill('最后一步必须保存')
  await wizard.getByRole('button', { name: '保存并配置会话' }).click()
  const dialog = page.getByRole('dialog', { name: '新建演示文稿会话' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Landing/ }).click()
  const creation = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/sessions')
  await dialog.getByRole('button', { name: '创建会话', exact: true }).click()
  const payload = (await creation).postDataJSON() as { profile: { creationDecisions: Array<{ stepId: string; selected: string; locked: boolean }>; deliveryOptions: unknown } }
  expect(payload.profile.creationDecisions.find(d => d.stepId === 'task')?.locked).toBe(true)
  expect(payload.profile.creationDecisions.find(d => d.stepId === 'delivery')?.selected).toContain('最后一步必须保存')
  expect(payload.profile.deliveryOptions).toEqual({ master: false, notes: false, animations: true })
  await expect(dialog).toBeHidden()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fastppt.creation-wizard'))).toBeNull()
  await page.locator('.preview-more > summary').click()
  await page.locator('.export-options summary').click()
  await expect(page.locator('.export-options').getByLabel('母版')).not.toBeChecked()
  await expect(page.locator('.export-options').getByLabel('备注')).not.toBeChecked()
  await expect(page.locator('.export-options').getByLabel('动画')).toBeChecked()
})

test('shows source relationships and unassessed confidence in import review', async ({ page }) => {
  const submitted: Array<Array<{ stepId: string; selected: string }>> = []
  let approvalAttempts = 0
  await page.addInitScript(() => localStorage.setItem('fastppt:last-pptx-import-job', 'source-review'))
  await page.route('**/api/v1/imports/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const themeId = 'slidev-theme-source-review'
    if (path.endsWith('/decisions')) {
      const decisions = route.request().postDataJSON() as Array<{ stepId: string; selected: string }>
      submitted.push(decisions)
      await route.fulfill({ json: { themeId, decisions } })
      return
    }
    if (path.endsWith('/approve')) {
      approvalAttempts++
      await route.fulfill(approvalAttempts === 1 ? { status: 409, json: { error: { code: 'THEME_RULE_APPROVAL_FAILED', message: 'Review fixture rejected approval', retryable: false, requestId: 'review-fixture' } } } : { json: { themeId, approvedAt: new Date().toISOString() } })
      return
    }
    if (path.endsWith('/rule-review')) {
      await route.fulfill({ json: approvalAttempts ? { version: 1, scope: 'theme-catalog', checkedAt: new Date().toISOString(), digest: 'a'.repeat(64), catalogDigest: 'b'.repeat(64), layouts: ['title'], valid: approvalAttempts > 1, issues: [{ ruleId: approvalAttempts === 1 ? 'catalog.required' : 'deck.lines', severity: approvalAttempts === 1 ? 'error' : 'needs-human', status: approvalAttempts === 1 ? 'violation' : 'unverified', code: 'THEME_RULE_EVIDENCE_MISSING', message: approvalAttempts === 1 ? 'Required layout unavailable' : 'Future rendered content requires review', source: 'agent/theme-rules.json#review', suggestedFix: 'Review the selected catalog and authored deck.' }] } : null })
      return
    }
    const graph = { presentationPart: 'custom/deck.xml', slides: [{ index: 1, part: 'custom/page12.xml', layout: 'custom/title.xml', master: 'custom/brand.xml', theme: 'custom/colors.xml', notes: 'custom/notes.xml', provenance: 'extracted' }], masters: [{ part: 'custom/brand.xml', layouts: ['custom/title.xml', 'custom/unused.xml'], theme: 'custom/colors.xml', provenance: 'extracted' }] }
    const body = path.endsWith('/analysis') ? { version: 1, sourceHash: 'a'.repeat(64), sourceGraph: graph, extractedFeatures: {}, candidateLayouts: [{ id: 'custom/title.xml', name: 'Source title', generated: { status: 'complete' } }, { id: 'custom/unused.xml', name: 'Partial image layout', generated: { status: 'partial' }, issues: ['Image crop requires review'] }], unsupportedOoxml: [], userOverrides: {} }
      : path.endsWith('/jobs/source-review') ? { id: 'source-review', themeId, status: 'ready', decisions: [] }
      : path.endsWith('/jobs') ? []
      : { themeId, stage: 'ready', designing: false, layouts: ['title'], components: [], message: 'Fixture ready' }
    await route.fulfill({ json: body })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await expect(page.getByText('来源关系 · 1 页 / 1 个母版')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'custom/page12.xml', exact: true })).toBeVisible()
  await expect(page.getByText('语义置信度未评估')).toHaveCount(2)
  const candidates = page.locator('.candidate-block')
  await expect(candidates.nth(0).getByRole('checkbox')).toBeChecked()
  await expect(candidates.nth(1).getByRole('checkbox')).toBeDisabled()
  await candidates.nth(0).getByRole('checkbox').uncheck()
  await page.getByRole('button', { name: '保存决策并注册主题' }).click()
  await expect(page.getByRole('alert')).toContainText('请选择至少一个可用布局')
  expect(submitted).toEqual([])
  await page.getByRole('radio', { name: '只提取颜色、字体和来源 token' }).check()
  await page.getByRole('button', { name: '保存决策并注册主题' }).click()
  await expect(page.getByRole('alert')).toContainText('Review fixture rejected approval')
  const ruleReview = page.getByRole('region', { name: '导入规则审查' })
  await expect(ruleReview).toContainText('catalog.required')
  await expect(ruleReview).toContainText('agent/theme-rules.json#review')
  await expect(ruleReview).toContainText('Review the selected catalog and authored deck.')
  expect(submitted[0]?.filter(item => item.stepId.startsWith('layout:'))).toMatchObject([{ stepId: 'layout:custom/title.xml', selected: 'skip' }, { stepId: 'layout:custom/unused.xml', selected: 'skip' }])
  await page.locator('.source-master summary').click()
  await expect(page.getByText('custom/unused.xml', { exact: true })).toBeVisible()
  expect((await page.locator('.theme-import').boundingBox())!.width).toBeGreaterThan(1000)
  await expect(page.getByTitle('Slidev preview')).toHaveCount(0)
  await page.locator('.theme-import').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: '/tmp/fastppt-source-review.png', fullPage: true })
  await page.getByRole('button', { name: '保存决策并注册主题' }).click()
  await expect(ruleReview).toContainText('无阻断错误')
  await expect(ruleReview).toContainText('deck.lines')
  await expect(ruleReview).toContainText('needs-human')
  await expect(page.getByRole('button', { name: '保存决策并注册主题' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '只提取颜色、字体和来源 token' })).toBeDisabled()
  await expect(candidates.nth(0).getByRole('checkbox')).toBeDisabled()
  await expect(ruleReview.getByRole('button', { name: '返回工作区' })).toBeVisible()
})

test('grants separate rule exceptions for a real PPTX export and revokes publication', async ({ page, request }) => {
  await page.goto('/')
  const picker = page.getByLabel('Preview deck')
  await expect(picker).toBeVisible()
  await picker.selectOption({ label: 'rule-exceptions' })
  await expect(page.frameLocator('iframe[title="Slidev preview"]').locator('.slidev-layout').filter({ hasText: 'First review page' }).first()).toBeVisible()
  const panel = page.locator('.rule-exceptions')
  await page.locator('.preview-more > summary').click()
  await panel.locator('summary').first().click()
  await expect(panel.locator('.rule-issue')).toContainText('deck.pages')
  const grant = panel.getByRole('button', { name: '批准此问题例外' })
  await expect(grant).toBeDisabled()
  await panel.getByLabel('批准原因 · deck.pages').fill('Reviewed two-page internal draft.')
  await grant.click()
  await expect(panel.locator('.rule-issue')).toContainText('已批准例外')
  const firstExport = page.waitForResponse(response => response.request().method() === 'POST' && /\/decks\/[^/]+\/exports$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click()
  const firstJob = await (await firstExport).json() as { id: string; deckId: string }
  await expect(page.locator('.export-status').filter({ hasText: 'PPTX 规则回读 · 未通过' })).toBeVisible()
  const failed = await (await request.get(`http://127.0.0.1:4317/api/v1/exports/${firstJob.id}`)).json() as { status: string; themeRules: { readback: { source: string; slides: unknown[]; issues: Array<{ exception?: unknown }> } } }
  expect(failed.status).toBe('failed')
  expect(failed.themeRules.readback.source).toBe('pptx-xml')
  expect(failed.themeRules.readback.slides).toHaveLength(2)
  expect(failed.themeRules.readback.issues[0]?.exception).toBeUndefined()
  await page.locator('.preview-more > summary').click()
  await panel.getByLabel('例外检查阶段').selectOption('readback')
  await expect(panel.locator('.rule-issue')).toContainText('deck.pages')
  await panel.getByLabel('批准原因 · deck.pages').fill('Confirmed the exported two-page structure.')
  await grant.click()
  await expect(panel.locator('.rule-issue')).toContainText('已批准例外')
  const secondExport = page.waitForResponse(response => response.request().method() === 'POST' && /\/decks\/[^/]+\/exports$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click()
  const secondJob = await (await secondExport).json() as { id: string; deckId: string }
  await expect(page.getByRole('button', { name: '确认导出' })).toBeVisible()
  await page.getByRole('button', { name: '确认导出' }).click()
  await expect(page.getByRole('button', { name: '下载 PPTX' })).toBeVisible()
  const download = await request.get(`http://127.0.0.1:4317/api/v1/exports/${secondJob.id}/download`)
  expect(download.status()).toBe(200)
  expect((await download.body()).subarray(0, 2).toString()).toBe('PK')
  const published = await (await request.get(`http://127.0.0.1:4317/api/v1/exports/${secondJob.id}`)).json() as { themeRules: { readback: { issues: unknown[] } } }
  expect(published.themeRules.readback.issues[0]).toMatchObject({ severity: 'error', status: 'violation', exception: { reason: 'Confirmed the exported two-page structure.' } })
  await page.locator('.preview-more > summary').click()
  await expect(panel.locator('.exception-record')).toHaveCount(2)
  await panel.locator('.exception-record').filter({ hasText: 'Confirmed the exported two-page structure.' }).getByRole('button', { name: '撤销例外' }).click()
  await expect(panel.locator('.exception-record').filter({ hasText: 'Confirmed the exported two-page structure.' })).toContainText('已撤销')
  expect((await request.get(`http://127.0.0.1:4317/api/v1/exports/${secondJob.id}/download`)).ok()).toBe(false)
})

test('shows failed PPTX rule evidence without offering a download', async ({ page }) => {
  await page.route('**/api/v1/decks/*/exports', async route => {
    const path = new URL(route.request().url()).pathname.split('/')
    await route.fulfill({ json: {
      id: 'rule-readback-ui', deckId: path[4], format: 'editable-pptx', outputName: 'review.pptx', status: 'failed', phase: 'failed', progress: 80, createdAt: new Date().toISOString(), warnings: [],
      error: { code: 'EXPORT_FAILED', message: 'PPTX template rule readback failed.' },
      themeRules: { revision: 'fixture', digest: 'a'.repeat(64), stage: 'post-export', issues: [], readback: { source: 'pptx-xml', sha256: 'b'.repeat(64), checkedAt: new Date().toISOString(), status: 'failed', slides: [], issues: [{ ruleId: 'body.lines', code: 'THEME_RULE_EVIDENCE_MISSING', severity: 'error', status: 'unverified', slide: 1, message: 'Rendered PPTX text lines unavailable.', source: 'agent/theme-rules.json#body.lines', suggestedFix: 'Review the exported PPTX rendering.' }] } },
    } })
  })
  await page.goto('/')
  const exportButton = page.getByRole('button', { name: '导出 PPTX', exact: true })
  await expect(exportButton).toBeEnabled()
  await exportButton.click()
  const report = page.locator('details').filter({ has: page.locator('summary', { hasText: 'PPTX 规则回读' }) })
  await expect(report).toContainText('未通过')
  await expect(report).toContainText('缺少验证证据')
  await expect(report).toContainText('body.lines')
  await expect(report).toContainText('第 1 页')
  await expect(report).toContainText('agent/theme-rules.json#body.lines')
  await expect(report).toContainText('Review the exported PPTX rendering.')
  await expect(page.getByRole('button', { name: '下载 PPTX' })).toHaveCount(0)
})

test('keeps animation targets from the current deck when an earlier response arrives late', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByLabel('Preview deck')
  await expect(picker).toBeVisible()
  await picker.selectOption({ label: 'slides' })
  let releaseOld!: () => void
  let oldStarted!: () => void
  let oldDelivered!: () => void
  const delivered = new Promise<void>(resolve => { oldDelivered = resolve })
  const held = new Promise<void>(resolve => { releaseOld = resolve })
  const started = new Promise<void>(resolve => { oldStarted = resolve })
  let first = true
  await page.route('**/api/v1/decks/*/ir', async route => {
    const isOld = first
    first = false
    const response = await route.fetch()
    const body = await response.json() as { slides: Array<{ anchors: string[] }> }
    for (const slide of body.slides) slide.anchors = [isOld ? 'stale-deck-target' : 'current-deck-target']
    if (isOld) { oldStarted(); await held }
    await route.fulfill({ response, json: body })
    if (isOld) oldDelivered()
  })
  try {
    await page.getByRole('tab', { name: '动画', exact: true }).click()
    await started
    await picker.selectOption({ label: 'landing' })
    const target = page.locator('.timeline-details').getByLabel('对象')
    await expect(target).toHaveValue('current-deck-target')
    releaseOld()
    await delivered
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect.poll(() => page.locator('.animation-page option').allTextContents()).not.toContain('stale-deck-target')
    await expect(target).toHaveValue('current-deck-target')
  } finally { releaseOld() }
})

test('applies motion presets by scope and preserves manual overrides when saving', async ({ page, request }) => {
  await page.goto('/')
  const picker = page.getByLabel('Preview deck')
  await expect(picker).toBeVisible()
  await picker.selectOption({ label: 'slides' })
  await page.route('**/api/v1/decks/*/animations', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { version: 1, animations: [] } })
    else await route.continue()
  })
  await page.route('**/api/v1/decks/*/ir', async route => {
    const response = await route.fetch()
    const body = await response.json() as { motionPreset?: string; slides: Array<{ anchors: string[]; animationTargets?: unknown[] }> }
    body.motionPreset = 'business'
    body.slides.forEach((slide, index) => {
      slide.anchors = [`title-${index}`, `brand-${index}`]
      slide.animationTargets = [{ anchor: `title-${index}`, role: 'title', static: false }, { anchor: `brand-${index}`, role: 'inherited', static: true }]
    })
    await route.fulfill({ response, json: body })
  })
  await page.getByRole('tab', { name: '动画', exact: true }).click()
  const panel = page.locator('.animation-panel')
  await panel.locator('.timeline-details > summary').click()
  const save = async () => {
    const sent = page.waitForRequest(req => req.method() === 'PUT' && /\/animations$/.test(new URL(req.url()).pathname))
    await panel.getByRole('button', { name: '保存动画', exact: true }).click()
    const write = await sent
    const response = await write.response()
    expect(response?.ok()).toBe(true)
    const stored = await request.get(write.url())
    return await stored.json() as { animations: Array<{ source: string; groups: Array<{ id: string; effects: Array<{ kind: string }> }> }> }
  }
  await expect(panel.getByLabel('动效预设', { exact: true })).toHaveValue('business')
  await panel.getByLabel('动效预设', { exact: true }).selectOption('teaching')
  await panel.getByRole('button', { name: '应用预设', exact: true }).click()
  await expect(panel.getByText('预设已应用，请保存。', { exact: true })).toBeVisible()
  const single = await save()
  expect(single.animations).toHaveLength(1)
  expect(single.animations[0]?.groups.map(group => group.id)).toEqual(['title-0'])
  await panel.getByLabel('动效应用范围', { exact: true }).selectOption('all')
  await panel.getByRole('button', { name: '应用预设', exact: true }).click()
  await expect(panel.getByText('预设已应用，请保存。', { exact: true })).toBeVisible()
  expect((await save()).animations).toHaveLength(2)
  await panel.getByRole('button', { name: '添加效果', exact: true }).click()
  await panel.getByLabel('动效预设', { exact: true }).selectOption('static')
  await panel.getByRole('button', { name: '应用预设', exact: true }).click()
  await expect(panel.getByText('已应用预设，保留 1 页已有修改；请保存。', { exact: true })).toBeVisible()
  const protectedResult = await save()
  expect(protectedResult.animations.find(item => item.source === 'user')?.groups[0]?.effects.length).toBe(2)
  expect(protectedResult.animations.find(item => item.source === 'system')?.groups).toEqual([])
  await panel.getByLabel('替换已有动画修改').check()
  await panel.getByRole('button', { name: '应用预设', exact: true }).click()
  await expect(panel.getByText('预设已应用，请保存。', { exact: true })).toBeVisible()
  expect((await save()).animations.every(item => item.groups.length === 0)).toBe(true)
})

test('renders imported placeholder geometry and measures visible content in the browser', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const markdown = '---\ntheme: slidev-theme-academy\nlayout: source-import\n---\n\n::ph-0::\n\n<h1 id="imported-title">Imported <em>title</em> 中文 عربي</h1>\n\n<style>\n.source-layout { --source-brand: #2255AA; }\n</style>\n'
  const response = await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content: markdown } })
  expect(response.ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const iframe = page.getByTitle('Slidev preview')
  const preview = iframe.contentFrame()
  await expect(preview.getByRole('heading', { name: 'Imported title 中文 عربي' })).toBeVisible()
  const title = preview.locator('#imported-title')
  await expect(title.locator('[data-fastppt-font-script="ea"]')).toHaveText('中文')
  await expect(title.locator('[data-fastppt-font-script="ea"]')).toHaveCSS('font-family', '"Noto Serif SC"')
  await expect(title.locator('[data-fastppt-font-script="cs"]')).toHaveText('عربي')
  await expect(title.locator('[data-fastppt-font-script="cs"]')).toHaveCSS('font-family', '"Noto Sans Arabic"')
  await expect(title.locator('em [data-fastppt-font-script="latin"]')).toHaveText('title')
  await expect(title.locator('em [data-fastppt-font-script="latin"]')).toHaveCSS('font-family', 'Arial')
  const box = await preview.locator('[data-fastppt-placeholder-index="0"]').evaluate(element => {
    const root = element.closest('.slidev-layout')!.getBoundingClientRect(), rect = element.getBoundingClientRect()
    return { x: (rect.x - root.x) / root.width, y: (rect.y - root.y) / root.height, width: rect.width / root.width, height: rect.height / root.height }
  })
  expect(box.x).toBeCloseTo(0.1, 3)
  expect(box.y).toBeCloseTo(0.1, 3)
  expect(box.width).toBeCloseTo(0.7, 3)
  expect(box.height).toBeCloseTo(0.1, 3)
  await expect(preview.locator('[data-fastppt-object-scope="master"][data-fastppt-group="source-brand"]')).toHaveCount(1)
  const typography = await preview.locator('#imported-title').evaluate(element => {
    const style = getComputedStyle(element), root = element.closest('.slidev-layout')!
    return { family: style.fontFamily, size: parseFloat(style.fontSize) / (root as HTMLElement).clientWidth, weight: style.fontWeight, italic: style.fontStyle, kerning: style.fontKerning, color: style.color }
  })
  expect(typography.family).toContain('Arial')
  expect(typography.size).toBeCloseTo(24 * 12700 / 10000000, 4)
  expect(typography.weight).toBe('400')
  expect(typography.italic).toBe('italic')
  expect(typography.kerning).toBe('normal')
  expect(typography.color).toBe('rgb(17, 34, 51)')
  const modulePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/browser/rule-measurement.ts', import.meta.url))}`
  const measured = await preview.locator('.source-layout').evaluate(async (element, path) => {
    const { measureThemeRules } = await import(path) as { measureThemeRules: (root: HTMLElement, slide: number) => { textLines: number; density: number; tokens: string[] } }
    const root = element as HTMLElement
    const measurement = measureThemeRules(root, 1)
    const hidden = document.createElement('div')
    hidden.style.display = 'none'
    hidden.textContent = 'Hidden text must not contribute'
    root.append(hidden)
    const afterHidden = measureThemeRules(root, 1)
    return { measurement, afterHidden }
  }, modulePath)
  expect(measured.measurement.textLines).toBe(1)
  expect(measured.measurement.tokens).toContain('--source-brand')
  expect(measured.measurement.density).toBeGreaterThan(0)
  expect(measured.measurement.density).toBeLessThan(0.1)
  expect(measured.afterHidden).toEqual(measured.measurement)
  const currentDeck = await (await request.get(`http://127.0.0.1:4317/api/v1/decks/${deck.id}`)).json() as { revision: string }
  const edited = await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: currentDeck.revision, content: markdown.replace('<em>title</em> 中文 عربي', 'title 更新 日本語 עברית') } })
  expect(edited.ok()).toBe(true)
  await expect(title).toHaveText('Imported title 更新 日本語 עברית')
  await expect(title.locator('[data-fastppt-font-script="ea"]')).toHaveText(['更新', '日本語'])
  await expect(title.locator('[data-fastppt-font-script="cs"]')).toHaveText('עברית')
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  let captured: unknown
  // Vite may reload after optimizing the newly imported capture dependencies.
  await expect(async () => {
    captured = await preview.locator('.source-layout').evaluate(async (element, path) => {
      const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
      return captureHtmlSlide(element as HTMLElement)
    }, capturePath)
  }).toPass({ timeout: 20_000 })
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  const textObjects = snapshot.slides[0]!.elements.filter(element => element.kind === 'text' && element.source.anchor === 'imported-title')
  expect(textObjects).toHaveLength(1)
  expect(textObjects[0]).toMatchObject({ text: 'Imported title 更新 日本語 עברית', style: { fontFamilies: { latin: 'Arial', ea: 'Noto Serif SC', cs: 'Noto Sans Arabic' } } })
  const written = await writeEditablePptx(snapshot, downloadPath, {
    embedFonts: false,
    slideLayouts: ['source-import'],
    masterLayoutDefinitions: [{ name: 'source-import', canvas: { width: 10000000, height: 5625000 }, placeholders: [{ index: 0, type: 'title', x: 1000000, y: 562500, width: 7000000, height: 562500, textStyle: { fontFamily: 'Arial', fontFamilies: { ea: 'Noto Serif SC', cs: 'Noto Sans Arabic' }, fontSize: 24, color: '112233' } }] }],
    placeholderBindings: [{ slide: 1, target: 'imported-title', index: 0, geometry: 'layout', textStyle: 'layout' }],
  })
  expect(written.qa.ok).toBe(true)
  const withHiddenContent: unknown = await preview.locator('.source-layout').evaluate(async (element, path) => {
    element.querySelector<HTMLElement>('[data-fastppt-font-script="ea"]')!.style.display = 'none'
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)
  const visibleText = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [withHiddenContent] }).slides[0]!.elements.flatMap(element => element.kind === 'text' ? [element.text] : []).join('')
  expect(visibleText).not.toContain('更新')
  expect(visibleText).toContain('日本語')
  expect(visibleText).toContain('עברית')
})

test('keeps source paragraph levels independent through nested lists, editing and capture', async ({ page, request }) => {
  const renderErrors: string[] = []
  page.on('pageerror', error => renderErrors.push(error.message))
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-levels\n---\n\n::ph-0::\n\n<ul><li id="outer-level">First 一级<ul><li id="inner-level">Second 二级</li></ul></li><li id="last-level">Third 一级</li></ul><div><svg id="source-inline-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20"><path d="M0 10L20 0L40 10L20 20Z" fill="#112233" /></svg></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  const paragraphs = preview.locator('[data-fastppt-text-level]')
  await expect.poll(async () => ({ count: await paragraphs.count(), errors: renderErrors })).toEqual({ count: 3, errors: [] })
  await expect(preview.locator('#source-inline-svg path')).toHaveAttribute('d', 'M0 10L20 0L40 10L20 20Z')
  await expect(preview.locator('#source-inline-svg [data-fastppt-script-text]')).toHaveCount(0)
  const readParagraphs = () => paragraphs.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element), canvas = (element.closest('.slidev-layout') as HTMLElement).clientWidth
    return { level: element.getAttribute('data-fastppt-text-level'), text: element.textContent, size: parseFloat(style.fontSize) / canvas, weight: style.fontWeight, align: style.textAlign, left: parseFloat(style.marginLeft) / canvas, indent: parseFloat(style.textIndent) / canvas, before: parseFloat(style.marginTop) / canvas, after: parseFloat(style.marginBottom) / canvas, line: parseFloat(style.lineHeight) / parseFloat(style.fontSize) }
  }))
  const styles = await readParagraphs()
  expect(styles.map(style => style.level)).toEqual(['1', '2', '1'])
  for (const index of [0, 2]) {
    expect(styles[index]).toMatchObject({ weight: '700', align: 'left', left: 0, indent: 0, before: 0, after: 0 })
    expect(styles[index]!.size).toBeCloseTo(24 * 12700 / 10000000, 4)
  }
  expect(styles[1]).toMatchObject({ weight: '400', align: 'right' })
  expect(styles[1]!.size).toBeCloseTo(16 * 12700 / 10000000, 4)
  expect(styles[1]!.left).toBeCloseTo(914400 / 10000000, 4)
  expect(styles[1]!.indent).toBeCloseTo(-182880 / 10000000, 4)
  expect(styles[1]!.before).toBeCloseTo(4 * 12700 / 10000000, 4)
  expect(styles[1]!.after).toBeCloseTo(6 * 12700 / 10000000, 4)
  expect(styles[1]!.line).toBeCloseTo(1.5, 3)
  await expect(preview.locator('#inner-level [data-fastppt-font-script="ea"]')).toHaveCSS('font-family', '"Noto Sans SC"')
  await expect(preview.locator('#last-level [data-fastppt-font-script="ea"]')).toHaveCSS('font-family', '"Noto Serif SC"')
  const currentDeck = await (await request.get(`http://127.0.0.1:4317/api/v1/decks/${deck.id}`)).json() as { revision: string }
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: currentDeck.revision, content: content.replace('id="inner-level"', 'id="inner-level" data-fastppt-level="3"') } })).ok()).toBe(true)
  await expect(preview.locator('#inner-level [data-fastppt-text-level]')).toHaveAttribute('data-fastppt-text-level', '3')
  const changed = await readParagraphs()
  expect(changed[1]).toMatchObject({ level: '3', weight: '700', align: 'left', left: 0, indent: 0, before: 0, after: 0 })
  expect(changed[1]!.size).toBeCloseTo(styles[0]!.size, 5)
  await expect(preview.locator('#source-inline-svg path')).toHaveAttribute('fill', '#112233')
  expect(renderErrors).toEqual([])
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  let captured: unknown
  await expect(async () => {
    captured = await preview.locator('.source-layout').evaluate(async (element, path) => {
      const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
      return captureHtmlSlide(element as HTMLElement)
    }, capturePath)
  }).toPass({ timeout: 20_000 })
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  expect(snapshot.slides[0]!.elements.filter(element => element.kind === 'text').map(element => ({ anchor: element.source.anchor, level: element.kind === 'text' ? element.paragraphLevel : undefined }))).toEqual([
    { anchor: 'outer-level', level: 1 }, { anchor: 'inner-level', level: 3 }, { anchor: 'last-level', level: 1 },
  ])
})

test('captures and binds an explicit rich text frame as one editable placeholder', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-levels\n---\n\n::ph-0::\n\n<div id="rich-body" data-fastppt-text-box><p>First <em>强调</em> <a href="https://example.com/" style="border:0;padding:0;text-decoration:underline">link</a></p><ul><li>Level one<ul><li>Second 二级<br>next<span style="display:none">HIDDEN</span></li></ul></li></ul><p></p></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  await expect(preview.locator('#rich-body [data-fastppt-text-level]')).toHaveCount(4)
  // A group animation must not be applied again to each paragraph descendant.
  await expect(preview.locator('#rich-body [data-fastppt-group="rich-body"]')).toHaveCount(0)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => {
    let captured: unknown
    await expect(async () => {
      captured = await preview.locator('.source-layout').evaluate(async (element, path) => {
        const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
        return captureHtmlSlide(element as HTMLElement)
      }, capturePath)
    }).toPass({ timeout: 20_000 })
    return HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  }
  const snapshot = await capture()
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const elements = snapshot.slides[0]!.elements.filter(element => element.source.anchor === 'rich-body')
  expect(elements).toHaveLength(1)
  const text = elements[0]!
  expect(text.kind).toBe('text')
  if (text.kind !== 'text') throw new Error('Expected captured text frame')
  expect(text.text).toBe('First 强调 link\nLevel one\nSecond 二级\nnext\n')
  expect(text.paragraphs!.map(paragraph => paragraph.level)).toEqual([1, 1, 2, 1])
  expect(text.paragraphs![0]!.runs.find(run => run.text === '强调')!.style.fontStyle).toBe('italic')
  expect(text.paragraphs![0]!.runs.find(run => run.text === 'link')).toMatchObject({ hyperlink: 'https://example.com/', style: { decoration: ['underline'] } })
  expect(text.paragraphs![2]!.style.fontWeight).toBe(400)
  const written = await writeEditablePptx(snapshot, downloadPath, {
    embedFonts: false, slideLayouts: ['source-levels'],
    masterLayoutDefinitions: [{ name: 'source-levels', canvas: { width: 10000000, height: 5625000 }, placeholders: [{ index: 0, type: 'body', x: 1000000, y: 562500, width: 8000000, height: 4500000, textStyle: { fontFamily: 'Arial', fontSize: 24, levels: [{ level: 2, textStyle: { fontSize: 16, bold: false } }] } }] }],
    placeholderBindings: [{ slide: 1, target: 'rich-body', index: 0, geometry: 'layout', textStyle: 'layout' }],
  })
  expect(written.qa.ok).toBe(true)
  const current = await (await request.get(`http://127.0.0.1:4317/api/v1/decks/${deck.id}`)).json() as { revision: string }
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.revision, content: content.replace('Second 二级', 'Updated 更新').replace('<em>强调</em>', '<strong>加粗</strong>') } })).ok()).toBe(true)
  await expect(preview.locator('#rich-body')).toContainText('Updated 更新')
  const updated = (await capture()).slides[0]!.elements.find(element => element.kind === 'text' && element.source.anchor === 'rich-body')!
  expect(updated.kind === 'text' && updated.text).toBe('First 加粗 link\nLevel one\nUpdated 更新\nnext\n')
  await preview.locator('#rich-body').evaluate(element => {
    const visual = document.createElement('img')
    visual.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
    element.append(visual)
  })
  const invalid = await capture()
  expect(invalid.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('unsupported text content') })]))
  await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow('missing')
  await preview.locator('#rich-body').evaluate(element => {
    element.querySelector('img')!.remove()
    element.querySelector('strong')!.id = 'independent-run'
  })
  expect((await capture()).slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('independent anchors') })]))
  await preview.locator('#rich-body').evaluate(element => {
    element.querySelector('strong')!.removeAttribute('id')
    ;(element as HTMLElement).style.overflow = 'hidden'
  })
  expect((await capture()).slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('clipped') })]))
  await preview.locator('#rich-body').evaluate(element => {
    const root = element as HTMLElement
    root.style.overflow = 'visible'
    root.querySelector('p')!.style.width = '50%'
  })
  expect((await capture()).slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('paragraph width') })]))
})

test('retains independent source languages through nested lists, inline overrides, edits and native capture', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-languages\n---\n\n::ph-0::\n\n<div id="language-frame" data-fastppt-text-box><p>Base</p><p data-fastppt-level="2">Clear</p><ul lang="ja-JP"><li>Outer<ul><li>Nested</li></ul></li></ul><p>Inline <em lang="zh-CN" data-fastppt-alt-lang="">中文</em> tail</p><p lang="" data-fastppt-alt-lang="ko-KR">Authored</p><p data-fastppt-level="3">Third</p><p data-fastppt-level="2"></p></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  const frame = preview.locator('#language-frame')
  await expect(frame.locator('[data-fastppt-text-level]')).toHaveCount(8)
  await expect(preview.locator('[data-fastppt-group="language-footer"]')).toHaveAttribute('lang', 'de-DE')
  await expect(preview.locator('[data-fastppt-group="language-footer"]')).toHaveAttribute('data-fastppt-alt-lang', '')
  const expected = [['de-DE', 'en-GB'], ['', 'fr-FR'], ['ja-JP', 'en-GB'], ['ja-JP', 'fr-FR'], ['de-DE', 'en-GB'], ['', 'ko-KR'], ['de-DE', ''], ['', 'fr-FR']]
  const attributes = () => frame.locator('[data-fastppt-text-level]').evaluateAll(elements => elements.map(element => [element.getAttribute('lang'), element.getAttribute('data-fastppt-alt-lang')]))
  expect(await attributes()).toEqual(expected)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => {
    let captured: unknown
    await expect(async () => {
      captured = await preview.locator('.source-layout').evaluate(async (element, path) => {
        const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
        return captureHtmlSlide(element as HTMLElement)
      }, capturePath)
    }).toPass({ timeout: 20_000 })
    return HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  }
  const snapshot = await capture()
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const body = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'language-frame')!
  if (body.kind !== 'text') throw new Error('Expected captured text')
  expect(body.paragraphs!.map(paragraph => [paragraph.style.language, paragraph.style.alternativeLanguage])).toEqual(expected)
  expect(body.paragraphs![4]!.runs.find(run => run.text === '中文')!.style).toMatchObject({ language: 'zh-CN', alternativeLanguage: '' })
  expect(body.paragraphs![4]!.runs.at(-1)!.style).toMatchObject({ language: 'de-DE', alternativeLanguage: 'en-GB' })
  expect(body.paragraphs![7]!.runs).toEqual([])
  expect((await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })).qa.ok).toBe(true)
  await preview.locator('.source-layout').evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  expect(await attributes()).toEqual(expected)
  const current = await (await request.get(`http://127.0.0.1:4317/api/v1/decks/${deck.id}`)).json() as { revision: string }
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.revision, content: content.replace('<p data-fastppt-level="2">Clear', '<p data-fastppt-level="1">Restored').replace('lang="ja-JP"', 'lang="en-NZ"') } })).ok()).toBe(true)
  await expect(frame).toContainText('Restored')
  expect((await attributes()).slice(0, 4)).toEqual([expected[0], expected[0], ['en-NZ', 'en-GB'], ['en-NZ', 'fr-FR']])
  const edited = (await capture()).slides[0]!.elements.find(element => element.source.anchor === 'language-frame')!
  if (edited.kind !== 'text') throw new Error('Expected edited text')
  expect(edited.paragraphs![1]!.style).toMatchObject({ language: 'de-DE', alternativeLanguage: 'en-GB' })
  await preview.locator('.source-layout').screenshot({ path: test.info().outputPath('source-languages.png') })
})

test('keeps source text body insets and vertical alignment through resizing and native capture', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-text-body\n---\n\n::ph-0::\n\n<div id="body-frame" data-fastppt-text-box><p>底部对齐 A long line remains unwrapped when the source text body disables wrapping.</p></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  await expect(preview.locator('#body-frame')).toBeVisible()
  const measure = () => preview.locator('#body-frame').evaluate(element => {
    const root = element.closest('.source-layout')!, frame = element.parentElement!
    const rootBox = root.getBoundingClientRect(), rect = element.getBoundingClientRect(), frameBox = frame.getBoundingClientRect()
    const style = getComputedStyle(frame)
    return { left: (rect.left - frameBox.left) / rootBox.width, right: (frameBox.right - rect.right) / rootBox.width, bottom: (frameBox.bottom - rect.bottom) / rootBox.height, topPadding: parseFloat(style.paddingTop) / (root as HTMLElement).clientHeight, align: style.justifyContent, wrap: getComputedStyle(element.querySelector('p')!).whiteSpace }
  })
  const before = await measure()
  expect(before).toMatchObject({ align: 'flex-end', wrap: 'pre' })
  expect(before.left).toBeCloseTo(0, 4)
  expect(before.right).toBeCloseTo(300000 / 10000000, 4)
  expect(before.bottom).toBeCloseTo(100000 / 5625000, 4)
  expect(before.topPadding).toBeCloseTo(200000 / 5625000, 4)
  await preview.locator('.source-layout').evaluate(element => { const root = element as HTMLElement; root.style.width = '1000px'; root.style.height = '700px' })
  const resized = await measure()
  expect(resized.right).toBeCloseTo(before.right, 4)
  expect(resized.bottom).toBeCloseTo(before.bottom, 4)
  expect(resized.topPadding).toBeCloseTo(before.topPadding, 4)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  let captured: unknown
  await expect(async () => {
    captured = await preview.locator('.source-layout').evaluate(async (element, path) => {
      const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
      return captureHtmlSlide(element as HTMLElement)
    }, capturePath)
  }).toPass({ timeout: 20_000 })
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'body-frame')!
  if (text.kind !== 'text') throw new Error('Expected captured text frame')
  expect(text.verticalAlign).toBe('bottom')
  expect(text.textFrame?.wrap).toBe(false)
  expect(text.textFrame?.insetsPx.left).toBe(0)
  expect(text.textFrame!.insetsPx.right / snapshot.slides[0]!.width).toBeCloseTo(0.03, 4)
  expect(text.textFrame!.insetsPx.top / snapshot.slides[0]!.height).toBeCloseTo(200000 / 5625000, 4)
  expect(text.box.width / snapshot.slides[0]!.width).toBeCloseTo(0.8, 4)
  expect(text.box.height / snapshot.slides[0]!.height).toBeCloseTo(0.8, 4)
  const written = await writeEditablePptx(snapshot, downloadPath, {
    embedFonts: false, slideLayouts: ['source-text-body'],
    masterLayoutDefinitions: [{ name: 'source-text-body', canvas: { width: 10000000, height: 5625000 }, placeholders: [{ index: 0, type: 'body', x: 1000000, y: 562500, width: 8000000, height: 4500000, textBody: { insets: { left: 0, right: 300000, top: 200000, bottom: 100000 }, verticalAlign: 'bottom', wrap: false, autoFit: 'none' } }] }],
    placeholderBindings: [{ slide: 1, target: 'body-frame', index: 0, geometry: 'layout', textBody: 'layout' }],
  })
  expect(written.qa.ok).toBe(true)
})

test('keeps source bullet markers editable, separate from text, and synchronized after edits and resize', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-bullets\n---\n\n::ph-0::\n\n<div id="bullet-frame" data-fastppt-text-box><p><span style="display:none">HIDDEN</span><strong style="color:#445566">中文 First marker follows this visible run.</strong> This long paragraph wraps onto another line so the hanging marker stays outside the body and never becomes part of the text. This line keeps the same indentation.</p><p data-fastppt-level="2">Explicit symbol font, size and color.<br>Soft break</p><p data-fastppt-level="3">No marker at level three.</p><p data-fastppt-level="9">Ninth level returns to the base marker style.</p><p></p><ul><li data-fastppt-level="2" data-fastppt-no-bullet><p>Local cancellation.</p></li></ul></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  const frame = preview.locator('#bullet-frame')
  await expect(frame).toBeVisible()
  const markers = frame.locator('[data-fastppt-bullet-marker]')
  await expect(markers).toHaveCount(4)
  await expect(markers.first()).toHaveCSS('color', 'rgb(68, 85, 102)')
  await expect(markers.nth(1)).toHaveCSS('color', 'rgb(170, 85, 0)')
  await expect(markers.nth(3)).toHaveCSS('visibility', 'hidden')
  const measure = () => markers.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element), root = element.closest('.source-layout')!, owner = element.parentElement!
    return { character: element.textContent, font: style.fontFamily, size: parseFloat(style.fontSize), indent: parseFloat(style.left) / (root as HTMLElement).clientWidth, ownerHeight: parseFloat(getComputedStyle(owner).height), lineHeight: parseFloat(getComputedStyle(owner).lineHeight) }
  }))
  const before = await measure()
  expect(before[0]!.font).toContain('Noto Serif SC')
  expect(before[1]!.font).toContain('Times New Roman')
  expect(before[0]!.ownerHeight).toBeGreaterThan(before[0]!.lineHeight * 2)
  expect(before[0]!.indent).toBeCloseTo(-0.04, 4)
  await preview.locator('.source-layout').evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  await expect.poll(async () => (await measure())[1]!.size).toBeCloseTo(14 * 12700 / 10000000 * 1000, 2)
  expect((await measure())[0]!.indent).toBeCloseTo(before[0]!.indent, 4)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = () => preview.locator('.source-layout').evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)
  let captured: unknown
  await expect(async () => { captured = await capture() }).toPass({ timeout: 20_000 })
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'bullet-frame')!
  if (text.kind !== 'text') throw new Error('Expected captured bullet frame')
  expect(text.text).not.toMatch(/[•◆▸]|HIDDEN/)
  expect(text.paragraphs!.map(paragraph => [paragraph.level, paragraph.bullet?.kind])).toEqual([[1, 'character'], [2, 'character'], [3, 'none'], [9, 'character'], [1, 'character'], [2, 'none']])
  expect(text.paragraphs![0]!.bulletFont).toEqual({ kind: 'text' })
  expect(text.paragraphs![1]).toMatchObject({ bulletFont: { kind: 'font', fontFamily: 'Times New Roman' }, bulletColor: { kind: 'color', color: 'AA5500' }, bulletSize: { kind: 'pixels' } })
  expect(text.paragraphs![3]!.bulletSize).toEqual({ kind: 'percent', value: 80 })
  expect(text.paragraphs![4]!.runs).toEqual([])
  await preview.locator('.source-layout').screenshot({ path: test.info().outputPath('source-bullets.png') })
  const written = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(written.qa.ok).toBe(true)
  await markers.nth(1).evaluate(element => { element.textContent = 'BAD' })
  const invalid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(invalid.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('marker content or identity changed') })]))
  await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  const updated = content.replace('#445566', '#337755').replace('中文 First', 'Edited First')
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: updated } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited First')
  await expect(markers.first()).toHaveCSS('color', 'rgb(51, 119, 85)')
  await expect.poll(async () => (await measure())[0]!.font).toBe('Arial')
  await expect(async () => { const valid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] }); expect(valid.slides[0]!.warnings).toEqual([]) }).toPass({ timeout: 20_000 })
  // Older standalone themes used plain negative-indent markers without probes.
  await frame.evaluate(element => {
    for (const marker of element.querySelectorAll<HTMLElement>('[data-fastppt-bullet-marker]')) {
      marker.replaceChildren(document.createTextNode(marker.textContent ?? ''))
      marker.style.top = '0px'
      marker.parentElement!.querySelector('[data-fastppt-bullet-anchor]')?.remove()
    }
  })
  expect(HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] }).slides[0]!.warnings).toEqual([])
  await frame.evaluate(element => element.removeAttribute('data-fastppt-text-box'))
  const unframed = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(unframed.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('bullets require an explicit') })]))
  await expect(writeEditablePptx(unframed, downloadPath, { embedFonts: false })).rejects.toThrow()
})

test('recomputes native automatic numbering by DOM order and keeps frame and restart intent separate', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-numbering\n---\n\n::ph-0::\n\n<div id="number-frame" data-fastppt-text-box><p>A</p><p>B</p><p data-fastppt-level="2">C</p><p data-fastppt-no-bullet>Plain</p><p data-fastppt-level="2">D</p><p>E</p><p data-fastppt-level="2">F</p><p></p><p style="display:none">Hidden</p><ul><li data-fastppt-start-at="2">  <p>Restart</p>  <p>After</p>  </li></ul></div><div id="other-frame" data-fastppt-text-box><p>Independent</p></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  const frame = preview.locator('#number-frame'), markers = frame.locator('[data-fastppt-bullet-marker]')
  await expect(frame).toBeVisible()
  const labels = () => markers.evaluateAll(elements => elements.filter(element => (element.parentElement as HTMLElement).style.display !== 'none').map(element => element.textContent))
  await expect.poll(labels).toEqual(['5.', '6.', 'AA)', 'AB)', '7.', 'AA)', '', '2.', '3.'])
  await expect(preview.locator('#other-frame [data-fastppt-bullet-marker]')).toHaveText('5.')
  await preview.locator('.source-layout').evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  await expect.poll(labels).toEqual(['5.', '6.', 'AA)', 'AB)', '7.', 'AA)', '', '2.', '3.'])
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = () => preview.locator('.source-layout').evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)
  let captured: unknown
  await expect(async () => { captured = await capture() }).toPass({ timeout: 20_000 })
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'number-frame')!
  if (text.kind !== 'text') throw new Error('Expected numbering frame')
  expect(text.text).toBe('A\nB\nC\nPlain\nD\nE\nF\n\nRestart\nAfter')
  expect(text.paragraphs!.map(paragraph => paragraph.numberingRestart)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 2, undefined])
  expect(text.paragraphs![0]!.bullet).toEqual({ kind: 'auto-number', scheme: 'arabicPeriod', startAt: 5 })
  const written = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(written.qa.ok).toBe(true)
  expect(written.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'numbering-compatibility' })]))
  await preview.locator('.source-layout').screenshot({ path: test.info().outputPath('source-numbering.png') })
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  const updated = content.replace('<p>A</p><p>B</p>', '<p>B</p><p>A</p><p>Inserted</p>').replace('data-fastppt-start-at="2"', 'data-fastppt-start-at="1"')
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: updated } })).ok()).toBe(true)
  await expect(frame).toContainText('Inserted')
  await expect.poll(labels).toEqual(['5.', '6.', '7.', 'AA)', 'AB)', '8.', 'AA)', '', '1.', '2.'])
  await expect(async () => {
    const valid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
    expect(valid.slides[0]!.warnings).toEqual([])
  }).toPass({ timeout: 20_000 })
  await markers.first().evaluate(element => { element.textContent = '999.' })
  const invalid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(invalid.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('marker content or identity changed') })]))
  await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
  await markers.first().evaluate(element => { element.textContent = '5.'; element.parentElement!.setAttribute('data-fastppt-numbering-restart', '0') })
  const malformed = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(malformed.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('numbering restart') })]))
  const switchLayout = async (next: string) => {
    const latest = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
    expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: latest.find(item => item.id === deck.id)!.revision, content: next } })).ok()).toBe(true)
  }
  await switchLayout(updated.replace('source-numbering', 'source-bullets').replace('data-fastppt-start-at="1"', ''))
  await expect(markers.first()).toHaveText('•')
  await expect(markers.nth(3)).toHaveText('◆')
  await switchLayout(content)
  await expect.poll(labels).toEqual(['5.', '6.', 'AA)', 'AB)', '7.', 'AA)', '', '2.', '3.'])
  await expect(preview.locator('#other-frame [data-fastppt-bullet-marker]')).toHaveText('5.')
})

test('measures literal source tabs across runs, explicit clears, soft breaks and resized canvases', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-tabs\n---\n\n::ph-0::\n\n<div id="tab-frame" data-fastppt-text-box><p>A<span>&#9;</span><strong>中文</strong>&#9;&#9;D</p><p data-fastppt-level="2">A&#9;B&#9;C</p><p data-fastppt-level="3">A&#9;B&#9;C</p><p data-fastppt-level="4">A&#9;B&#9;C</p><p>A&#9;B<br>C&#9;D</p></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), frame = preview.locator('#tab-frame')
  await expect(frame).toBeVisible()
  const markers = frame.locator('[data-fastppt-tab]')
  await expect(markers).toHaveCount(11)
  const positions = () => markers.evaluateAll(elements => elements.map(element => {
    const root = element.closest('.source-layout')!, paragraph = element.closest('[data-fastppt-text-level]')!
    return (element.getBoundingClientRect().right - paragraph.getBoundingClientRect().left) / root.getBoundingClientRect().width
  }))
  const expected = [0.1, 0.2, 0.4, 0.08, 0.16, 0.15, 0.3, 0, 0.08, 0.1, 0.1]
  await expect.poll(async () => (await positions()).map(value => (Math.round(value * 1000) || 0))).toEqual(expected.map(value => value * 1000))
  await preview.locator('.source-layout').evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  await expect.poll(async () => (await positions()).map(value => (Math.round(value * 1000) || 0))).toEqual(expected.map(value => value * 1000))
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = () => preview.locator('.source-layout').evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)
  let captured: unknown
  await expect(async () => { captured = await capture() }).toPass({ timeout: 20_000 })
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [captured] })
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'tab-frame')!
  if (text.kind !== 'text') throw new Error('Expected tab frame')
  expect(text.text).toBe('A\t中文\t\tD\nA\tB\tC\nA\tB\tC\nA\tB\tC\nA\tB\nC\tD')
  expect(text.paragraphs![1]!.tabStopsPx).toEqual([])
  expect(text.paragraphs![2]!.defaultTabSizePx).toBe(0)
  const written = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(written.qa.ok).toBe(true)
  expect(written.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'text-tab-compatibility' })]))
  await preview.locator('.source-layout').screenshot({ path: test.info().outputPath('source-tabs.png') })
  await markers.first().evaluate(element => { (element as HTMLElement).style.width = `${parseFloat(getComputedStyle(element).width) + 8}px` })
  const invalid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(invalid.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('tab width') })]))
  await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('<strong>中文</strong>', '<strong>Edited</strong>') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited')
  await expect.poll(async () => (await positions()).map(value => (Math.round(value * 1000) || 0))).toEqual(expected.map(value => value * 1000))
  await expect(async () => {
    const valid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
    expect(valid.slides[0]!.warnings).toEqual([])
  }).toPass({ timeout: 20_000 })
  const paragraph = frame.locator('[data-fastppt-text-level]').first()
  const originalContract = await paragraph.getAttribute('data-fastppt-tabs')
  for (const contract of [
    { defaultTabSize: 600000, tabStops: [{ position: 1000000, align: 'right' }] },
    { defaultTabSize: 0, tabStops: [] },
    { tabStops: [{ position: 2000000, align: 'left' }, { position: 1000000, align: 'left' }] },
  ]) {
    await paragraph.evaluate((element, value) => element.setAttribute('data-fastppt-tabs', JSON.stringify(value)), contract)
    const invalidContract = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
    expect(invalidContract.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot' })]))
    await expect(writeEditablePptx(invalidContract, downloadPath, { embedFonts: false })).rejects.toThrow()
  }
  await paragraph.evaluate((element, value) => element.setAttribute('data-fastppt-tabs', value!), originalContract)
  await frame.locator('[data-fastppt-text-level]').last().evaluate(element => element.appendChild(document.createTextNode(' wrapping text'.repeat(25))))
  const unprojected = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(unprojected.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('projected text leaves') })]))
  await expect(writeEditablePptx(unprojected, downloadPath, { embedFonts: false })).rejects.toThrow()
  // Author through the real source path so new text receives the same style
  // contracts as the existing runs. A raw DOM insertion must not bypass them.
  const beforeWrap = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  const suffix = ' wrapping text'.repeat(25)
  const wrappedContent = content.replace('<strong>中文</strong>', '<strong>Edited</strong>').replace('C&#9;D</p>', `C&#9;D${suffix}</p>`)
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: beforeWrap.find(item => item.id === deck.id)!.revision, content: wrappedContent } })).ok()).toBe(true)
  await expect(frame).toContainText(`D${suffix}`)
  let wrapped = snapshot
  await expect(async () => {
    wrapped = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
    expect(wrapped.slides[0]!.warnings).toEqual([])
  }).toPass({ timeout: 20_000 })
  const wrappedText = wrapped.slides[0]!.elements.find(element => element.source.anchor === 'tab-frame')!
  if (wrappedText.kind !== 'text') throw new Error('Expected wrapped tab frame')
  expect(wrappedText.text).toBe(text.text.replace('中文', 'Edited') + suffix)
  expect(wrappedText.paragraphs!.at(-1)!.tabLayout!.lines.some(line => line.breakBefore === 'automatic')).toBe(true)
  expect((await writeEditablePptx(wrapped, downloadPath, { embedFonts: false })).qa.ok).toBe(true)
  await frame.evaluate(element => element.removeAttribute('data-fastppt-text-box'))
  const unframed = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(unframed.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('tabs require an explicit') })]))
})

test('measures centered and right tab fields across inline runs, breaks, collisions and edits', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-tabs\n---\n\n::ph-0::\n\n<div id="aligned-frame" data-fastppt-text-box><p data-fastppt-level="5">A&#9;<span data-field="center" data-stop="1500000">AB<strong>中文</strong></span>&#9;<span data-field="center" data-stop="3500000">CD</span></p><p data-fastppt-level="6">A&#9;<span data-field="right" data-stop="1500000"><strong>AB</strong>中文</span>&#9;<span data-field="right" data-stop="3500000">CD</span></p><p data-fastppt-level="5">A&#9;&#9;<span data-field="center" data-stop="3500000">E</span></p><p data-fastppt-level="6">A&#9;<span data-field="right" data-stop="1500000">BB</span><br>X&#9;<span data-field="right" data-stop="1500000">YY</span></p><p data-fastppt-level="5">A&#9;<span data-clamped>MMMMMMMMMMMMMMMMMMMMMMMMMMMM</span></p><p data-fastppt-level="6">A&#9;<span data-field="right" data-stop="1500000">F</span>&#9;<span data-field="right" data-stop="3500000">G</span>&#9;<span data-field="left" data-stop="3600000">H</span></p><p data-fastppt-level="5">A&#9;<span data-newline>{{ "BB\\nX" }}</span>&#9;<span data-field="center" data-stop="1500000">YY</span></p></div>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), frame = preview.locator('#aligned-frame')
  await expect(frame).toBeVisible()
  await expect(frame.locator('[data-fastppt-tab]')).toHaveCount(14)
  const errors = () => frame.locator('[data-field]').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(), paragraph = element.closest('[data-fastppt-text-level]')!, root = element.closest('.source-layout')!
    const point = element.getAttribute('data-field') === 'center' ? (rect.left + rect.right) / 2 : element.getAttribute('data-field') === 'right' ? rect.right : rect.left
    return (point - paragraph.getBoundingClientRect().left) / root.getBoundingClientRect().width - Number(element.getAttribute('data-stop')) / 10000000
  }))
  await expect.poll(async () => (await errors()).every(value => Math.abs(value) < 0.0001)).toBe(true)
  await preview.locator('.source-layout').evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  await expect.poll(async () => (await errors()).every(value => Math.abs(value) < 0.0001)).toBe(true)
  expect(await frame.locator('[data-newline]').textContent()).toBe('BB\nX')
  const clamped = frame.locator('[data-clamped]')
  expect(await clamped.evaluate(element => parseFloat(getComputedStyle(element.parentElement!.querySelector('[data-fastppt-tab]')!).width))).toBe(0)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = () => preview.locator('.source-layout').evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'aligned-frame')!
  if (text.kind !== 'text') throw new Error('Expected aligned text frame')
  expect(text.text.match(/\t/g)).toHaveLength(14)
  expect(text.paragraphs!.map(paragraph => paragraph.tabStopsPx![0]!.align)).toEqual(['center', 'right', 'center', 'right', 'center', 'right', 'center'])
  expect((await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })).qa.ok).toBe(true)
  await preview.locator('.source-layout').screenshot({ path: test.info().outputPath('aligned-tabs.png') })
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replaceAll('中文', 'Edited') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited')
  await expect.poll(async () => (await errors()).every(value => Math.abs(value) < 0.0001)).toBe(true)
  const edited = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(edited.slides[0]!.warnings).toEqual([])
  await frame.locator('[data-field="center"]').first().evaluate(element => element.appendChild(document.createTextNode(' unexpected change')))
  const stale = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(stale.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('tab width') })]))
  await expect(writeEditablePptx(stale, downloadPath, { embedFonts: false })).rejects.toThrow()
})

test('measures declared decimal fields independently of run language and rejects stale or unbound conventions', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = `---
theme: slidev-theme-academy
layout: source-tabs
---

::ph-0::

<div id="decimal-frame" data-fastppt-text-box><p data-fastppt-level="7" lang="de-DE">A&#9;<span data-field="." data-stop="1500000">12<strong>.34</strong>.56</span>&#9;<span data-field="." data-stop="3500000">6.7</span></p><p data-fastppt-level="8" lang="en-US">A&#9;<span data-field="," data-stop="1500000">1<strong>,2</strong>,3</span></p><p data-fastppt-level="7">A&#9;<span data-field="end" data-stop="1500000">12,34</span></p><p data-fastppt-level="8">A&#9;<span data-field="end" data-stop="1500000">12.34</span></p><p data-fastppt-level="7">A&#9;<span data-field="." data-stop="1500000"><strong>中文</strong>AB.3</span></p><p data-fastppt-level="8">A&#9;<span data-field="," data-stop="1500000">,12</span>&#9;<span data-field="," data-stop="3500000">34,</span></p><p data-fastppt-level="7">A&#9;&#9;<span data-field="." data-stop="3500000">.5</span></p><p data-fastppt-level="8">A&#9;<span data-field="," data-stop="1500000">1,2</span><br>B&#9;<span data-field="," data-stop="1500000">3,4</span></p><p data-fastppt-level="7">A&#9;<span data-field="." data-stop="1500000">1.2</span>&#9;<span data-field="end" data-stop="3500000">34</span>&#9;<span data-field="start" data-stop="3600000">5.6</span></p><p data-fastppt-level="7">A&#9;<span data-clamped>MMMMMMMMMMMMMMMMMMMM.56</span></p><p data-fastppt-level="9">A&#9;B</p></div>
`
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), frame = preview.locator('#decimal-frame')
  await expect(frame).toBeVisible()
  await expect(frame.locator('[data-fastppt-tab]')).toHaveCount(17)
  const errors = () => frame.locator('[data-field]').evaluateAll(elements => elements.map(element => {
    const paragraph = element.closest('[data-fastppt-text-level]')!, root = element.closest('.source-layout')!, rect = element.getBoundingClientRect(), kind = element.getAttribute('data-field')!
    let point = kind === 'end' ? rect.right : rect.left
    if (kind === '.' || kind === ',') {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.textContent!.indexOf(kind)
        if (index < 0) continue
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1)
        point = range.getBoundingClientRect().left
        break
      }
    }
    return (point - paragraph.getBoundingClientRect().left) / root.getBoundingClientRect().width - Number(element.getAttribute('data-stop')) / 10000000
  }))
  await expect.poll(async () => (await errors()).every(value => Math.abs(value) < 0.0001)).toBe(true)
  await preview.locator('.source-layout').evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  await expect.poll(async () => (await errors()).every(value => Math.abs(value) < 0.0001)).toBe(true)
  expect(await frame.locator('[data-clamped]').evaluate(element => parseFloat(getComputedStyle(element.parentElement!.querySelector('[data-fastppt-tab]')!).width))).toBe(0)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = () => preview.locator('.source-layout').evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)
  const snapshot = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'decimal-frame')!
  if (text.kind !== 'text') throw new Error('Expected decimal text frame')
  expect(text.text.match(/\t/g)).toHaveLength(17)
  expect(text.paragraphs![0]!.decimalTab).toMatchObject({ separator: '.', targetProfile: 'libreoffice-7.3.7.2-linux-en-US' })
  expect(text.paragraphs![1]!.decimalTab).toMatchObject({ separator: ',', targetProfile: 'libreoffice-7.3.7.2-linux-de-DE' })
  expect(text.paragraphs!.at(-1)!.decimalTab).toBeNull()
  const written = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(written.qa.ok).toBe(true)
  expect(written.objects.find(object => object.source.anchor === 'decimal-frame')).toMatchObject({ kind: 'text', nativeCount: 1, imageCount: 0, status: 'native' })
  expect(written.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'text-tab-compatibility', message: expect.stringContaining('system locale de-DE') }), expect.objectContaining({ message: expect.stringContaining('known indent differences') })]))
  await preview.locator('.source-layout').screenshot({ path: test.info().outputPath('decimal-tabs.png') })
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('中文', 'Edited').replace('12<strong>.34', '123<strong>.34') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited')
  await expect.poll(async () => (await errors()).every(value => Math.abs(value) < 0.0001)).toBe(true)
  const edited = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(edited.slides[0]!.warnings).toEqual([])
  const paragraph = frame.locator('[data-fastppt-text-level]').first()
  const original = JSON.parse((await paragraph.getAttribute('data-fastppt-tabs'))!) as { decimalTab: { separator: string; targetProfile: string } }
  for (const declaration of [null, undefined, { ...original.decimalTab, separator: ',' }, { ...original.decimalTab, targetProfile: 'unverified' }]) {
    await paragraph.evaluate((element, contract) => element.setAttribute('data-fastppt-tabs', JSON.stringify(contract)), { ...original, decimalTab: declaration })
    const invalid = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
    expect(invalid.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('separator convention') })]))
    await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
  }
  await paragraph.evaluate((element, contract) => element.setAttribute('data-fastppt-tabs', JSON.stringify(contract)), original)
  await frame.locator('[data-field="."]').first().evaluate(element => { element.prepend(document.createTextNode('stale')) })
  const stale = HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await capture()] })
  expect(stale.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot', message: expect.stringContaining('tab width') })]))
  await expect(writeEditablePptx(stale, downloadPath, { embedFonts: false })).rejects.toThrow()
})

test('captures automatic tab lines and reselects stops after wrapping without adding native breaks', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const bodies = [
    '<p>A&#9;BBBB CCCC DDDD EEEE</p><p data-fastppt-level="5">ABCDEFGHIJKLMN&#9;B</p><p data-fastppt-level="6">A&#9;B</p>',
    '<p data-fastppt-level="2">A&#9;BBBB CCCC DDDD EEEE</p><p data-fastppt-level="3">A&#9;BBBB CCCC DDDD EEEE</p><p data-fastppt-level="4">A&#9;12.34 CCCC DDDD EEEE</p>',
    '<p>AAAA BBBB CCCC DDDD&#9;EE FF</p><p>A&#9;BBBBBBBBBBBBBBBBBBBBB</p><p>A&#9;B<br>C&#9;D<br></p>',
    '<p data-fastppt-level="7">A&#9;BBBB CCCC DDDD EEEE</p><p data-fastppt-level="8">A&#9;BBBB CCCC DDDD EEEE</p><p data-fastppt-level="4">A&#9;BBBB CCCC DDDD. EEEE</p>',
  ]
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-wrapped-tabs\n---\n' + bodies.map((body, index) => `\n::ph-${index}::\n\n<div id="flow-${index}" data-fastppt-text-box>${body}</div>\n`).join('')
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), root = preview.locator('.source-layout')
  await expect(preview.locator('#flow-3')).toBeVisible()
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await root.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const check = async () => {
    const snapshot = await capture()
    expect(snapshot.slides[0]!.warnings).toEqual([])
    const frames = snapshot.slides[0]!.elements.filter(element => element.kind === 'text' && element.source.anchor?.startsWith('flow-'))
    expect(frames).toHaveLength(4)
    const lines = frames.map(frame => {
      if (frame.kind !== 'text') throw new Error('Expected flow frame')
      return frame.paragraphs!.map(paragraph => {
        const layout = paragraph.tabLayout!
        expect(layout.text).toBe(paragraph.runs.map(run => run.text).join(''))
        return layout.lines.map(line => layout.text.slice(line.start, line.end))
      })
    })
    expect(lines[0]).toEqual([['A\tBBBB CCCC ', 'DDDD EEEE'], ['ABCDEFGHIJKLMN', '\tB'], ['A', '\t', 'B']])
    expect(lines[1]).toEqual([['A\tBBBB CCCC DDDD ', 'EEEE'], ['A\tBBBB CCCC DDDD ', 'EEEE'], ['A\t12.34 CCCC ', 'DDDD EEEE']])
    expect(lines[2]![0]).toEqual(['AAAA BBBB CCCC ', 'DDDD\tEE FF'])
    expect(lines[2]![1]).toEqual(['A\t', 'BBBBBBBBBBBBBBB', 'BBBBBB'])
    expect(lines[2]![2]).toEqual(['A\tB\n', 'C\tD\n', ''])
    return snapshot
  }
  let snapshot: Awaited<ReturnType<typeof capture>> | undefined
  await expect(async () => { snapshot = await check() }).toPass({ timeout: 20_000 })
  await root.evaluate(element => { (element as HTMLElement).style.width = '1000px' })
  await expect(async () => { snapshot = await check() }).toPass({ timeout: 20_000 })
  const written = await writeEditablePptx(snapshot!, downloadPath, { embedFonts: false })
  expect(written.qa.ok).toBe(true)
  expect(written.objects.filter(object => object.kind === 'text').map(object => object.nativeCount)).toEqual([1, 1, 1, 1])
  expect(written.warnings.some(warning => warning.message.includes('automatic tab lines are browser measurements'))).toBe(true)
  await root.screenshot({ path: test.info().outputPath('wrapped-tabs.png') })
  const stale = structuredClone(snapshot!)
  const first = stale.slides[0]!.elements.find(element => element.kind === 'text')!
  if (first.kind !== 'text') throw new Error('Expected first flow frame')
  first.paragraphs![0]!.tabLayout!.text += 'tampered'
  await expect(writeEditablePptx(stale, downloadPath, { embedFonts: false })).rejects.toThrow()
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replaceAll('BBBB CCCC DDDD EEEE', 'BB CC DD EE') } })).ok()).toBe(true)
  await expect(preview.locator('#flow-0')).toContainText('BB CC DD EE')
  await expect(async () => {
    const edited = await capture(); expect(edited.slides[0]!.warnings).toEqual([])
    const text = edited.slides[0]!.elements.find(element => element.source.anchor === 'flow-0')!
    if (text.kind !== 'text') throw new Error('Expected edited frame')
    expect(text.paragraphs![0]!.tabLayout!.lines).toHaveLength(2)
    expect(text.paragraphs![0]!.tabLayout!.text).toBe('A\tBB CC DD EE')
  }).toPass({ timeout: 20_000 })
  await preview.locator('#flow-0 p').first().evaluate(element => { (element as HTMLElement).style.wordBreak = 'break-all' })
  const unsupported = await capture()
  expect(unsupported.slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot' && warning.message.includes('ordinary word breaks'))).toBe(true)
})

test('measures bullet first-line occupancy, alignment and baselines without changing native indent', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-bullet-geometry\n---\n' + [0, 1, 2, 3].map(index => `\n::ph-${index}::\n\n<div id="geometry-${index}" data-fastppt-text-box><p>AAAA BBBB CCCC</p><p data-fastppt-level="2">AAAA BBBB CCCC</p><p data-fastppt-level="3">AAAA BBBB CCCC</p><p data-fastppt-level="7">AAAA BBBB</p><p data-fastppt-level="3">AAAAAAAAAAAAAAAAAAAA</p><p data-fastppt-level="4"><strong>Small</strong></p><p data-fastppt-level="5">Large<br>Soft</p><p data-fastppt-level="6">Points</p><p></p><p style="display:none">Hidden</p></div>\n`).join('')
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame()
  const root = preview.locator('.source-layout')
  await expect(preview.locator('#geometry-0')).toBeVisible()
  const geometry = () => root.evaluate(element => [...element.querySelectorAll<HTMLElement>('[id^="geometry-"]')].map(frame => [...frame.querySelectorAll<HTMLElement>(':scope > p')].filter(p => p.style.display !== 'none').map(p => {
    const marker = p.querySelector<HTMLElement>('[data-fastppt-bullet-marker]')!, label = marker.querySelector('[data-fastppt-bullet-label]')!, anchor = p.querySelector('[data-fastppt-bullet-anchor]')!, baseline = marker.querySelector('[data-fastppt-bullet-baseline]')!
    const range = document.createRange(); range.selectNodeContents(label)
    const factor = 960 / element.getBoundingClientRect().width
    const owner = p.getBoundingClientRect(), origin = anchor.getBoundingClientRect()
    return { label: label.textContent, prefix: parseFloat(getComputedStyle(p).textIndent) * 960 / parseFloat(getComputedStyle(element).width), advance: range.getBoundingClientRect().width * factor, marker: (marker.getBoundingClientRect().left - owner.left) * factor, first: (origin.left - owner.left) * factor, baseline: (baseline.getBoundingClientRect().top - origin.top) * factor, height: owner.height * factor }
  })))
  await expect.poll(async () => (await geometry())[0]![2]!.prefix).toBeCloseTo(32, 1)
  const before = await geometry()
  for (const [index, column] of before.entries()) {
    expect(column.map(value => value.label)).toEqual(['*', '*', '*', '1234.', '*', '*', '*', '*', '*'])
    for (const [at, indent] of [-20, 0, 20, -20, 20, 0, 0, 20, -20].entries()) {
      const value = column[at]!
      expect(value.prefix).toBeCloseTo(at === 8 ? 0 : Math.max(0, indent + value.advance), 1)
      if (at !== 8) {
        expect(value.marker).toBeCloseTo(value.first + indent - value.prefix, 1)
        expect(value.baseline).toBeCloseTo(0, 1)
      }
    }
    expect(column[0]!.first).toBeCloseTo([0, 19, 38, 0][index]!, 0)
    expect(column[2]!.first).toBeCloseTo([32, 35, 38, 32][index]!, 0)
    expect(column[4]!.height).toBeCloseTo(60, 1) // Long word fills the remaining first line.
  }
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await root.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const snapshot = await capture()
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const frames = snapshot.slides[0]!.elements.filter(element => element.source.anchor?.startsWith('geometry-'))
  expect(frames).toHaveLength(4)
  for (const frame of frames) {
    if (frame.kind !== 'text') throw new Error('Expected bullet text frame')
    expect(frame.text).not.toMatch(/\*|1234\.|Hidden/)
    expect(frame.paragraphs!.map(p => Math.round(p.indentPx * 960 / snapshot.slides[0]!.width))).toEqual([-20, 0, 20, -20, 20, 0, 0, 20, -20])
    expect(frame.paragraphs![7]!.bulletSize).toMatchObject({ kind: 'pixels' })
    expect((frame.paragraphs![7]!.bulletSize as { value: number }).value * 960 / snapshot.slides[0]!.width).toBeCloseTo(36, 1)
  }
  const result = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(result.qa.ok).toBe(true)
  expect(result.warnings.some(warning => warning.code === 'text-bullet-compatibility')).toBe(true)
  await root.evaluate(element => { (element as HTMLElement).style.width = '1200px' })
  await expect.poll(async () => (await geometry())[0]![7]!.advance).toBeCloseTo(21.6, 1)
  expect((await capture()).slides[0]!.warnings).toEqual([])
  await root.screenshot({ path: test.info().outputPath('bullet-geometry.png') })
  // Tampering is rejected, not silently converted to a different native indent/font.
  const paragraph = preview.locator('#geometry-0 > p').nth(2)
  for (const mutation of ['position', 'prefix', 'baseline', 'label', 'anchor-content', 'size', 'oversized']) {
    const saved = await paragraph.evaluate(element => element.outerHTML)
    await paragraph.evaluate((element, kind) => {
      const marker = element.querySelector<HTMLElement>('[data-fastppt-bullet-marker]')!
      if (kind === 'position') marker.style.left = `${parseFloat(marker.style.left) + 4}px`
      if (kind === 'prefix') (element as HTMLElement).style.textIndent = '0px'
      if (kind === 'baseline') marker.style.top = `${parseFloat(marker.style.top) + 4}px`
      if (kind === 'label') marker.querySelector<HTMLElement>('[data-fastppt-bullet-label]')!.style.color = 'red'
      if (kind === 'anchor-content') element.querySelector('[data-fastppt-bullet-anchor]')!.textContent = 'LOST'
      if (kind === 'size') { marker.style.fontSize = '50px'; element.setAttribute('data-fastppt-bullet', JSON.stringify({ bullet: { kind: 'character', character: '*' }, bulletFont: { kind: 'font', fontFamily: 'Liberation Mono' }, bulletSize: { kind: 'points', value: 36 }, bulletColor: { kind: 'text' } })) }
      if (kind === 'oversized') element.setAttribute('data-fastppt-bullet-indent', String(160 * 12700))
    }, mutation)
    expect((await capture()).slides[0]!.warnings, mutation).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot' })]))
    await paragraph.evaluate((element, html) => { element.outerHTML = html }, saved)
  }
  expect((await capture()).slides[0]!.warnings).toEqual([])
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replaceAll('AAAA BBBB CCCC', 'Edited').replace('AAAAAAAAAAAAAAAAAAAA', 'A\tB\tC') } })).ok()).toBe(true)
  await expect(preview.locator('#geometry-2 > p').first()).toContainText('Edited')
  await expect(async () => { expect((await capture()).slides[0]!.warnings).toEqual([]) }).toPass()
})

test('projects source decorations onto editable runs with independent cancellation and inherited defaults', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-decorations\n---\n\n::ph-0::\n\n<div id="decorations" data-fastppt-text-box><p>Both 中文</p><p data-fastppt-level="2">Strike only</p><p data-fastppt-level="3">Underline only</p><p data-fastppt-level="9">Plain <u>HTML underline</u> <s>HTML strike</s></p><p data-fastppt-underline="false">Local strike <span data-fastppt-strike="false">Cancelled</span> Resumed</p><p>Base <span data-fastppt-underline="false"><strong>Strike</strong><span data-fastppt-strike="false"> Neither</span></span> Both</p><p data-fastppt-level="4">Decorated bullet body</p><p data-fastppt-underline="false" data-fastppt-strike="false"></p><p data-fastppt-level="3">Before<br>After <a href="https://example.com/" style="border:0;color:inherit">Link</a></p><p data-fastppt-level="5">A&#9;B</p></div>\n\n::ph-1::\n\n<p id="ordinary-decoration">Ordinary 中文 <span data-fastppt-underline="false">strike</span></p>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), root = preview.locator('.source-layout'), frame = preview.locator('#decorations')
  await expect(frame).toBeVisible()
  const projected = () => frame.locator('[data-fastppt-text-decoration-run]').evaluateAll(elements => elements.map(element => ({ text: element.textContent, lines: getComputedStyle(element).textDecorationLine })))
  expect(await projected()).toEqual(expect.arrayContaining([
    { text: 'Both ', lines: 'underline line-through' }, { text: '中文', lines: 'underline line-through' },
    { text: 'Strike only', lines: 'line-through' }, { text: 'Underline only', lines: 'underline' },
    { text: 'Cancelled', lines: 'none' }, { text: ' Resumed', lines: 'line-through' }, { text: ' Neither', lines: 'none' }, { text: ' Both', lines: 'underline line-through' },
  ]))
  await expect(frame.locator('[data-fastppt-bullet-marker]')).toHaveCSS('text-decoration-line', 'none')
  await expect(root.locator('[data-fastppt-layout-object="Decorated Footer"]')).toHaveCSS('text-decoration-line', 'underline line-through')
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await root.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const snapshot = await capture()
  expect(snapshot.slides[0]!.warnings).toEqual([])
  const text = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'decorations')!
  if (text.kind !== 'text') throw new Error('Expected decorated text frame')
  expect(text.paragraphs!.map(paragraph => paragraph.style.decoration)).toEqual([['underline', 'line-through'], ['line-through'], ['underline'], [], ['line-through'], ['underline', 'line-through'], ['underline', 'line-through'], [], ['underline'], ['underline', 'line-through']])
  expect(text.paragraphs!.at(-1)!.runs.map(run => run.text).join('')).toBe('A\tB')
  expect(text.paragraphs!.at(-1)!.runs.every(run => run.style.decoration.join(' ') === 'underline line-through')).toBe(true)
  const ordinary = snapshot.slides[0]!.elements.filter(element => element.kind === 'text' && element.text.includes('Ordinary'))
  expect(ordinary).toHaveLength(1)
  expect(ordinary[0]!.kind === 'text' && ordinary[0]!.text).toBe('Ordinary 中文 ')
  if (ordinary[0]!.kind !== 'text') throw new Error('Expected ordinary decorated text')
  expect(ordinary[0]!.style.decoration).toEqual(['underline', 'line-through'])
  expect(snapshot.slides[0]!.elements.find(element => element.kind === 'text' && element.text === 'strike')).toMatchObject({ style: { decoration: ['line-through'] } })
  const runs = text.paragraphs!.flatMap(paragraph => paragraph.runs)
  for (const [value, lines] of [['Cancelled', []], [' Neither', []], ['Strike', ['line-through']], ['HTML underline', ['underline']], ['HTML strike', ['line-through']], ['Link', ['underline']], ['\n', ['underline']]] as const)
    expect(runs.find(run => run.text === value)?.style.decoration).toEqual(lines)
  expect(runs.find(run => run.text === 'Link')!.hyperlink).toBe('https://example.com/')
  expect((await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })).qa.ok).toBe(true)
  await root.evaluate(element => { (element as HTMLElement).style.width = '1100px' })
  expect((await capture()).slides[0]!.warnings).toEqual([])
  await root.screenshot({ path: test.info().outputPath('source-decorations.png') })
  const decoratedRun = frame.locator('[data-fastppt-text-decoration-run]').first()
  const original = await decoratedRun.getAttribute('style')
  for (const change of ['double', 'color', 'offset', 'skip-ink', 'clear']) {
    await decoratedRun.evaluate((element, value) => {
      const style = (element as HTMLElement).style
      if (value === 'double') style.textDecorationStyle = 'double'
      if (value === 'color') style.textDecorationColor = 'red'
      if (value === 'offset') style.textUnderlineOffset = '4px'
      if (value === 'skip-ink') style.textDecorationSkipInk = 'auto'
      if (value === 'clear') style.textDecorationLine = 'none'
    }, change)
    const invalid = await capture()
    expect(invalid.slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot' })]))
    await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
    await decoratedRun.evaluate((element, value) => element.setAttribute('style', value!), original)
  }
  const htmlUnderline = frame.locator('u [data-fastppt-text-decoration-run]')
  await htmlUnderline.evaluate(element => { (element as HTMLElement).style.color = 'red' })
  expect((await capture()).slides[0]!.warnings.some(warning => warning.message.includes('inherited decoration color'))).toBe(true)
  await htmlUnderline.evaluate(element => { (element as HTMLElement).style.removeProperty('color') })
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('Local strike', 'Edited strike').replace('data-fastppt-level="2"', 'data-fastppt-level="9"') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited strike')
  await expect.poll(projected).toEqual(expect.arrayContaining([{ text: 'Strike only', lines: 'none' }]))
  await expect(async () => { expect((await capture()).slides[0]!.warnings).toEqual([]) }).toPass()
  await decoratedRun.evaluate(element => element.setAttribute('data-fastppt-text-decoration-run', '{"underline":"double"}'))
  expect((await capture()).slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot' })]))
  const latest = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: latest.find(item => item.id === deck.id)!.revision, content: content.replace('<p>Both 中文</p>', '<p data-fastppt-underline="double">Invalid author flag</p>') } })).ok()).toBe(true)
  await expect(frame).toContainText('Invalid author flag')
  expect((await capture()).slides[0]!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-snapshot' })]))
})

test('preserves signed source letter spacing through levels, inline edits, tabs, wrapping and native capture', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-letter-spacing\n---\n\n::ph-0::\n\n<div id="spacing" data-fastppt-text-box><p>AAAA</p><p data-fastppt-level="2">BBBB</p><p data-fastppt-level="3">CCCC</p><p data-fastppt-level="4">Fractional</p><p>A<span style="letter-spacing:0">Zero</span><strong style="letter-spacing:-0.125cqw">Negative</strong><a href="https://example.com/" style="border:0;color:inherit;letter-spacing:0">Link</a></p><p data-fastppt-level="3"></p><p>Before<br>After</p><p data-fastppt-level="5">A&#9;B</p><p>Latin中文</p></div>\n' + [1, 2, 3].map(index => `\n::ph-${index}::\n\n<div id="spacing-wrap-${index}" data-fastppt-text-box><p>AAAA BBBB CCCC</p></div>\n`).join('') + '\n::ph-4::\n\n<p id="ordinary-spacing">Ordinary中文</p>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), root = preview.locator('.source-layout'), frame = preview.locator('#spacing')
  await expect(frame).toBeVisible()
  const computedSpacing = () => frame.locator('p').evaluateAll(paragraphs => paragraphs.map(element => Number(((parseFloat(getComputedStyle(element).letterSpacing) || 0) * 960 / parseFloat(getComputedStyle(element.closest('.source-layout')!).width)).toFixed(2))))
  await expect.poll(computedSpacing).toEqual([2, 0, -2, 1.25, 2, -2, 2, 2, 2])
  const layout = () => root.evaluate(element => {
    const scale = 960 / element.getBoundingClientRect().width
    return [1, 2, 3].map(index => {
      const paragraph = element.querySelector(`#spacing-wrap-${index} p`)!, rows: Array<{ y: number; text: string }> = []
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) for (let offset = 0; offset < node.textContent!.length; offset++) {
        const character = node.textContent![offset]!
        if (character === ' ') continue
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1)
        const box = range.getBoundingClientRect(), y = Math.round((box.y - paragraph.getBoundingClientRect().y) * scale)
        const row = rows.find(row => row.y === y)
        if (row) row.text += character
        else rows.push({ y, text: character })
      }
      return rows.map(row => row.text)
    })
  })
  await expect.poll(layout).toEqual([['AAAABBBB', 'CCCC'], ['AAAA', 'BBBB', 'CCCC'], ['AAAA', 'BBBB', 'CCCC']])
  await expect(frame.locator('[data-fastppt-tab-error]')).toHaveCount(0)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await root.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const check = async () => {
    const snapshot = await capture(), slide = snapshot.slides[0]!, scale = 960 / slide.width
    expect(slide.warnings).toEqual([])
    const text = slide.elements.find(element => element.source.anchor === 'spacing')!
    if (text.kind !== 'text') throw new Error('Expected spacing frame')
    expect(text.paragraphs!.map(p => Number((p.style.letterSpacingPx * scale).toFixed(2)))).toEqual([2, 0, -2, 1.25, 2, -2, 2, 2, 2])
    const runs = text.paragraphs!.flatMap(p => p.runs)
    for (const [word, spacing] of [['Zero', 0], ['Negative', -1.2], ['Link', 0], ['\n', 2], ['中文', 2]] as const) expect(runs.find(run => run.text === word)!.style.letterSpacingPx * scale).toBeCloseTo(spacing, 2)
    expect(runs.find(run => run.text === 'Link')!.hyperlink).toBe('https://example.com/')
    expect(text.paragraphs![7]!.tabLayout!.text).toBe('A\tB')
    const ordinary = slide.elements.find(element => element.kind === 'text' && element.text === 'Ordinary中文')!
    if (ordinary.kind !== 'text') throw new Error('Expected ordinary mixed run')
    expect(ordinary.style.letterSpacingPx * scale).toBeCloseTo(1.25, 2)
    return snapshot
  }
  let snapshot = await check()
  await root.evaluate(element => { (element as HTMLElement).style.width = '1100px' })
  await expect(async () => { snapshot = await check() }).toPass()
  await expect.poll(layout).toEqual([['AAAABBBB', 'CCCC'], ['AAAA', 'BBBB', 'CCCC'], ['AAAA', 'BBBB', 'CCCC']])
  expect((await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })).qa.ok).toBe(true)
  await root.screenshot({ path: test.info().outputPath('source-letter-spacing.png') })
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('data-fastppt-level="2"', 'data-fastppt-level="3"').replace('BBBB</p>', 'Edited</p>') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited')
  await expect.poll(computedSpacing).toEqual([2, -2, -2, 1.25, 2, -2, 2, 2, 2])
  expect((await capture()).slides[0]!.warnings).toEqual([])
  await frame.locator('p').first().evaluate(element => { (element as HTMLElement).style.letterSpacing = '10000px' })
  const invalid = await capture()
  await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
})

test('preserves source baseline ratios without shrinking fonts or double-shifting native geometry', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-baseline\n---\n\n::ph-0::\n\n<div id="baseline" data-fastppt-text-box><p>Raised 中文</p><p data-fastppt-level="2">Normal</p><p data-fastppt-level="3">Lowered</p><p>A<span data-fastppt-baseline="0">Zero</span><strong data-fastppt-baseline="-25" data-fastppt-underline="true" style="letter-spacing:0.1cqw">Down</strong><a href="https://example.com/" data-fastppt-baseline="10" style="border:0;color:inherit">Link</a><span style="font-size:0.5em">Small</span></p><p data-fastppt-level="3"></p><p>Before<br data-fastppt-baseline="0">After</p><p data-fastppt-level="4">A&#9;<span data-fastppt-baseline="100">Raised</span><span data-fastppt-baseline="-100">Lowered</span></p><p data-fastppt-level="5">Bullet</p></div>\n\n::ph-1::\n\n<div id="baseline-wrap" data-fastppt-text-box><p>A&#9;AAAA BBBB CCCC<br>End</p></div>\n\n::ph-2::\n\n<p id="ordinary-baseline">Ordinary中文</p><p id="ordinary-zero" data-fastppt-baseline="0">Ordinary中文</p>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), root = preview.locator('.source-layout'), frame = preview.locator('#baseline')
  await expect(frame).toBeVisible()
  const geometry = () => frame.locator('p').evaluateAll(paragraphs => paragraphs.map(element => {
    const scale = 960 / parseFloat(getComputedStyle(element.closest('.source-layout')!).width)
    return { height: element.getBoundingClientRect().height * 960 / element.closest('.source-layout')!.getBoundingClientRect().width, baseline: Number(element.getAttribute('data-fastppt-text-baseline-defaults')), leaves: [...element.querySelectorAll<HTMLElement>('[data-fastppt-text-baseline-run]')].map(leaf => ({ text: leaf.textContent, size: parseFloat(getComputedStyle(leaf).fontSize) * scale, top: parseFloat(getComputedStyle(leaf).top) * scale })) }
  }))
  await expect.poll(async () => (await geometry()).map(p => p.baseline)).toEqual([30, 0, -25, 30, -25, 30, 30, 30])
  const measured = await geometry()
  const savedTops = await frame.locator('[data-fastppt-text-baseline-run]').evaluateAll(leaves => leaves.map(leaf => { const style = (leaf as HTMLElement).style, top = style.top; style.top = '0px'; return top }))
  expect((await geometry()).map(p => p.height)).toEqual(measured.map(p => p.height))
  await frame.locator('[data-fastppt-text-baseline-run]').evaluateAll((leaves, tops) => leaves.forEach((leaf, index) => { (leaf as HTMLElement).style.top = tops[index]! }), savedTops)
  expect(measured.map(p => p.baseline)).toEqual([30, 0, -25, 30, -25, 30, 30, 30])
  expect(measured[0]!.leaves[0]!.size).toBeCloseTo(20, 2)
  expect(measured[0]!.leaves[0]!.top).toBeCloseTo(-6, 2)
  expect(measured[2]!.leaves[0]!.top).toBeCloseTo(5, 2)
  expect(measured[3]!.leaves.find(leaf => leaf.text === 'Small')!.size).toBeCloseTo(10, 2)
  expect(measured[3]!.leaves.find(leaf => leaf.text === 'Small')!.top).toBeCloseTo(-3, 2)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await root.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const check = async () => {
    const snapshot = await capture(), slide = snapshot.slides[0]!
    expect(slide.warnings).toEqual([])
    const body = slide.elements.find(element => element.source.anchor === 'baseline')!
    if (body.kind !== 'text') throw new Error('Expected baseline frame')
    expect(body.paragraphs!.map(p => p.style.baselinePercent)).toEqual([30, 0, -25, 30, -25, 30, 30, 30])
    const runs = body.paragraphs!.flatMap(p => p.runs)
    for (const [text, baseline] of [['Zero', 0], ['Down', -25], ['Link', 10], ['Small', 30], ['\n', 0], ['中文', 30]] as const) expect(runs.find(run => run.text === text)!.style.baselinePercent).toBe(baseline)
    expect(runs.find(run => run.text === 'Link')!.hyperlink).toBe('https://example.com/')
    expect(runs.find(run => run.text === 'Down')!.style.decoration).toContain('underline')
    expect(runs.find(run => run.text === 'Down')!.style.letterSpacingPx * 960 / slide.width).toBeCloseTo(0.96, 2)
    expect(body.paragraphs![6]!.tabLayout!.lines).toHaveLength(1)
    const wrap = slide.elements.find(element => element.source.anchor === 'baseline-wrap')!
    if (wrap.kind !== 'text') throw new Error('Expected baseline wrap frame')
    expect(wrap.paragraphs![0]!.tabLayout!.lines.map(line => line.breakBefore)).toEqual(['paragraph', 'automatic', 'soft'])
    const ordinary = slide.elements.filter(element => element.source.anchor === 'ordinary-baseline')
    expect(ordinary).toHaveLength(1)
    expect(ordinary[0]!).toMatchObject({ kind: 'text', text: 'Ordinary中文', style: { baselinePercent: 30 } })
    const box = await preview.locator('#ordinary-baseline [data-fastppt-script-text]').evaluate(element => {
      const root = element.closest('.source-layout')!, scale = parseFloat(getComputedStyle(root).height) / root.getBoundingClientRect().height
      return (element.getBoundingClientRect().y - root.getBoundingClientRect().y) * scale
    })
    // fontSafeLineBox may pad line height but must not include a second baseline offset.
    const zero = slide.elements.find(element => element.source.anchor === 'ordinary-zero')!
    expect(ordinary[0]!.box.height).toBeCloseTo(zero.box.height, 2)
    expect(Math.abs(ordinary[0]!.box.y - box)).toBeLessThan(4)
    return snapshot
  }
  let snapshot = await check()
  const fixed = snapshot.slides[0]!.elements.find(element => element.source.anchor === 'baseline-footer')!
  expect(fixed).toMatchObject({ kind: 'text', style: { baselinePercent: -25 } })
  const fixedLeaf = root.locator('[data-fastppt-layout-object] [data-fastppt-text-baseline-run]')
  await fixedLeaf.evaluate(element => { (element as HTMLElement).style.top = '0em'; element.setAttribute('data-fastppt-text-baseline-run', '0') })
  const fixedZero = (await capture()).slides[0]!.elements.find(element => element.source.anchor === 'baseline-footer')!
  // Chromium snaps positioned inline boxes to subpixel layout units.
  expect(fixed.box.y).toBeCloseTo(fixedZero.box.y, 1)
  expect(fixed.box.height).toBeCloseTo(fixedZero.box.height, 2)
  await fixedLeaf.evaluate(element => { (element as HTMLElement).style.top = '0.25em'; element.setAttribute('data-fastppt-text-baseline-run', '-25') })
  await root.evaluate(element => { (element as HTMLElement).style.width = '1100px' })
  await expect(async () => { snapshot = await check() }).toPass()
  const exported = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(exported.qa.ok).toBe(true)
  expect(exported.warnings.some(warning => warning.code === 'text-baseline-compatibility')).toBe(true)
  await root.screenshot({ path: test.info().outputPath('source-baseline.png') })
  const leaf = frame.locator('[data-fastppt-text-baseline-run]').first(), originalStyle = await leaf.getAttribute('style')
  for (const change of ['top', 'size', 'left', 'transform', 'vertical-align', 'metadata']) {
    await leaf.evaluate((element, kind) => {
      const style = (element as HTMLElement).style
      if (kind === 'top') style.top = '0px'
      if (kind === 'size') style.fontSize = '10px'
      if (kind === 'left') style.left = '3px'
      if (kind === 'transform') style.transform = 'translateY(3px)'
      if (kind === 'vertical-align') style.verticalAlign = 'super'
      if (kind === 'metadata') element.setAttribute('data-fastppt-text-baseline-run', '"30"')
    }, change)
    // Changing the font size legitimately recomputes the relative percentage.
    const captured = await capture()
    if (change === 'size') expect(captured.slides[0]!.warnings).toEqual([])
    else {
      expect(captured.slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot')).toBe(true)
      await expect(writeEditablePptx(captured, downloadPath, { embedFonts: false })).rejects.toThrow()
    }
    await leaf.evaluate((element, style) => { element.setAttribute('style', style!); element.setAttribute('data-fastppt-text-baseline-run', '30') }, originalStyle)
  }
  const positioned = frame.locator('p').first()
  await positioned.evaluate(element => { (element as HTMLElement).style.position = 'absolute' })
  expect((await capture()).slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot')).toBe(true)
  await positioned.evaluate(element => { (element as HTMLElement).style.removeProperty('position') })
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('Raised 中文', 'Edited 中文').replace('data-fastppt-level="2"', 'data-fastppt-level="3"') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited')
  await expect.poll(async () => (await geometry())[1]!.baseline).toBe(-25)
  expect((await capture()).slides[0]!.warnings).toEqual([])
  const latest = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: latest.find(item => item.id === deck.id)!.revision, content: content.replace('data-fastppt-baseline="0"', 'data-fastppt-baseline="invalid"') } })).ok()).toBe(true)
  await expect(frame.locator('[data-fastppt-baseline="invalid"]')).toHaveCount(1)
  expect((await capture()).slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot')).toBe(true)
})

test('preserves kerning thresholds through font boundaries, resizing, editing and native capture', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-kerning\n---\n\n::ph-0::\n\n<div id="kerning" data-fastppt-text-box><p>AVATAR To WA</p><p data-fastppt-level="2">AVATAR To WA</p><p data-fastppt-level="3">AVATAR To WA</p><p data-fastppt-level="4">AVATAR To WA</p><p><span style="font-size:0.5em">Small</span><span data-fastppt-kerning-threshold="0" style="font-size:0.5em">Always</span><a href="https://example.com/" style="font-size:1.5em;border:0;color:inherit">Large</a></p><p data-fastppt-level="3"></p><p>Before<br data-fastppt-kerning-threshold="0">After</p><p data-fastppt-level="5">AVATAR&#9;To WA</p><p>Latin中文</p></div>\n\n::ph-1::\n\n<div id="kerning-wrap-on" data-fastppt-text-box><p>AVATAR To WA</p></div>\n\n::ph-2::\n\n<div id="kerning-wrap-off" data-fastppt-text-box><p>AVATAR To WA</p></div>\n\n::ph-3::\n\n<p id="ordinary-kerning">Ordinary中文</p>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), root = preview.locator('.source-layout'), frame = preview.locator('#kerning')
  await expect(frame).toBeVisible()
  const modes = () => frame.locator('[data-fastppt-text-kerning]').evaluateAll(elements => elements.filter(element => element.tagName === 'SPAN').map(element => ({ text: element.textContent, mode: getComputedStyle(element).fontKerning })))
  await expect.poll(modes).toEqual(expect.arrayContaining([{ text: 'Small', mode: 'none' }, { text: 'Always', mode: 'normal' }, { text: 'Large', mode: 'normal' }]))
  const measures = () => root.evaluate(element => {
    const scale = 960 / element.getBoundingClientRect().width
    const widths = [...element.querySelectorAll('#kerning > p')].slice(0, 4).map(p => p.querySelector('[data-fastppt-script-text]')!.getBoundingClientRect().width * scale)
    const rows = ['on', 'off'].map(mode => element.querySelector(`#kerning-wrap-${mode} p`)!.getBoundingClientRect().height * scale)
    return { widths, rows }
  })
  await expect.poll(async () => (await measures()).rows.map(Math.round)).toEqual([30, 60])
  const first = await measures()
  expect(first.widths[0]).toBeCloseTo(first.widths[1]!, 1)
  expect(first.widths[2]! - first.widths[0]!).toBeGreaterThan(12)
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async () => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await root.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const check = async () => {
    const snapshot = await capture(), slide = snapshot.slides[0]!, factor = 960 / slide.width
    expect(slide.warnings).toEqual([])
    const body = slide.elements.find(element => element.source.anchor === 'kerning')!
    if (body.kind !== 'text') throw new Error('Expected kerning frame')
    expect(body.paragraphs!.map(p => Math.round(p.style.kerningThresholdPx! * factor))).toEqual([20, 0, 21, 20, 20, 21, 20, 20, 20])
    const runs = body.paragraphs!.flatMap(p => p.runs)
    expect(runs.find(run => run.text === 'Small')!.style.kerningThresholdPx! * factor).toBeCloseTo(20, 2)
    expect(runs.find(run => run.text === 'Always')!.style.kerningThresholdPx).toBe(0)
    expect(runs.find(run => run.text === '\n')!.style.kerningThresholdPx).toBe(0)
    expect(runs.find(run => run.text === 'Large')!.hyperlink).toBe('https://example.com/')
    expect(body.paragraphs![7]!.tabLayout!.text).toBe('AVATAR\tTo WA')
    const ordinary = slide.elements.find(element => element.source.anchor === 'ordinary-kerning')!
    expect(ordinary).toMatchObject({ kind: 'text', text: 'Ordinary中文' })
    if (ordinary.kind !== 'text') throw new Error('Expected ordinary kerning')
    expect(ordinary.style.kerningThresholdPx! * factor).toBeCloseTo(30, 2)
    const fixed = slide.elements.find(element => element.source.anchor === 'kerning-footer')!
    if (fixed.kind !== 'text') throw new Error('Expected fixed kerning')
    expect(fixed.style.kerningThresholdPx! * factor).toBeCloseTo(30, 2)
    expect(fixed.metrics!.advancePx * factor).toBeGreaterThan(148)
    return snapshot
  }
  let snapshot = await check()
  await root.evaluate(element => { (element as HTMLElement).style.width = '1100px' })
  await expect(async () => { snapshot = await check() }).toPass()
  await expect.poll(async () => (await measures()).rows.map(Math.round)).toEqual([30, 60])
  const exported = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(exported.qa.ok).toBe(true)
  expect(exported.warnings.some(warning => warning.code === 'text-kerning-compatibility')).toBe(true)
  const fixedLeaf = root.locator('[data-fastppt-layout-object] [data-fastppt-text-kerning]')
  await expect(fixedLeaf).toHaveCSS('font-kerning', 'none')
  await fixedLeaf.evaluate(element => { (element as HTMLElement).style.fontSize = '4cqw' })
  await expect(fixedLeaf).toHaveCSS('font-kerning', 'normal')
  expect((await capture()).slides[0]!.warnings).toEqual([])
  await fixedLeaf.evaluate(element => { (element as HTMLElement).style.removeProperty('font-size') })
  await expect(fixedLeaf).toHaveCSS('font-kerning', 'none')
  await root.screenshot({ path: test.info().outputPath('source-kerning.png') })
  const leaf = frame.locator('p').first().locator('[data-fastppt-font-script]').first(), raw = await leaf.getAttribute('data-fastppt-text-kerning')
  // Feature tags can override font-kerning; capture must reject this conflict.
  await leaf.evaluate(element => { (element as HTMLElement).style.fontFeatureSettings = '"kern" 0' })
  const invalid = await capture()
  expect(invalid.slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot')).toBe(true)
  await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
  await leaf.evaluate(element => { (element as HTMLElement).style.removeProperty('font-feature-settings'); element.setAttribute('data-fastppt-text-kerning', '{"threshold":-1,"canvasWidth":12192000}') })
  expect((await capture()).slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot')).toBe(true)
  await leaf.evaluate((element, value) => element.setAttribute('data-fastppt-text-kerning', value!), raw)
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('data-fastppt-level="3"', 'data-fastppt-level="2"').replace('Small</span>', 'Edited</span>') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited')
  await expect.poll(async () => (await modes()).slice(0, 4).map(value => value.mode)).toEqual(['normal', 'normal', 'normal', 'none'])
  expect((await capture()).slides[0]!.warnings).toEqual([])
  await leaf.evaluate(element => { element.removeAttribute('data-fastppt-text-kerning'); (element as HTMLElement).style.fontKerning = 'none' })
  expect((await capture()).slides[0]!.warnings.some(warning => warning.message.includes('explicit threshold contract'))).toBe(true)
})

test('preserves original capitalization text through templates, Unicode expansion, tabs and native export', async ({ page, request }) => {
  const decks = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as Array<{ id: string; entryFile: string; revision: string }>
  const deck = decks.find(item => item.entryFile === 'slides.md')!
  const content = '---\ntheme: slidev-theme-academy\nlayout: source-capitalization\n---\n\n::ph-0::\n\n<div id="capitals" data-fastppt-text-box><p>Straße中文</p><p data-fastppt-level="2">Straße</p><p data-fastppt-level="3">Abc xyz</p><p data-fastppt-level="4">Abc xyz</p><p lang="tr-TR">i ı I İ <span data-fastppt-capitalization="none">i</span></p><p data-fastppt-level="3"></p><p>Before<br data-fastppt-capitalization="small">After</p><p data-fastppt-level="5">Straße&#9;xyz</p><p><a href="https://example.com/" style="border:0;color:inherit" data-fastppt-capitalization="small">Linked</a><span data-fastppt-baseline="20" style="letter-spacing:1px">Shift</span></p><p data-fastppt-level="6">Body</p></div>\n\n::ph-1::\n\n<div id="capitals-wrap" data-fastppt-text-box><p>Straße&#9;StraßeStraße</p></div>\n\n::ph-2::\n\n<p id="ordinary-capitals">Straße中文</p>\n'
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: deck.revision, content } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Preview deck').selectOption({ label: 'slides' })
  const preview = page.getByTitle('Slidev preview').contentFrame(), root = preview.locator('.source-layout'), frame = preview.locator('#capitals')
  await expect(frame).toBeVisible()
  const modes = () => frame.locator('p').evaluateAll(elements => elements.slice(0, 4).map(element => {
    const leaf = element.querySelector<HTMLElement>('[data-fastppt-text-capitalization-run]')!, css = getComputedStyle(leaf)
    return { original: element.textContent, displayed: (element as HTMLElement).innerText, transform: css.textTransform, variant: css.fontVariantCaps }
  }))
  await expect.poll(modes).toEqual([
    { original: 'Straße中文', displayed: 'STRASSE中文', transform: 'uppercase', variant: 'normal' },
    { original: 'Straße', displayed: 'Straße', transform: 'none', variant: 'normal' },
    { original: 'Abc xyz', displayed: 'Abc xyz', transform: 'none', variant: 'small-caps' },
    { original: 'Abc xyz', displayed: 'Abc xyz', transform: 'none', variant: 'small-caps' },
  ])
  await expect(frame.locator('[data-fastppt-bullet-label]')).toHaveText('a')
  await expect(frame.locator('p').nth(4)).toHaveJSProperty('innerText', 'İ I I İ i')
  const smallLeaf = frame.locator('p').nth(2).locator('[data-fastppt-text-capitalization-run]').first()
  const capturePath = `http://127.0.0.1:4328/@fs${fileURLToPath(new URL('../../../packages/slidewave/src/slidev/capture.ts', import.meta.url))}`
  const capture = async (target: Locator = root) => HtmlDeckSnapshotSchema.parse({ version: 1, source: 'slidev', warnings: [], slides: [await target.evaluate(async (element, path) => {
    const { captureHtmlSlide } = await import(path) as { captureHtmlSlide: (root: HTMLElement) => Promise<unknown> }
    return captureHtmlSlide(element as HTMLElement)
  }, capturePath)] })
  const check = async () => {
    const snapshot = await capture(), slide = snapshot.slides[0]!
    expect(slide.warnings).toEqual([])
    const body = slide.elements.find(element => element.source.anchor === 'capitals')!
    if (body.kind !== 'text') throw new Error('Expected capitalization frame')
    expect(body.paragraphs!.map(p => p.style.capitalization)).toEqual(['all', 'none', 'small', 'small', 'all', 'small', 'all', 'all', 'all', 'all'])
    expect(body.paragraphs![0]!.runs.map(run => run.text).join('')).toBe('Straße中文')
    const runs = body.paragraphs!.flatMap(p => p.runs)
    expect(runs.find(run => run.text === '\n')!.style.capitalization).toBe('small')
    expect(runs.find(run => run.text === 'Linked')).toMatchObject({ hyperlink: 'https://example.com/', style: { capitalization: 'small' } })
    expect(runs.find(run => run.text === 'Shift')!.style.baselinePercent).toBe(20)
    expect(body.paragraphs![7]!.tabLayout!.text).toBe('Straße\txyz')
    const wrapped = slide.elements.find(element => element.source.anchor === 'capitals-wrap')!
    if (wrapped.kind !== 'text') throw new Error('Expected wrapped capitalization frame')
    expect(wrapped.text).toBe('Straße\tStraßeStraße')
    expect(wrapped.paragraphs![0]!.tabLayout!.lines.some(line => line.breakBefore === 'automatic')).toBe(true)
    expect(slide.elements.filter(element => element.source.anchor === 'ordinary-capitals')).toHaveLength(1)
    expect(slide.elements.find(element => element.source.anchor === 'ordinary-capitals')).toMatchObject({ text: 'Straße中文', style: { capitalization: 'all' } })
    const fixed = slide.elements.find(element => element.source.anchor === 'caps-footer')!
    expect(fixed).toMatchObject({ text: 'Straße', style: { capitalization: 'all' } })
    if (fixed.kind !== 'text') throw new Error('Expected fixed capitalization')
    expect(fixed.metrics!.advancePx * 960 / slide.width).toBeGreaterThan(80)
    return snapshot
  }
  let snapshot = await check()
  await root.evaluate(element => { (element as HTMLElement).style.width = '1100px' })
  await expect(async () => { snapshot = await check() }).toPass()
  const result = await writeEditablePptx(snapshot, downloadPath, { embedFonts: false })
  expect(result.qa.ok).toBe(true)
  expect(result.warnings.some(warning => warning.code === 'text-capitalization-compatibility')).toBe(true)
  await root.screenshot({ path: test.info().outputPath('source-capitalization.png') })
  await smallLeaf.evaluate(element => { (element as HTMLElement).style.fontSynthesis = 'none' })
  expect((await capture()).slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot')).toBe(true)
  await smallLeaf.evaluate(element => { (element as HTMLElement).style.removeProperty('font-synthesis') })
  const firstParagraph = frame.locator('p').first(), savedParagraph = await firstParagraph.innerHTML()
  await firstParagraph.evaluate(element => { element.textContent = 'Straße' })
  expect((await capture()).slides[0]!.warnings.some(warning => warning.message.includes('projected text leaves'))).toBe(true)
  await firstParagraph.evaluate((element, html) => { element.innerHTML = html }, savedParagraph)
  const leaf = frame.locator('p').first().locator('[data-fastppt-text-capitalization-run]').first(), original = await leaf.getAttribute('style')
  for (const mutation of ['css', 'feature', 'invalid', 'missing']) {
    await leaf.evaluate((element, kind) => {
      if (kind === 'css') (element as HTMLElement).style.textTransform = 'lowercase'
      if (kind === 'feature') (element as HTMLElement).style.fontFeatureSettings = '"smcp" 0'
      if (kind === 'invalid') element.setAttribute('data-fastppt-text-capitalization-run', '"uppercase"')
      if (kind === 'missing') element.removeAttribute('data-fastppt-text-capitalization-run')
    }, mutation)
    const invalid = await capture()
    expect(invalid.slides[0]!.warnings.some(warning => warning.code === 'invalid-snapshot'), mutation).toBe(true)
    await expect(writeEditablePptx(invalid, downloadPath, { embedFonts: false })).rejects.toThrow()
    await leaf.evaluate((element, style) => { element.setAttribute('style', style!); element.setAttribute('data-fastppt-text-capitalization-run', '"all"') }, original)
  }
  const current = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: current.find(item => item.id === deck.id)!.revision, content: content.replace('data-fastppt-level="3">Abc xyz', 'data-fastppt-capitalization="none">Edited Straße') } })).ok()).toBe(true)
  await expect(frame).toContainText('Edited Straße')
  expect((await capture()).slides[0]!.warnings).toEqual([])
  const latest = await (await request.get('http://127.0.0.1:4317/api/v1/decks')).json() as typeof decks
  expect((await request.put(`http://127.0.0.1:4317/api/v1/decks/${deck.id}/markdown`, { data: { expectedRevision: latest.find(item => item.id === deck.id)!.revision, content: '---\ntheme: slidev-theme-academy\nlayout: mcp-capitalization\n---\n' } })).ok()).toBe(true)
  const mcp = preview.locator('.fastppt-layout-mcp-capitalization'), fixed = mcp.locator('[data-fastppt-layout-object="MCP Capitals"] > span')
  await expect(fixed).toHaveCSS('font-variant-caps', 'small-caps')
  const mcpSnapshot = await capture(mcp)
  expect(mcpSnapshot.slides[0]!.warnings).toEqual([])
  expect(mcpSnapshot.slides[0]!.elements).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'text', text: 'Straße', style: expect.objectContaining({ capitalization: 'small' }) })]))
})
