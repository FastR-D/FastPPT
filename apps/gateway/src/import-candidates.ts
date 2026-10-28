import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ImportLayoutCandidateSchema,
  type ImportAnalysisV1,
} from '@fastppt/protocol'

/** Generated proposals enrich the review; immutable extracted facts stay intact. */
export async function withGeneratedCandidates(
  directory: string,
  analysis: ImportAnalysisV1,
): Promise<ImportAnalysisV1> {
  const raw = await readFile(
    join(directory, 'agent/layout-candidates.json'),
    'utf8',
  ).catch((cause: unknown) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
      return undefined
    throw cause
  })
  if (!raw) return analysis
  const document = z
    .object({
      sourceHash: z.string().optional(),
      candidates: z.array(ImportLayoutCandidateSchema),
    })
    .parse(JSON.parse(raw))
  if (document.sourceHash !== analysis.sourceHash) return analysis
  return {
    ...analysis,
    candidateLayouts: analysis.candidateLayouts.map((source) => {
      const generated = document.candidates.find(
        (entry) => entry.id === source.id,
      )
      if (!generated) return source
      return {
        ...source,
        name: generated.name,
        ...(generated.generated ? { generated: generated.generated } : {}),
        semanticEvidence: [
          ...source.semanticEvidence,
          ...generated.semanticEvidence.filter(
            (entry) => entry.kind === 'reachable-layout',
          ),
        ],
        issues: [...new Set([...source.issues, ...generated.issues])],
      }
    }),
  }
}
