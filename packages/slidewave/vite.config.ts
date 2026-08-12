import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: {
        core: resolve(import.meta.dirname, 'src/index.ts'),
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
        'lucide',
        'pptxgenjs',
        'prismjs',
        'zod',
        /^node:/,
        /^prismjs\//,
      ],
    },
    sourcemap: true,
  },
})
