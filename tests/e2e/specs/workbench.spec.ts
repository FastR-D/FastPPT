import { expect, test, type Page } from '@playwright/test'

async function expectContained(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  for (const selector of [
    '.app-header',
    '.workspace-activity',
    '.workspace-status',
  ]) {
    const box = await page.locator(selector).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    )
  }
}

test('searches workspace commands, navigates with the keyboard and restores focus', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '打开命令面板' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '命令面板' })
  const search = dialog.getByRole('textbox', { name: '搜索命令' })
  await expect(search).toBeFocused()
  await search.fill('不存在的命令')
  await expect(dialog.getByText('没有匹配的命令')).toBeVisible()
  await search.fill('notes')
  await expect(dialog.locator('[data-command]')).toHaveCount(1)
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: '讲稿备注' })).toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await page.getByRole('tab', { name: '对话', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('tab', { name: '编辑', exact: true }),
  ).toBeFocused()
  await expect(
    page.getByRole('tab', { name: '编辑', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  expect(errors).toEqual([])
})

for (const width of [1440, 768, 390]) {
  test(`keeps workspace tools and panels contained at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('tab')).toHaveCount(7)
    await expectContained(page)
    if (width <= 1100) {
      await page.getByRole('button', { name: '预览', exact: true }).click()
      await expect(page.locator('.workspace-preview')).toBeVisible()
      await expect(page.locator('.workbench')).toBeHidden()
      await expect(
        page.getByRole('button', { name: '导出 PPTX', exact: true }),
      ).toBeVisible()
      await page.locator('.preview-more > summary').click()
      const menu = await page.locator('.preview-more-menu').boundingBox()
      expect(menu!.x).toBeGreaterThanOrEqual(0)
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width)
      await page.keyboard.press('Escape')
      await expect(page.locator('.preview-more-menu')).toBeHidden()
      await expectContained(page)
    }
    const previewGeometry = await page
      .locator('.preview-header')
      .evaluate((element) => {
        const picker = element
          .querySelector('.preview-identity')!
          .getBoundingClientRect()
        const controls = [
          ...element.querySelector('.preview-actions')!.children,
        ]
          .map((control) => control.getBoundingClientRect())
          .filter((rect) => rect.width > 0)
        let overlaps = 0
        for (let a = 0; a < controls.length; a++)
          for (let b = a + 1; b < controls.length; b++) {
            const first = controls[a]!,
              second = controls[b]!
            if (
              Math.min(first.right, second.right) -
                Math.max(first.left, second.left) >
                1 &&
              Math.min(first.bottom, second.bottom) -
                Math.max(first.top, second.top) >
                1
            )
              overlaps++
          }
        return {
          pickerBottom: picker.bottom,
          toolbarTop: Math.min(...controls.map((rect) => rect.top)),
          overlaps,
        }
      })
    expect(previewGeometry.pickerBottom).toBeLessThanOrEqual(
      previewGeometry.toolbarTop,
    )
    expect(previewGeometry.overlaps).toBe(0)
    await page.getByRole('tab', { name: '主题', exact: true }).click()
    await expect(page.getByRole('heading', { name: '可用主题' })).toBeVisible()
    await expectContained(page)
    await page.getByRole('button', { name: '打开命令面板', exact: true }).click()
    await page.getByRole('dialog', { name: '命令面板' }).getByRole('button', { name: /^打开图表/ }).click()
    await expect(page.getByRole('heading', { name: '图表编辑' })).toBeVisible()
    await expectContained(page)
    const diagram = await page.locator('.diagram-grid').boundingBox()
    if (diagram) expect(diagram.x + diagram.width).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const wizard = page.getByRole('dialog', { name: '创建向导' })
    await expect(wizard).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(wizard).toBeHidden()
  })
}

test('constrains saved panel widths, persists keyboard resizing and collapses navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() =>
    localStorage.setItem(
      'fastppt.workspace-layout.v1',
      '{"sidebar":9000,"preview":9000}',
    ),
  )
  await page.goto('/')
  await expectContained(page)
  const editorBox = await page.locator('.workspace-agent').boundingBox()
  expect(editorBox!.width).toBeGreaterThanOrEqual(320)
  await page
    .getByRole('separator', { name: '调整导航区域宽度' })
    .press('ArrowLeft')
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('fastppt.workspace-layout.v1')!) as {
        sidebar: number
        preview: number
      },
  )
  expect(saved.sidebar).toBeLessThan(9000)
  expect(saved.preview).toBeLessThan(9000)
  await page.getByRole('button', { name: '切换导航面板' }).click()
  await expect(page.locator('.workspace-sidebar')).toBeHidden()
  await page.getByRole('button', { name: '切换导航面板' }).click()
  await expect(page.locator('.workspace-sidebar')).toBeVisible()
})

test('keeps session configuration keyboard focus inside the dialog', async ({
  page,
}) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '新建会话', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '新建演示文稿会话' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  // Native dialogs may focus the dialog surface at the traversal boundary.
  await expect(trigger).not.toBeFocused()
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: '创建向导' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('keeps deck selector arrow keys native instead of turning preview pages', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Preview deck', exact: true })
  await expect(picker).toBeEnabled()
  await picker.selectOption({ index: 0 })
  const first = await picker.inputValue()
  await picker.evaluate(element => {
    element.addEventListener('keydown', event => {
      element.setAttribute('data-key-prevented', String(event.defaultPrevented))
    })
  })
  await picker.press('ArrowRight')
  await expect(picker).not.toHaveValue(first)
  await expect(picker).toHaveAttribute('data-key-prevented', 'false')
  await expect(picker).toBeFocused()
  const heights = await page.locator('.preview-identity select, .page-indicator input, .preview-actions > button, .preview-more > summary')
    .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
  expect(heights.length).toBeGreaterThanOrEqual(6)
  heights.forEach(height => expect(height).toBe(24))
})

test('uses the shared button and field styles throughout the creation wizard', async ({
  page,
}) => {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (/Failed to resolve component/.test(message.text()))
      warnings.push(message.text())
  })
  await page.goto('/')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  const wizard = page.getByRole('dialog', { name: '创建向导' })
  const next = wizard.getByRole('button', { name: '保存并继续', exact: true })
  await expect(next).toBeEnabled()
  await expect(next).toHaveCSS('background-color', 'rgb(21, 95, 184)')
  await wizard.getByLabel('推荐选项').selectOption('从零创建')
  await wizard.getByLabel('本步备注').fill('组件库表单验证')
  await wizard.getByLabel('锁定本步决策').check()
  await next.click()
  await expect(wizard.getByLabel('推荐选项')).toHaveValue('')
  await wizard.getByRole('button', { name: '上一步', exact: true }).click()
  await expect(wizard.getByLabel('本步备注')).toHaveValue('组件库表单验证')
  await expect(wizard.getByLabel('锁定本步决策')).toBeChecked()
  await expect(wizard.getByLabel('推荐选项')).toBeDisabled()
  expect(warnings).toEqual([])
})

test('switches color modes and restores the saved choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'light')
  await page.getByRole('button', { name: '切换到深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await expect(
    page.getByRole('button', { name: '切换到浅色模式' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await page.getByRole('button', { name: '切换到浅色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'light')
  expect(
    await page.evaluate(() => localStorage.getItem('fastppt.color-mode')),
  ).toBe('light')
})

test('follows the system color scheme until the user selects a mode', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'light')
  await page.getByRole('button', { name: '切换到深色模式' }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
})

test('keeps the unsaved editor draft when changing color modes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.locator('.tree-row').filter({ hasText: 'slides.md' }).click()
  const content = page.locator('.cm-content')
  await content.fill('# Theme switch keeps this draft')
  await page.getByRole('button', { name: '切换到深色模式' }).click()
  await expect(content).toHaveText('# Theme switch keeps this draft')
  await expect(page.locator('.cm-editor')).toHaveCSS(
    'background-color',
    'rgb(23, 30, 39)',
  )
  await expect(page.getByText('未保存', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换到浅色模式' }).click()
  await expect(content).toHaveText('# Theme switch keeps this draft')
  await expect(page.locator('.cm-editor')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
})
