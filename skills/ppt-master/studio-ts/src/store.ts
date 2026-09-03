import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const hashFile = async (file: string) => `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
export const hashText = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const exists = async (file: string) => stat(file).then(() => true, () => false);
export async function appendJsonl(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await appendFile(file, `${JSON.stringify(value)}\n`, "utf8"); }
export async function readJsonl(file: string): Promise<Record<string, unknown>[]> { if (!(await exists(file))) return []; return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
export async function readJson<T>(file: string, fallback: T): Promise<T> { if (!(await exists(file))) return fallback; return JSON.parse(await readFile(file, "utf8")); }
export async function atomicJson(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, file); }
export async function authoringDirectory(root: string) { for (const name of ["svg_output", "authoring-svg-flat"]) { const candidate = path.join(root, name); if (await exists(candidate)) return candidate; } throw new Error("project has no supported authoring directory"); }
export async function slideFiles(root: string) { const directory = await authoringDirectory(root); return (await readdir(directory)).filter((name) => name.endsWith(".svg")).sort(); }
async function hashTree(root: string, relative: string): Promise<string[]> {
  const target = path.join(root, relative);
  if (!(await exists(target))) return [];
  const metadata = await stat(target);
  if (metadata.isFile()) return [`${relative}:${await hashFile(target)}`];
  const rows: string[] = [];
  for (const name of (await readdir(target)).sort()) rows.push(...await hashTree(root, path.join(relative, name)));
  return rows;
}
export async function deckRevision(root: string) {
  const directory = await authoringDirectory(root);
  const files = await slideFiles(root);
  const rows = await Promise.all(files.map(async (name) => `${path.basename(directory)}/${name}:${await hashFile(path.join(directory, name))}`));
  for (const relative of ["animations.json", "page_plan.json", "notes", "audio"]) rows.push(...await hashTree(root, relative));
  return `sha256:${createHash("sha256").update(rows.sort().join("\n")).digest("hex")}`;
}

export class Events {
  private readonly listeners = new Set<(event: Record<string, unknown>) => void>();
  constructor(private readonly interaction: string) {}
  async emit(type: string, payload: Record<string, unknown> = {}) {
    const file = path.join(this.interaction, "events.jsonl");
    const sequence = (await readJsonl(file)).length + 1;
    const topics = ["workspace"];
    if (typeof payload.jobId === "string") topics.push(`run:${payload.jobId}`);
    if (typeof payload.sessionId === "string") topics.push(`session:${payload.sessionId}`);
    if (type.startsWith("revision.") || type.startsWith("validation.") || type.startsWith("workflow.")) topics.push("deck:current");
    if (type.startsWith("export.")) topics.push(`export:${typeof payload.jobId === "string" ? payload.jobId : "current"}`);
    const event = { eventId: id("evt"), sequence, type, topics: [...new Set(topics)], timestamp: now(), ...payload };
    await appendJsonl(file, event);
    if (typeof payload.jobId === "string") {
      await appendJsonl(path.join(this.interaction, "jobs", payload.jobId, "events.jsonl"), event);
    }
    for (const listener of this.listeners) listener(event);
    return event;
  }
  async since(sequence: number, topics: string[] = []) { return (await readJsonl(path.join(this.interaction, "events.jsonl"))).filter((item) => Number(item.sequence) > sequence && (!topics.length || topics.some((topic) => Array.isArray(item.topics) && item.topics.includes(topic)))); }
  subscribe(listener: (event: Record<string, unknown>) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
