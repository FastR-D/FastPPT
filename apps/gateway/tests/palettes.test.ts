import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import {
  PaletteRecommendationSchema,
  PaletteSearchResponseSchema,
} from '@fastppt/protocol'
import { registerPaletteRoutes } from '../src/palettes.js'

describe('palette HTTP contract', () => {
  it('serves local search, facets, detail and model recommendations', async () => {
    const app = Fastify()
    const calls: string[] = []
    registerPaletteRoutes(app, (harness, prompt) => {
      calls.push(harness)
      const candidates = JSON.parse(prompt.split('\n候选：')[1]!) as Array<{
        id: string
      }>
      return Promise.resolve(
        JSON.stringify({
          recommendations: [
            { id: candidates[0]!.id, reason: '适合本次演示的配色。' },
          ],
        }),
      )
    })
    try {
      const facets = await app.inject('/api/v1/palettes/facets')
      expect(facets.json().total).toBeGreaterThan(2000)
      const results = PaletteSearchResponseSchema.parse(
        (await app.inject('/api/v1/palettes?query=科技&limit=2')).json(),
      )
      expect(results.items).toHaveLength(2)
      expect(
        (await app.inject(`/api/v1/palettes/${results.items[0]!.id}`)).json()
          .colors,
      ).toEqual(results.items[0]!.colors)
      expect(
        (await app.inject('/api/v1/palettes/not-a-real-palette')).statusCode,
      ).toBe(404)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/palettes/recommend',
        payload: { query: '商务汇报', harness: 'codex' },
      })
      expect(response.statusCode).toBe(200)
      expect(
        PaletteRecommendationSchema.parse(response.json()).recommendations,
      ).toHaveLength(1)
      expect(calls).toEqual(['codex'])
    } finally {
      await app.close()
    }
  })
})
