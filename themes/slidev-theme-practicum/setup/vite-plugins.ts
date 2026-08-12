import { resolve } from 'node:path'
import type { ResolvedSlidevOptions } from '@slidev/types'
import type { Plugin } from 'vite'
import { createFileDecorStore } from '../composables/decor-file-store'
import { createDecorSaveMiddleware } from './decor-save-middleware'

const OUTPUT_PATH = resolve(process.cwd(), 'composables/decor-tuning-overrides.mjs')

type DecorLibraryVitePluginContext = Pick<ResolvedSlidevOptions, 'data'>

function readExpectedOrigin(options?: DecorLibraryVitePluginContext) {
  const value = options?.data.config.themeConfig.decorSaveOrigin

  return typeof value === 'string' && value.trim() ? value : undefined
}

export default function decorLibraryVitePlugins(
  options?: DecorLibraryVitePluginContext,
): Plugin[] {
  const expectedOrigin = readExpectedOrigin(options)

  return [
    {
      name: 'practicum:decor-library-save',
      apply: 'serve',
      configureServer(server) {
        const store = createFileDecorStore({ output: OUTPUT_PATH })

        server.middlewares.use(createDecorSaveMiddleware({
          expectedOrigin,
          store,
        }))
      },
    },
  ]
}
