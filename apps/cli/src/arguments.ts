import { resolve } from 'node:path'

export type CliCommand = 'start' | 'status' | 'doctor' | 'stop'

export interface CliArguments {
  command: CliCommand
  workspaceRoot: string
  port: number
  open: boolean
  json: boolean
  help: boolean
  version: boolean
}

function portNumber(value: string | undefined, option: string): number {
  const port = Number(value)
  if (!value || !Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`${option} requires an integer between 1 and 65535.`)
  return port
}

export function parseCliArguments(
  argv: readonly string[],
  cwd: string,
): CliArguments {
  let command: CliCommand = 'start'
  let directory: string | undefined
  let port = 4317
  let open = false
  let json = false
  let help = false
  let version = false
  let commandSeen = false

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (
      !commandSeen &&
      (argument === 'start' ||
        argument === 'status' ||
        argument === 'doctor' ||
        argument === 'stop')
    ) {
      command = argument
      commandSeen = true
    } else if (argument === '--help' || argument === '-h') help = true
    else if (argument === '--version' || argument === '-v') version = true
    else if (argument === '--open') open = true
    else if (argument === '--no-open') open = false
    else if (argument === '--json') json = true
    else if (argument === '--dir' || argument === '--workspace') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-'))
        throw new Error(`${argument} requires a directory path.`)
      directory = value
      index++
    } else if (argument === '--port' || argument === '-p') {
      port = portNumber(argv[index + 1], argument)
      index++
    } else if (argument?.startsWith('--dir='))
      directory = argument.slice('--dir='.length)
    else if (argument?.startsWith('--workspace='))
      directory = argument.slice('--workspace='.length)
    else if (argument?.startsWith('--port='))
      port = portNumber(argument.slice('--port='.length), '--port')
    else if (argument && !argument.startsWith('-'))
      throw new Error(`Unknown command: ${argument}`)
    else throw new Error(`Unknown option: ${argument ?? ''}`)
  }

  return {
    command,
    workspaceRoot: resolve(cwd, directory ?? '.'),
    port,
    open,
    json,
    help,
    version,
  }
}

export const CLI_HELP = `Usage: fastppt [command] [options]

Run and inspect the FastPPT local service for a workspace.

Commands:
  start                 start the Gateway (default)
  status                show whether this workspace Gateway is running
  doctor                run workspace, runtime, and readiness checks
  stop                  stop the Gateway registered for this workspace

Options:
  --dir <path>           workspace directory (default: current directory)
  --workspace <path>     alias for --dir
  -p, --port <number>    Gateway port (default: 4317)
  --open                 open https://fastppt.vercel.app after startup
  --no-open              do not open a browser (default)
  --json                 machine-readable output for status and doctor
  -h, --help             show this help
  -v, --version          show the CLI version

Examples:
  fastppt
  fastppt start --dir ./deck --open
  fastppt status --workspace ./deck
  fastppt doctor --json
  fastppt stop --dir ./deck
`
