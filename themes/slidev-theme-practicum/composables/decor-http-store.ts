import type { DecorStore } from './decor-store'

const DEFAULT_SAVE_PATH = '/__decor-library/save'

export function createHttpDecorStore(input: { url?: string, fetcher?: typeof fetch } = {}): DecorStore {
  return {
    async save(overrides) {
      const fetcher = input.fetcher ?? globalThis.fetch
      if (!fetcher)
        throw new Error('Fetch API is unavailable')

      const response = await fetcher(input.url ?? DEFAULT_SAVE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      const result = await response.json()

      if (!response.ok || !result?.ok)
        throw new Error(result?.error || `Save failed with HTTP ${response.status}`)

      return { ok: true, count: Number(result.count) || 0 }
    },
  }
}
