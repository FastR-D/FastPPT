import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
})

await writeFile(
  process.argv[2],
  JSON.stringify({ parent: process.pid, child: child.pid }),
)
setInterval(() => {}, 1_000)
