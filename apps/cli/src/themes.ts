import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface InstallBundledThemesOptions {
  bundledThemesRoot: string
  themesRoot: string
  version: string
}

async function installedVersion(themesRoot: string): Promise<string | undefined> {
  try {
    return (await readFile(join(themesRoot, '.fastppt-bundled-version'), 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * Synchronize bundled themes into the per-user FastPPT directory. Imported
 * themes are preserved because only package names present in the bundle are
 * replaced. A version marker avoids copying the bundle on every startup.
 */
export async function installBundledThemes(
  options: InstallBundledThemesOptions,
): Promise<{ updated: boolean; themeCount: number }> {
  await mkdir(options.themesRoot, { recursive: true })
  const entries = (await readdir(options.bundledThemesRoot, {
    withFileTypes: true,
  })).filter((entry) => entry.isDirectory() && entry.name.startsWith('slidev-theme-'))
  if ((await installedVersion(options.themesRoot)) === options.version)
    return { updated: false, themeCount: entries.length }

  for (const entry of entries) {
    const target = join(options.themesRoot, entry.name)
    const temporary = join(
      options.themesRoot,
      `.${basename(entry.name)}.${process.pid}.tmp`,
    )
    await rm(temporary, { recursive: true, force: true })
    await cp(join(options.bundledThemesRoot, entry.name), temporary, {
      recursive: true,
    })
    await rm(target, { recursive: true, force: true })
    await rename(temporary, target)
  }
  const marker = join(options.themesRoot, '.fastppt-bundled-version')
  const temporaryMarker = `${marker}.${process.pid}.tmp`
  await writeFile(temporaryMarker, `${options.version}\n`)
  await rename(temporaryMarker, marker)
  return { updated: true, themeCount: entries.length }
}
