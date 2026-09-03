import { spawn } from "node:child_process";

const processes = [
  spawn("pnpm", ["exec", "tsx", "skills/ppt-master/studio-ts/src/server.ts"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("pnpm", ["exec", "vite", "--config", "skills/ppt-master/studio-web/vite.config.ts"], { stdio: "inherit", shell: process.platform === "win32" }),
];

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) child.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown(signal));
for (const child of processes) child.once("exit", (code) => {
  if (!shuttingDown && code && code !== 0) shutdown("SIGTERM");
});
