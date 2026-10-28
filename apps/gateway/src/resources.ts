import { readFile } from 'node:fs/promises'
import { ResourceLibrary } from '@fastppt/resources'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'

export function registerResourceRoutes(app: FastifyInstance, library = new ResourceLibrary()): void {
  app.get('/api/v1/resources/facets', async () => {
    const entries = await library.entries()
    const sources = [...new Set(entries.map(entry => entry.source))].map(path => ({
      path, label: path.endsWith('/template.pptx') ? path.split('/').at(-2)! : path.split('/').at(-1)!,
      count: entries.filter(entry => entry.source === path && entry.status !== 'excluded').length,
    }))
    return { sources }
  })
  app.get('/api/v1/resources', async (request) => library.search(z.object({
    query: z.string().max(2000).optional(),
    kind: z.enum(['layout', 'diagram']).optional(),
    density: z.enum(['airy', 'balanced', 'dense']).optional(),
    source: z.string().max(500).optional(),
    status: z.enum(['reconstructed', 'needs-review', 'excluded']).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(24),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(request.query)))
  app.get<{ Params: { id: string } }>('/api/v1/resources/:id', async (request, reply) => {
    const result = await library.read(z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/).parse(request.params.id))
    if (!result) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: '版式不存在' } })
    return result
  })
  app.get<{ Params: { id: string } }>('/api/v1/resources/preview/:id', async (request, reply) => {
    const content = await library.preview(z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/).parse(request.params.id))
    if (!content) return reply.code(404).send()
    return reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('X-Content-Type-Options', 'nosniff').type('text/html; charset=utf-8').send(content)
  })
  app.get<{ Params: { file: string } }>('/api/v1/resources/assets/:file', async (request, reply) => {
    const file = request.params.file
    if (!/^[a-f0-9]+\.(png|jpe?g|webp|gif|svg|woff2)$/.test(file)) return reply.code(404).send()
    try {
      const path = await library.filePath(`assets/${file}`)
      const type = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : `image/${file.split('.').at(-1)}`
      return reply.header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('X-Content-Type-Options', 'nosniff').header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'public, max-age=86400').type(type).send(await readFile(path))
    } catch { return reply.code(404).send() }
  })
}
