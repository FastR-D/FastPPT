import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Prepare a copy, then swap directories; failed registration restores the old theme. */
export async function installThemeDirectory(
  source: string,
  target: string,
  prepare: (candidate: string) => Promise<void>,
  register: () => Promise<void>,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const transaction = await mkdtemp(join(dirname(dirname(target)), '.fastppt-install-'))
  const candidate = join(transaction, 'candidate')
  const backup = join(transaction, 'backup')
  let backedUp = false
  let installed = false
  let recovered = true
  try {
    await cp(source, candidate, { recursive: true, errorOnExist: true })
    await prepare(candidate)
    try { await rename(target, backup); backedUp = true } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
    }
    await rename(candidate, target)
    installed = true
    await register()
  } catch (cause) {
    try {
      if (installed) await rm(target, { recursive: true, force: true })
      if (backedUp) await rename(backup, target)
    } catch (rollbackError) {
      recovered = false
      throw new AggregateError([cause, rollbackError], `Theme rollback failed; recovery files retained at ${transaction}`, { cause: rollbackError })
    }
    throw cause
  } finally {
    if (recovered) await rm(transaction, { recursive: true, force: true })
  }
}
