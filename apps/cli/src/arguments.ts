import { resolve } from 'node:path'

export interface CliArguments {
  workspaceRoot: string
  help: boolean
  version: boolean
}

export function parseCliArguments(
  argv: readonly string[],
  cwd: string,
): CliArguments {
  let directory: string | undefined
  let help = false
  let version = false

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') help = true
    else if (argument === '--version' || argument === '-v') version = true
    else if (argument === '--dir' || argument === '--workspace') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-'))
        throw new Error(`${argument} requires a directory path.`)
      directory = value
      index++
    } else if (argument?.startsWith('--dir='))
      directory = argument.slice('--dir='.length)
    else if (argument?.startsWith('--workspace='))
      directory = argument.slice('--workspace='.length)
    else throw new Error(`Unknown option: ${argument ?? ''}`)
  }

  return {
    workspaceRoot: resolve(cwd, directory ?? '.'),
    help,
    version,
  }
}

export const CLI_HELP = `Usage: fastppt [options]

Start the FastPPT local backend for a workspace. The frontend is not started;
open the deployed FastPPT web app after the Gateway becomes ready.

Options:
  --dir <path>        workspace directory (default: current directory)
  --workspace <path> alias for --dir
  -h, --help          show this help
  -v, --version       show the CLI version
`
