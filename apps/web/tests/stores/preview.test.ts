import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  SlidevProcessState,
  DeckValidationResult,
} from '@fastppt/protocol'

import {
  resolvePreferredThemeId,
  usePreviewStore,
} from '../../src/stores/preview.js'

const client = vi.hoisted(() => ({
  previewAction: vi.fn(),
  validateDeck: vi.fn(),
}))
vi.mock('../../src/api/useGatewayClient.js', () => ({
  useGatewayClient: () => client,
}))
vi.mock('../../src/api/useEventStream.js', () => ({
  useEventStream: () => ({
    status: undefined,
    setTopics: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  client.previewAction.mockReset().mockImplementation((deckId: string) =>
    Promise.resolve({
      deckId,
      status: 'ready',
      previewUrl: `http://localhost/${deckId}`,
    }),
  )
  client.validateDeck.mockReset().mockImplementation((deckId: string) =>
    Promise.resolve({
      deckId,
      revision: 'r',
      valid: true,
      themeRuleDigest: null,
      themeRuleIssues: [],
      errors: [],
    }),
  )
})

it('keeps the selected preview when an earlier deck startup completes late', async () => {
  let resolveOld!: (value: SlidevProcessState) => void
  client.previewAction.mockImplementationOnce(
    () =>
      new Promise<SlidevProcessState>((resolve) => {
        resolveOld = resolve
      }),
  )
  const store = usePreviewStore()
  const old = store.selectDeck('old')
  await store.selectDeck('current')
  resolveOld({
    deckId: 'old',
    status: 'ready',
    previewUrl: 'http://localhost/old',
  })
  await old
  expect(store.state?.deckId).toBe('current')
  expect(store.loading).toBe(false)
})

it('keeps rule validation from the selected deck when old findings arrive late', async () => {
  let resolveOld!: (value: DeckValidationResult) => void
  client.validateDeck.mockImplementationOnce(
    () =>
      new Promise<DeckValidationResult>((resolve) => {
        resolveOld = resolve
      }),
  )
  const store = usePreviewStore()
  const old = store.selectDeck('old')
  await vi.waitFor(() =>
    expect(client.validateDeck).toHaveBeenCalledWith('old'),
  )
  await store.selectDeck('current')
  resolveOld({
    deckId: 'old',
    revision: 'r',
    valid: false,
    themeRuleDigest: null,
    themeRuleIssues: [],
    errors: [{ code: 'OLD', message: 'Old issue' }],
  })
  await old
  expect(store.validation?.deckId).toBe('current')
  expect(store.validation?.valid).toBe(true)
})

describe('resolvePreferredThemeId', () => {
  const themes = ['slidev-theme-academy', 'slidev-theme-landing']

  it('uses the first registered theme when no deck or recent theme exists', () => {
    expect(resolvePreferredThemeId(themes)).toBe('slidev-theme-academy')
  })

  it('prefers recent and still-registered theme selections', () => {
    expect(
      resolvePreferredThemeId(
        themes,
        'slidev-theme-landing',
        'slidev-theme-academy',
      ),
    ).toBe('slidev-theme-landing')
    expect(
      resolvePreferredThemeId(themes, undefined, 'slidev-theme-landing'),
    ).toBe('slidev-theme-landing')
  })
})
