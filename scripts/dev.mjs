import { resolve } from 'node:path'

import { spawnDevProcess, terminateDevProcess } from './dev-process.mjs'

function argumentValue(argv, ...names) {
  for (const name of names) {
    const index = argv.indexOf(name)
    if (index >= 0) return argv[index + 1]
    const assigned = argv.find((argument) => argument.startsWith(`${name}=`))
    if (assigned) return assigned.slice(`${name}=`.length)
  }
  return undefined
}

// --dir 是新参数名;--workspace 保留为兼容别名
const workspace = resolve(
  argumentValue(process.argv.slice(2), '--dir', '--workspace') ?? process.cwd(),
)
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = [
  spawnDevProcess(
    executable,
    ['--filter', '@fastppt/gateway', 'dev', '--', '--workspace', workspace],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  ),
  spawnDevProcess(executable, ['--filter', '@fastppt/web', 'dev'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  }),
]

process.stdout.write(
  `FastPPT development services are starting for ${workspace}.\n` +
    `  gateway: http://127.0.0.1:4317\n` +
    `  web:     http://127.0.0.1:4318\n`,
)

let stopping = false
async function stop(exitCode) {
  if (stopping) return
  stopping = true
  await Promise.all(children.map((child) => terminateDevProcess(child)))
  process.exitCode = exitCode
}

process.once('SIGINT', () => void stop(130))
process.once('SIGTERM', () => void stop(143))
for (const child of children) {
  child.once('error', (error) => {
    process.stderr.write(`Failed to start FastPPT: ${error.message}\n`)
    void stop(1)
  })
  child.once('exit', (code, signal) => {
    if (!stopping) void stop(signal ? 1 : (code ?? 1))
  })
}
