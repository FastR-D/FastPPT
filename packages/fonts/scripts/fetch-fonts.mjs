#!/usr/bin/env node
/**
 * Fetch the FastPPT self-hosted font catalog into packages/fonts/assets/fonts/.
 *
 * All fonts are OFL (or otherwise free for commercial use, see THIRD_PARTY_NOTICES.md).
 * Latin + Noto CJK come from the google/fonts repo (raw.githubusercontent.com).
 * LXGW WenKai comes from its official GitHub repo. MiSans 4.1 is reconstructed
 * into complete static TTF faces from the official npm web-font package.
 *
 * Run `pnpm --filter @fastppt/fonts fetch-fonts`. Re-running skips existing files.
 */

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(packageRoot, 'assets', 'fonts')
await mkdir(outDir, { recursive: true })

const GF = (family, file) =>
  `https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/${file}`

/** @type {Array<{ family: string; file: string; url: string; minBytes: number; note: string }>} */
const FONTS = [
  // Latin — variable TTFs from google/fonts
  { family: 'Inter', file: 'inter-variable.ttf', url: GF('inter', 'Inter%5Bopsz%2Cwght%5D.ttf'), minBytes: 250_000, note: 'OFL' },
  { family: 'Space Grotesk', file: 'space-grotesk-variable.ttf', url: GF('spacegrotesk', 'SpaceGrotesk%5Bwght%5D.ttf'), minBytes: 120_000, note: 'OFL' },
  { family: 'Fira Code', file: 'fira-code-variable.ttf', url: GF('firacode', 'FiraCode%5Bwght%5D.ttf'), minBytes: 180_000, note: 'OFL' },
  { family: 'JetBrains Mono', file: 'jetbrains-mono-variable.ttf', url: GF('jetbrainsmono', 'JetBrainsMono%5Bwght%5D.ttf'), minBytes: 180_000, note: 'OFL' },
  { family: 'Space Mono', file: 'space-mono-regular.ttf', url: GF('spacemono', 'SpaceMono-Regular.ttf'), minBytes: 60_000, note: 'OFL' },
  { family: 'Nunito Sans', file: 'nunito-sans-variable.ttf', url: GF('nunitosans', 'NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf'), minBytes: 150_000, note: 'OFL' },
  { family: 'Sofia Sans', file: 'sofia-sans-variable.ttf', url: GF('sofiasans', 'SofiaSans%5Bwght%5D.ttf'), minBytes: 120_000, note: 'OFL' },
  { family: 'Lexend', file: 'lexend-variable.ttf', url: GF('lexend', 'Lexend%5Bwght%5D.ttf'), minBytes: 120_000, note: 'OFL' },
  { family: 'Caveat', file: 'caveat-variable.ttf', url: GF('caveat', 'Caveat%5Bwght%5D.ttf'), minBytes: 80_000, note: 'OFL' },
  { family: 'Shantell Sans', file: 'shantell-sans-variable.ttf', url: GF('shantellsans', 'ShantellSans%5BBNCE%2CINFM%2CSPAC%2Cwght%5D.ttf'), minBytes: 180_000, note: 'OFL' },

  // CJK — full variable/static TTFs
  { family: 'Noto Sans SC', file: 'noto-sans-sc-variable.ttf', url: GF('notosanssc', 'NotoSansSC%5Bwght%5D.ttf'), minBytes: 5_000_000, note: 'OFL' },
  { family: 'Noto Serif SC', file: 'noto-serif-sc-variable.ttf', url: GF('notoserifsc', 'NotoSerifSC%5Bwght%5D.ttf'), minBytes: 5_000_000, note: 'OFL' },

  // LXGW WenKai (霞鹜文楷) — official repo
  { family: 'LXGW WenKai', file: 'lxgw-wenkai-regular.ttf', url: 'https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/fonts/TTF/LXGWWenKai-Regular.ttf', minBytes: 3_000_000, note: 'OFL' },

]

async function download(font) {
  const target = join(outDir, font.file)
  try {
    const existing = await stat(target)
    if (existing.size >= font.minBytes) {
      console.log(`skip  ${font.family.padEnd(16)} ${font.file} (exists)`)
      return true
    }
  } catch {
    /* not present */
  }
  console.log(`fetch ${font.family.padEnd(16)} ${font.file}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const response = await fetch(font.url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) {
      console.log(`  !!  ${font.family}: HTTP ${response.status}`)
      return false
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength < font.minBytes) {
      console.log(`  !!  ${font.family}: ${bytes.byteLength} bytes < ${font.minBytes} (likely error page)`)
      return false
    }
    await writeFile(target, bytes)
    console.log(`  ok  ${font.family}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB`)
    return true
  } catch (cause) {
    console.log(`  !!  ${font.family}: ${cause instanceof Error ? cause.message : String(cause)}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

{
  const targets = ['Regular', 'Semibold', 'Bold'].map((weight) =>
    join(outDir, `misans-${weight.toLowerCase()}.ttf`),
  )
  if (targets.every((target) => existsSync(target))) {
    console.log('skip  MiSans complete TTFs (present)')
  } else {
    console.log('fetch and merge MiSans 4.1 web fonts')
    const tarball = await fetch('https://registry.npmjs.org/misans/-/misans-4.1.0.tgz', { redirect: 'follow' })
    if (!tarball.ok) {
      console.log(`  !!  MiSans tarball: HTTP ${tarball.status}`)
    } else {
      const tmp = join(packageRoot, '.misans-fetch')
      await rm(tmp, { recursive: true, force: true })
      await mkdir(tmp, { recursive: true })
      await writeFile(join(tmp, 'm.tgz'), Buffer.from(await tarball.arrayBuffer()))
      const { execFileSync } = await import('node:child_process')
      execFileSync('tar', ['-xzf', join(tmp, 'm.tgz'), '-C', tmp])
      const srcDir = join(tmp, 'package', 'lib', 'Normal')
      for (const weight of ['Regular', 'Semibold', 'Bold']) {
        const target = join(outDir, `misans-${weight.toLowerCase()}.ttf`)
        if (existsSync(target)) continue
        const sources = (await readdir(srcDir))
          .filter(
            (file) =>
              file.startsWith(`MiSans-${weight}.`) && file.endsWith('.woff2'),
          )
          .sort()
          .map((file) => join(srcDir, file))
        try {
          execFileSync('python3', [
            '-m',
            'fontTools.merge',
            ...sources,
            `--output-file=${target}`,
          ])
          console.log(`  ok  MiSans ${weight}: merged version 4.1 TTF`)
        } catch {
          console.log(
            `  !!  MiSans ${weight}: install Python fonttools[woff] to merge web subsets`,
          )
        }
      }
      await rm(tmp, { recursive: true, force: true })
    }
  }
}

const results = await Promise.all(FONTS.map(download))
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${FONTS.length} fonts available. Missing families will fall back at theme/embed level.`)
