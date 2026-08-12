import { loadGatewayConfig } from '@fastppt/config'

import { createGateway } from './app.js'

const config = loadGatewayConfig()
const app = await createGateway(config)

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down FastPPT Gateway')
  await app.close()
  process.exitCode = 0
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: config.host, port: config.port })
app.log.info(
  {
    host: config.host,
    port: config.port,
    workspaceRoot: config.workspaceRoot,
  },
  'FastPPT Gateway ready',
)
