import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { NativeMasterLayoutSchema } from '@fastppt/protocol'
import {
  ThemeManifestSchema,
  ThemeRulesDocumentSchema,
  evaluateThemeRules,
  themeRulesDigest,
} from '@fastppt/theme-registry'
import type { ThemeRuleApprovalReport } from '@fastppt/protocol'
import { resolveExistingPath } from '@fastppt/workspace'
import { themeRuleSlides } from './theme-rule-context.js'

/** Approval checks the pruned catalog's capabilities. It cannot attest to the
 * content or rendering of a future authored deck. */
export async function evaluateImportRuleApproval(
  root: string,
): Promise<ThemeRuleApprovalReport> {
  const manifest = ThemeManifestSchema.parse(
    JSON.parse(await readFile(join(root, 'agent/theme-manifest.json'), 'utf8')),
  )
  const definitionRaw = await readFile(
    join(root, 'agent/native-layouts.json'),
    'utf8',
  ).catch((cause: unknown) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
      return undefined
    throw cause
  })
  const definitions = definitionRaw
    ? z.array(NativeMasterLayoutSchema).parse(JSON.parse(definitionRaw))
    : undefined
  const document = manifest.machineRulesFile
    ? ThemeRulesDocumentSchema.parse(
        JSON.parse(
          await readFile(
            await resolveExistingPath(root, manifest.machineRulesFile),
            'utf8',
          ),
        ),
      )
    : undefined
  const layouts = manifest.layouts.map((layout) => layout.id)
  const issues = document
    ? evaluateThemeRules({
        document,
        phase: 'approval',
        slides: themeRuleSlides(
          layouts.map((layout) => ({ layout, slideId: layout })),
          definitions,
        ),
      })
    : []
  return {
    version: 1,
    scope: 'theme-catalog',
    checkedAt: new Date().toISOString(),
    digest: document ? themeRulesDigest(document) : null,
    catalogDigest: createHash('sha256')
      .update(JSON.stringify({ manifest, definitions }))
      .digest('hex'),
    layouts,
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  }
}
