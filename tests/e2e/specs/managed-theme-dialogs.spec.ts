import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ThemeSummary } from '@fastppt/protocol'

const themes: ThemeSummary[] = ['Academy', 'Landing'].map(name => ({
  themeId: `slidev-theme-${name.toLowerCase()}`,
  packageName: `slidev-theme-${name.toLowerCase()}`,
  displayName: name,
  version: '0.1.0',
  description: `${name} theme description`,
  repositoryUrl: 'https://github.com/FastR-D/FastPPT',
  skillId: `fastppt-theme-${name.toLowerCase()}`,
  skillVersion: '0.1.0',
  layouts: [{ id: 'cover', label: '学术封面' }],
  supportedFeatures: [{ id: 'citations', label: '引用', description: '保留学术引用' }],
  registryVersion: 'ui-v1',
  available: true,
}))

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/themes', route => route.fulfill({ json: themes }))
  await page.route('**/api/v1/themes/*/skill', route => {
    const theme = themes.find(theme => route.request().url().includes(theme.themeId))!
    return route.fulfill({ json: { themeId: theme.themeId, skillId: theme.skillId, version: theme.skillVersion, fileName: 'SKILL.md', content: `# ${theme.displayName} skill source` } })
  })
  await page.route('**/api/v1/managed/status', route => route.fulfill({ json: {
    registryVersion: 'ui-v1',
    skills: [
      { harness: 'claude', skillId: 'fastppt-base', kind: 'base', expectedVersion: '0.1.0', state: 'installed', targetPath: '/fixture/base', managed: true },
      { harness: 'claude', skillId: 'fastppt-theme-academy', kind: 'theme', themeId: 'slidev-theme-academy', expectedVersion: '0.1.0', state: 'missing', targetPath: '/fixture/theme', managed: true, message: 'Theme installation required' },
    ],
    mcp: [{ harness: 'claude', state: 'pending-trust', configPath: '/fixture/mcp', managed: true, message: 'Confirm MCP trust' }],
  } }))
})

async function expectNativeFocus(page: Page, dialog: Locator, background: Locator) {
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate(element => element instanceof HTMLDialogElement && element.matches(':modal'))).toBe(true)
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await background.evaluate(element => (element as HTMLElement).focus())
  await expect(background).not.toBeFocused()
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await dialog.getByRole('heading').first().click()
  await expect(dialog).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
}

for (const kind of ['status', 'details', 'skill'] as const) {
  test(`owns native focus, inertness and every close path for ${kind}`, async ({ page }) => {
    await page.goto('/')
    if (kind !== 'status') await page.getByRole('tab', { name: '主题', exact: true }).click()
    const trigger = kind === 'status'
      ? page.getByRole('button', { name: '查看 Skill 与 MCP 安装状态', exact: true })
      : page.getByRole('button', { name: kind === 'details' ? '查看 Academy 详细功能' : '查看 fastppt-theme-academy 文件', exact: true })
    const dialog = page.getByRole('dialog', { name: kind === 'status' ? 'Skill 与 MCP 安装状态' : kind === 'details' ? 'Academy' : 'fastppt-theme-academy', exact: true })
    for (const action of ['escape', 'backdrop', 'button']) {
      await trigger.click()
      await expectNativeFocus(page, dialog, trigger)
      if (kind === 'status') {
        await expect(dialog).toContainText('1/2 个 Skill 已安装')
        await expect(dialog).toContainText('Theme installation required')
        await expect(dialog).toContainText('Confirm MCP trust')
      } else if (kind === 'details') {
        await expect(dialog).toContainText('保留学术引用')
        await expect(dialog).toContainText('学术封面')
      } else await expect(dialog).toContainText('# Academy skill source')
      if (action === 'escape') await page.keyboard.press('Escape')
      else if (action === 'button') await dialog.getByRole('button', { name: kind === 'status' ? '关闭' : '关闭弹窗', exact: true }).click()
      else {
        const box = (await dialog.boundingBox())!
        await page.mouse.move(box.x - 8, box.y + box.height / 2)
        await page.mouse.down()
        await expect(dialog).toBeVisible()
        await page.mouse.up()
      }
      await expect(dialog).toBeHidden()
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      await expect(trigger).toBeFocused()
    }
  })
}

test('keeps a dismissed Skill request closed and preserves loading, error and source states', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let attempts = 0
  await page.route('**/api/v1/themes/slidev-theme-academy/skill', async route => {
    attempts++
    if (attempts === 1) await held
    if (attempts === 2) await route.fulfill({ status: 503, json: { error: { code: 'SKILL_READ', message: 'Skill source unavailable', retryable: false, requestId: 'ui-v1' } } })
    else await route.fulfill({ json: { themeId: themes[0]!.themeId, skillId: themes[0]!.skillId, version: '0.1.0', fileName: 'SKILL.md', content: '# Fresh Academy source' } })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: '主题', exact: true }).click()
  const trigger = page.getByRole('button', { name: '查看 fastppt-theme-academy 文件', exact: true })
  const dialog = page.getByRole('dialog', { name: 'fastppt-theme-academy', exact: true })
  await trigger.click()
  await expect(dialog).toContainText('正在读取 SKILL.md')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const delivered = page.waitForResponse(response => response.url().endsWith('/slidev-theme-academy/skill'))
  release()
  await delivered
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(dialog).toContainText('Skill source unavailable')
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await trigger.click()
  await expect(dialog).toContainText('# Fresh Academy source')
  await expect(dialog).not.toContainText('Skill source unavailable')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
