import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerResourceRoutes } from '../src/resources.js'
import { ResourceDetailSchema, ResourceSearchResultSchema } from '@fastppt/protocol'

describe('resource HTTP contract', () => {
  it('serves paginated results, exact source and sandboxed previews/assets', async () => {
    const app = Fastify()
    registerResourceRoutes(app)
    try {
      const response = await app.inject('/api/v1/resources?query=流程&limit=2')
      expect(response.statusCode).toBe(200)
      const results = ResourceSearchResultSchema.parse(response.json())
      expect(results.items.length).toBe(2)
      const id = results.items[0]!.id
      const detail = await app.inject(`/api/v1/resources/${id}`)
      expect(ResourceDetailSchema.parse(detail.json()).resource.id).toBe(id)
      const preview = await app.inject(`/api/v1/resources/preview/${id}`)
      expect(preview.headers['content-security-policy']).toContain('sandbox')
      expect(preview.body).toContain('<main>')
      expect(preview.body).not.toContain('<script')
      // Screenshot routes are removed; previews render real source and local assets.
      expect((await app.inject(`/api/v1/resources/original/${id}`)).statusCode).toBe(404)
      expect((await app.inject(`/api/v1/resources/thumbnail/${id}`)).statusCode).toBe(404)
      expect((await app.inject('/api/v1/resources/nonexistent')).statusCode).toBe(404)
      expect((await app.inject('/api/v1/resources/assets/secret.txt')).statusCode).toBe(404)
    } finally { await app.close() }
  })
})
