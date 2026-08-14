import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

export interface RunThemeExtractionOptions {
  /** Absolute path to the uploaded PPTX file. */
  pptxPath: string
  /** Preferred theme name; a unique slug is derived from it. */
  themeName?: string
  /** Directory that receives `slidev-theme-<slug>` (the workspace themes root). */
  themesRoot: string
  /** Absolute path to `scripts/extract-theme.mjs`. */
  extractorPath: string
  /** Maximum runtime before the extractor is terminated. */
  timeoutMs?: number
}

export interface RunThemeExtractionResult {
  /** Absolute path to the generated theme package. */
  themeDir: string
  /** The unique theme slug actually used. */
  slug: string
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || fallback
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Run the deterministic PPTX theme extractor and return the generated theme
 * package. Picks a non-colliding slug when the requested name already exists.
 */
export async function runThemeExtraction(
  options: RunThemeExtractionOptions,
): Promise<RunThemeExtractionResult> {
  const baseSlug = slugify(options.themeName ?? 'imported-theme', 'imported-theme')
  let slug = baseSlug
  let suffix = 2
  while (await directoryExists(join(options.themesRoot, `slidev-theme-${slug}`))) {
    slug = `${baseSlug}-${suffix++}`
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const child = spawn(
      process.execPath,
      [
        options.extractorPath,
        options.pptxPath,
        '--name',
        slug,
        '--out',
        options.themesRoot,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-64 * 1024)
    })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(
        new Error(
          `Theme extraction timed out after ${Math.round((options.timeoutMs ?? 120_000) / 1000)} seconds.`,
        ),
      )
    }, options.timeoutMs ?? 120_000)
    child.once('error', (cause) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(cause)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) resolve()
      else
        reject(
          new Error(
            stderr.trim() ||
              `Theme extraction exited with code ${code ?? 0} (${signal ?? 'no signal'})`,
          ),
        )
    })
  })

  return { themeDir: join(options.themesRoot, `slidev-theme-${slug}`), slug }
}
