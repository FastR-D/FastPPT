import { expect, test } from '@playwright/test'
import type { DeckNotesDocument } from '@fastppt/protocol'

test('links the notes outline, editor and preview without losing drafts on page changes or failed saves', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const notes: DeckNotesDocument = {
    version: 1,
    notes: [2, 3].map(page => ({
      version: 1, slideId: `qa-slide-${page}`, spokenText: `Page ${page} notes`,
      format: 'plain', language: 'zh-CN', estimatedSeconds: 0, cues: [], status: 'draft',
    })),
  }
  let pageCount = 0
  let saved: DeckNotesDocument | undefined
  let failSave = true
  await page.route('**/api/v1/decks/*/identities', route => route.fulfill({ json: {
    deckId: route.request().url().split('/').at(-2), revision: 'notes-qa',
    slides: Array.from({ length: pageCount }, (_, index) => ({ slideId: `qa-slide-${index + 1}`, anchors: [] })),
  } }))
  await page.route('**/api/v1/decks/*/notes', async route => {
    if (route.request().method() === 'PUT') {
      if (failSave) {
        failSave = false
        await route.fulfill({ status: 503, json: { error: { code: 'NOTES_QA', message: '保存失败，请重试', retryable: true, requestId: 'notes-qa' } } })
        return
      }
      saved = route.request().postDataJSON() as DeckNotesDocument
      await route.fulfill({ json: saved })
      return
    }
    await route.fulfill({ json: notes })
  })
  await page.goto('/')
  await expect.poll(async () => Number((await page.locator('.status-pages').innerText()).match(/\/ (\d+) 页/)?.[1])).toBeGreaterThanOrEqual(3)
  pageCount = Number((await page.locator('.status-pages').innerText()).match(/\/ (\d+) 页/)?.[1])
  expect(pageCount).toBeGreaterThanOrEqual(3)
  await page.getByRole('tab', { name: '备注', exact: true }).click()
  const outline = page.getByRole('complementary', { name: '页面大纲' })
  const editor = page.getByRole('textbox', { name: '当前页备注' })
  const panel = page.locator('.notes-panel')
  await expect(editor).toBeEnabled()
  const columns = await Promise.all([outline, panel, page.locator('.preview-panel')].map(locator => locator.boundingBox()))
  expect(columns.every(Boolean)).toBe(true)
  expect(columns[0]!.x + columns[0]!.width).toBeLessThanOrEqual(columns[1]!.x)
  expect(columns[1]!.x + columns[1]!.width).toBeLessThanOrEqual(columns[2]!.x)
  const selectPage = async (number: number) => {
    await outline.locator('.slide-item').nth(number - 1).click()
    await expect(outline.locator('[aria-current="page"]')).toHaveText(new RegExp(`^${number}`))
    await expect(page.getByRole('spinbutton', { name: '跳转到页码' })).toHaveValue(String(number))
  }
  await selectPage(2)
  await expect(editor).toHaveValue('Page 2 notes')
  await editor.fill('Second page draft')
  await panel.getByRole('button', { name: '添加 cue' }).click()
  await panel.getByLabel('cue 文本').fill('Keep this cue')
  await selectPage(3)
  await expect(editor).toHaveValue('Page 3 notes')
  await editor.fill('Third page draft')
  await panel.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(editor).toHaveValue('Second page draft')
  await expect(panel.getByLabel('cue 文本')).toHaveValue('Keep this cue')
  await panel.getByRole('button', { name: '保存备注' }).click()
  await expect(panel.getByRole('alert')).toHaveText('保存失败，请重试')
  await expect(editor).toHaveValue('Second page draft')
  await panel.getByRole('button', { name: '保存备注' }).click()
  await expect(panel.getByText('备注已保存', { exact: true })).toBeVisible()
  expect(saved?.notes.find(note => note.slideId === 'qa-slide-2')).toMatchObject({ spokenText: 'Second page draft', cues: [{ text: 'Keep this cue' }] })
  expect(saved?.notes.find(note => note.slideId === 'qa-slide-3')?.spokenText).toBe('Page 3 notes')
  await page.getByRole('spinbutton', { name: '跳转到页码' }).fill('3')
  await page.getByRole('spinbutton', { name: '跳转到页码' }).press('Enter')
  await expect(editor).toHaveValue('Third page draft')
  await expect(outline.locator('[aria-current="page"]')).toHaveText(/^3/)
  await page.locator('.preview-panel').getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.frameLocator('.preview-stage iframe').locator('[data-slidev-no="3"]')).toBeVisible()
  await expect(editor).toHaveValue('Third page draft')
  await selectPage(pageCount)
  await expect(panel.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('uses a shared SVG icon and equally compact preview controls without a black surround', async ({ page }) => {
  await page.goto('/')
  const preview = page.locator('.preview-panel')
  const frame = page.frameLocator('.preview-stage iframe')
  await expect(frame.locator('#slide-content')).toBeVisible()
  await expect.poll(() => frame.locator('#slide-container').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  const controls = preview.locator('.preview-identity select, .page-indicator input, .preview-actions > button, .preview-more > summary')
  const heights = await controls.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
  expect(heights.length).toBeGreaterThanOrEqual(6)
  heights.forEach(height => expect(height).toBe(24))
  const selection = preview.getByRole('button', { name: '框选修改', exact: true })
  await expect(selection).toBeEnabled()
  await expect.poll(async () => (await selection.evaluate(element => getComputedStyle(element).backgroundColor)) === (await preview.getByRole('button', { name: '导出 PPTX', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor))).toBe(true)
  const logo = page.locator('.brand-mark')
  await expect(logo).toHaveAttribute('src', /^(data:image\/svg\+xml|.*fastppt-icon.*\.svg)/)
  expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe(await logo.getAttribute('src'))
})

test('keeps the editor file tree above the page outline and shares page selection with the preview', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: '编辑导航', exact: true })
  const files = sidebar.getByRole('complementary', { name: '文件树', exact: true })
  const outline = sidebar.getByRole('complementary', { name: '页面大纲', exact: true })
  await expect(files).toBeVisible()
  await expect(outline).toBeVisible()
  const filesBounds = (await files.boundingBox())!
  const outlineBounds = (await outline.boundingBox())!
  expect(filesBounds.y + filesBounds.height).toBeLessThanOrEqual(outlineBounds.y)
  await outline.locator('.slide-item').nth(2).click()
  await expect(page.getByRole('spinbutton', { name: '跳转到页码' })).toHaveValue('3')
  await expect(page.frameLocator('.preview-stage iframe').locator('[data-slidev-no="3"]')).toBeVisible()
})

test('turns pages with the wheel over the outline and the unused preview area', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  const outline = page.getByRole('complementary', { name: '页面大纲', exact: true })
  await outline.locator('.slide-item').nth(2).click()
  const pageInput = page.getByRole('spinbutton', { name: '跳转到页码' })
  await expect(pageInput).toHaveValue('3')
  await expect(page.frameLocator('.preview-stage iframe').locator('[data-slidev-no="3"]')).toBeVisible()
  const outlineBounds = (await outline.boundingBox())!
  await page.mouse.move(outlineBounds.x + 30, outlineBounds.y + 55)
  await page.mouse.wheel(0, 120)
  await expect(pageInput).toHaveValue('4')
  await expect(outline.locator('[aria-current="page"]')).toHaveText(/^4/)
  const canvasBounds = (await page.locator('.preview-canvas').boundingBox())!
  await page.mouse.move(canvasBounds.x + 5, canvasBounds.y + 5)
  await page.mouse.wheel(0, -120)
  await expect(pageInput).toHaveValue('3')
  await expect(outline.locator('[aria-current="page"]')).toHaveText(/^3/)
})

test('removes only the diagram tab while preserving the editor through commands', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tab')).toHaveText(['对话', '编辑', '版式', '画盘', '动画', '备注', '主题'])
  await expect(page.getByRole('tab', { name: '图表', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '打开命令面板', exact: true }).click()
  await page.getByRole('dialog', { name: '命令面板' }).getByRole('button', { name: /^打开图表/ }).click()
  await expect(page.getByRole('heading', { name: '图表编辑', exact: true })).toBeVisible()
  await expect(page.getByRole('tab').first()).toHaveAttribute('tabindex', '0')
  await page.keyboard.press('Alt+7')
  await expect(page.getByRole('tab', { name: '主题', exact: true })).toHaveAttribute('aria-selected', 'true')
})
