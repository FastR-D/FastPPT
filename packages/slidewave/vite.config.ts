import { resolve } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'

import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'portable-helper-declarations',
    async generateBundle() {
      // tsc does not copy authored .d.mts files. Public native contracts refer
      // to these portable helpers, so consumers need their declarations too.
      const directory = resolve(import.meta.dirname, 'src/primitives')
      await Promise.all((await readdir(directory)).filter(name => name.endsWith('.d.mts')).map(async name => {
        this.emitFile({ type: 'asset', fileName: `primitives/${name}`, source: await readFile(resolve(directory, name), 'utf8') })
      }))
    },
  }],
  build: {
    lib: {
      entry: {
        'native-animation': resolve(import.meta.dirname, 'src/server/native-animation.ts'),
        'native-motion': resolve(import.meta.dirname, 'src/primitives/native-motion.mjs'),
        'text-kerning': resolve(import.meta.dirname, 'src/primitives/text-kerning.mjs'),
        xml: resolve(import.meta.dirname, 'src/server/slide-xml.ts'),
        core: resolve(import.meta.dirname, 'src/index.ts'),
        'motion-schedule': resolve(import.meta.dirname, 'src/primitives/motion-schedule.ts'),
        'diagram-layout': resolve(
          import.meta.dirname,
          'src/primitives/diagram-layout.ts',
        ),
        snapshot: resolve(import.meta.dirname, 'src/snapshot.ts'),
        'browser/index': resolve(import.meta.dirname, 'src/browser/index.ts'),
        'browser/runtime': resolve(
          import.meta.dirname,
          'src/browser/capture-runtime.ts',
        ),
        'server/index': resolve(import.meta.dirname, 'src/server/index.ts'),
      },
      name: 'Slidewave',
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        'jszip',
        'lucide',
        'pptxgenjs',
        'prismjs',
        'subset-font',
        'ttf2eot',
        'zod',
        /^node:/,
        /^prismjs\//,
      ],
    },
    sourcemap: true,
  },
})
