import { rm } from 'node:fs/promises'

import { expect, test, type Locator } from '@playwright/test'

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
  await expect(page.getByText('第 1 页')).toBeVisible()
  const previewFrame = page.getByTitle('Slidev preview').contentFrame()
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
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt')
    await dialog.accept('Renamed Claude history')
  })
  await page.getByRole('button', { name: '重命名当前会话' }).click()
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

  async function audit(runId: string, themeSkillId: string): Promise<void> {
    await expect
      .poll(async () => {
        return gatewayJson(`/api/v1/runs/${runId}/audit`)
      })
      .toMatchObject({
        themeSkillId,
        skillResolutionStatus: 'resolved',
        status: 'completed',
        invocationStatus: 'unknown',
      })
    const auditCard = page.getByText('本次运行 Skill 审计').locator('..')
    await expect(auditCard).toContainText(themeSkillId)
    await expect(auditCard).toContainText('resolved')
    await expect(auditCard).toContainText('unknown')
  }

  async function pickOption(picker: Locator, label: string): Promise<void> {
    await picker.click()
    await page.getByRole('option', { name: label, exact: true }).click()
  }

  async function sendRun(
    harness: 'claude' | 'codex',
    runNumber: number,
    deckName: 'slides' | 'landing',
    themeSkillId: string,
    switchDuringRun = false,
    reloadBeforeApproval = false,
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
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()
    await expect(
      page.getByText(`Streaming ${themeSkillId}`, { exact: true }),
    ).toBeVisible()
    if (switchDuringRun) {
      await pickOption(deckPicker, 'landing')
      await expect(deckPicker).toHaveText('landing')
    }
    if (reloadBeforeApproval) {
      await expect
        .poll(async () => {
          const state = (await gatewayJson('/api/v1/application-state')) as {
            recentSession?: { harness: string; sessionId: string }
            pendingApprovals?: unknown[]
          }
          return {
            harness: state.recentSession?.harness,
            pendingApprovals: state.pendingApprovals?.length,
          }
        })
        .toEqual({ harness, pendingApprovals: 1 })
      await page.reload()
      await expect(harnessPicker).toHaveText(
        harness === 'claude' ? 'Claude' : 'Codex',
      )
      await expect(deckPicker).toHaveText(deckName)
      await expect(composer).toBeEnabled()
    }
    const approval = page.getByRole('button', { name: '允许一次' }).first()
    const approvalCard = approval.locator('xpath=ancestor::article')
    await expect(approvalCard).toContainText(harness)
    await expect(approvalCard).toContainText(workspace)
    await expect(approvalCard).toContainText('slides.md')
    await approval.click()
    await audit(`${harness}-run-${runNumber}`, themeSkillId)
    await expect(sendButton).toBeVisible()
  }

  for (const harness of ['claude', 'codex'] as const) {
    await pickOption(harnessPicker, harness === 'claude' ? 'Claude' : 'Codex')
    await createSession.click()
    await expect(composer).toBeEnabled()
    await sendRun(
      harness,
      1,
      'slides',
      'fastppt-theme-academy',
      harness === 'claude',
      harness === 'codex',
    )
    await sendRun(harness, 2, 'landing', 'fastppt-theme-landing')
  }

  for (const harness of ['claude', 'codex'] as const) {
    await pickOption(harnessPicker, harness === 'claude' ? 'Claude' : 'Codex')
    await expect(composer).toBeEnabled()
    await sendRun(harness, 3, 'slides', 'fastppt-theme-academy')
  }

  await pickOption(deckPicker, 'slides')
  await page.getByRole('tab', { name: /文件/ }).click()
  await page.locator('.tree-row').filter({ hasText: 'slides.md' }).click()
  const markdown =
    '---\ntheme: slidev-theme-academy\ntitle: E2E Edited\n---\n\n# E2E Edited\n\n---\n\n# E2E Edited second slide\n'
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

  await pickOption(deckPicker, 'slides')
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
  const downloadButton = page.getByRole('button', { name: '下载 PPTX' })
  await expect(downloadButton).toBeVisible()
  await expect(page.locator('.export-status')).toContainText('2 页')
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('slides.pptx')
  await download.saveAs(downloadPath)
  expect(wakeLockFailures).toEqual([])

  await rm(`${workspace}/.claude/skills/fastppt-theme-academy`, {
    recursive: true,
    force: true,
  })
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.getByRole('tab', { name: '对话' }).click()
  await pickOption(harnessPicker, 'Claude')
  await pickOption(deckPicker, 'slides')
  await expect(
    page.getByText('missing', { exact: false }).first(),
  ).toBeVisible()
  await page.getByRole('tab', { name: '对话' }).click()
  await composer.fill('This must not enter the Harness')
  await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()
  await expect(page.getByText('发送已禁用', { exact: false })).toBeVisible()
})
