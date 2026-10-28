import { PaletteLibrary, PaletteSearchSchema } from '@fastppt/palettes'
import { HarnessKindSchema } from '@fastppt/protocol'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export function registerPaletteRoutes(
  app: FastifyInstance,
  generate: (harness: 'claude' | 'codex', prompt: string) => Promise<string>,
  library = new PaletteLibrary(),
): void {
  app.get('/api/v1/palettes/facets', () => library.facets())
  app.get('/api/v1/palettes', (request) =>
    library.search(PaletteSearchSchema.parse(request.query)),
  )
  app.get<{ Params: { id: string } }>(
    '/api/v1/palettes/:id',
    async (request, reply) => {
      const value = await library.read(
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,100}$/)
          .parse(request.params.id),
      )
      return (
        value ??
        reply
          .code(404)
          .send({ error: { code: 'FILE_NOT_FOUND', message: '配色不存在' } })
      )
    },
  )
  app.post('/api/v1/palettes/recommend', async (request) => {
    const input = z
      .object({
        query: z.string().trim().min(1).max(2000),
        harness: HarnessKindSchema,
        source: PaletteSearchSchema.shape.source,
        kind: PaletteSearchSchema.shape.kind,
      })
      .parse(request.body)
    return library.recommend(
      input.query,
      (prompt) => generate(input.harness, prompt),
      {
        ...(input.source ? { source: input.source } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      },
    )
  })
}
