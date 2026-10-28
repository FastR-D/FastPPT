import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ImportAnalysisV1Schema } from '@fastppt/protocol'
import { withGeneratedCandidates } from '../src/import-candidates.js'

it('merges only matching generated evidence without replacing extracted source facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-import-review-'))
  try {
    await mkdir(join(directory, 'agent'))
    const analysis = ImportAnalysisV1Schema.parse({
      version: 1,
      sourceHash: 'a'.repeat(64),
      extractedFeatures: { immutable: true },
      candidateLayouts: [
        {
          id: 'layout.xml',
          name: 'Original',
          source: {
            part: 'layout.xml',
            master: 'master.xml',
            provenance: 'extracted',
          },
          issues: ['source issue'],
        },
      ],
    })
    const proposal = {
      sourceHash: analysis.sourceHash,
      candidates: [
        {
          id: 'layout.xml',
          name: 'source-layout-1',
          source: { part: 'wrong.xml', provenance: 'extracted' },
          generated: { status: 'partial' },
          semanticEvidence: [{ kind: 'reachable-layout', value: 'true' }],
          issues: ['generation issue'],
        },
      ],
    }
    await writeFile(
      join(directory, 'agent/layout-candidates.json'),
      JSON.stringify(proposal),
    )
    expect(
      (await withGeneratedCandidates(directory, analysis)).candidateLayouts[0],
    ).toMatchObject({
      name: 'source-layout-1',
      source: { part: 'layout.xml', master: 'master.xml' },
      generated: { status: 'partial' },
      issues: ['source issue', 'generation issue'],
    })
    expect(analysis.candidateLayouts[0]!.name).toBe('Original')
    await writeFile(
      join(directory, 'agent/layout-candidates.json'),
      JSON.stringify({ ...proposal, sourceHash: 'b'.repeat(64) }),
    )
    expect(await withGeneratedCandidates(directory, analysis)).toEqual(analysis)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
