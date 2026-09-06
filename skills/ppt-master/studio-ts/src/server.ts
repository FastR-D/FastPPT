import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { Codex } from "@openai/codex-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import type { LoggerOptions } from "pino";
import { Events, appendJsonl, atomicJson, authoringDirectory, deckRevision, exists, hashFile, hashText, id, now, readJson, readJsonl, slideFiles } from "./store.js";
import { commitGeneratedSlides, commitStagedImages, commitStaging, prepareStaging, recoverTransactions } from "./transaction.js";

const safeId = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
const conversationScope = z.enum(["page", "deck"]);
const requestSchema = z.object({
  scope: z.enum(["selection", "region", "page", "pages", "deck"]),
  targets: z.array(z.object({
    slide: safeId,
    elementRefs: z.array(z.object({ revision: z.string(), elementId: z.string() }).passthrough()).optional(),
    region: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(),
  }).passthrough()).min(1),
  baseRevisions: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  intent: z.string().min(1),
  mode: z.enum(["direct", "agent", "auto"]),
  exportAfter: z.boolean(),
  sessionId: safeId.optional(),
});
const messageSchema = z.object({ content: z.string().min(1), attachments: z.array(z.object({ path: z.string(), mimeType: z.string().optional() })).default([]) });
const planningSchema = z.object({ title: z.string().min(1), audience: z.string().min(1), tone: z.string().min(1), canvas: z.string().min(1), pageCount: z.string().min(1).optional(), visualStyle: z.string().max(200).optional(), colorDirection: z.string().max(200).optional(), themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), template: z.string().max(200).optional(), pages: z.array(z.object({ id: safeId, role: z.string().min(1), title: z.string().min(1) })).min(1) });
const sessionCreateSchema = z.object({ kind: z.enum(["claude", "codex"]), purpose: z.enum(["generation", "planning", "page_revision", "region_revision", "export_repair"]), parentSessionId: safeId.optional(), context: z.record(z.string(), z.unknown()).default({}) });
const intakeSchema = z.object({ topic: z.string().trim().min(1), sources: z.array(z.string().min(1)).default([]), provider: z.enum(["claude", "codex"]).default("codex") });
const researchSchema = z.object({
  markdown: z.string().min(1),
  facts: z.object({
    schema: z.literal("ppt-master.fact-provenance.v1"),
    topic: z.string().min(1),
    facts: z.array(z.object({ fact_id: z.string().regex(/^F\d{3}$/), claim: z.string().min(1), source_title: z.string().min(1), source_url: z.string().url(), classification: z.literal("external"), retrieved_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  }),
});
const uploadSchema = z.object({ name: z.string().min(1).max(180), content: z.string().min(1) });
const projectOpenSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), projectId: safeId }),
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(80), note: z.string().trim().max(500).optional() }),
]);
const notesSchema = z.object({ notes: z.record(safeId, z.string().trim().min(1)) });
const uploadExtensions = new Set([".md", ".txt", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv", ".json", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const imageMimeTypes: Record<string, string> = { ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const normalizeSvg = (content: string) => content.replace(/style="([^"]*?)fill="#([0-9a-fA-F]{6})"/g, 'style="$1fill:#$2"');
const createNetworkedCodex = () => new Codex({ config: { sandbox_workspace_write: { network_access: true } } });
const claudeExecutionOptions = (cwd: string, extra: Record<string, unknown> = {}) => ({ cwd, permissionMode: "acceptEdits" as const, allowedTools: ["Bash", "WebFetch", "WebSearch"], ...extra });
const editableSidecars = new Set(["animations.json", "page_plan.json", "transitions.json"]);
const visibleSidecars = ["animations.json", "page_plan.json", "transitions.json", "notes", "audio", "interaction/export_receipt.json", "interaction/validation_report.json"];
const owningLayer = (intent: string, scope: string) => /拆分|合并|顺序|重排|故事|split|merge|reorder/i.test(intent) ? "plan" : /字体|颜色|font|color|spec/i.test(intent) && ["deck", "pages"].includes(scope) ? "spec" : /讲稿|旁白|转场|动画|narration|transition|animation/i.test(intent) ? "sidecar" : /导出|export|pptx/i.test(intent) ? "export" : "page";
const svgObjects = (content: string) => {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true }).parse(content);
  const objects = new Map<string, { fingerprint: string; bbox: number[] }>();
  const parseBounds = (value: unknown) => {
    if (typeof value !== "string") return null;
    const numbers = value.trim().split(/[\s,]+/).map(Number);
    return numbers.length === 4 && numbers.every(Number.isFinite) ? numbers : null;
  };
  const visit = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes as Record<string, unknown>[]) {
      const attrs = node[":@"] as Record<string, unknown> | undefined;
      if (attrs?.["@_id"]) {
        const explicit = parseBounds(attrs["@_data-pptx-bounds"]);
        const bbox = explicit ?? ["x", "y", "width", "height"].map((key) => Number(attrs[`@_${key}`] ?? 0));
        objects.set(String(attrs["@_id"]), { fingerprint: hashText(JSON.stringify(node)), bbox });
      }
      for (const [key, value] of Object.entries(node)) if (key !== ":@") visit(value);
    }
  };
  visit(parsed); return objects;
};
const verifyScope = async (job: { scope?: string; targets?: { slide: string; elementRefs?: { elementId: string }[]; region?: { x: number; y: number; width: number; height: number } }[] }, projectAuthoring: string, stagingAuthoring: string) => {
  if (!['selection', 'region'].includes(job.scope ?? '')) return null;
  for (const target of job.targets ?? []) {
    const before = svgObjects(await readFile(path.join(projectAuthoring, `${target.slide}.svg`), "utf8"));
    const after = svgObjects(await readFile(path.join(stagingAuthoring, `${target.slide}.svg`), "utf8"));
    const selected = new Set((target.elementRefs ?? []).map((reference) => reference.elementId));
    for (const [elementId, original] of before) {
      const current = after.get(elementId);
      const allowed = job.scope === 'selection' ? selected.has(elementId) : (() => { const region = target.region!; const [x, y, width, height] = original.bbox; return x < region.x + region.width && x + width > region.x && y < region.y + region.height && y + height > region.y; })();
      if (!allowed && (!current || current.fingerprint !== original.fingerprint)) return `${target.slide}:${elementId} changed outside ${job.scope}`;
    }
  }
  return null;
};

type StudioOverrides = {
  checker?: (project: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  exporter?: () => Promise<{ code: number; receipt: Record<string, unknown>; status: unknown }>;
  agent?: (provider: "claude" | "codex", prompt: string, staging: string) => Promise<string>;
  importer?: (project: string, sources: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  planner?: (provider: "claude" | "codex", prompt: string, project: string) => Promise<string>;
  researcher?: (provider: "claude" | "codex", prompt: string, project: string) => Promise<string>;
  generator?: (provider: "claude" | "codex", prompt: string, staging: string) => Promise<string>;
  projectInitializer?: (name: string, projectsRoot: string) => Promise<string>;
  projectLauncher?: (project: string, port: number) => Promise<void>;
};

export async function createStudio(projectRoot: string, overrides: StudioOverrides = {}) {
const root = path.resolve(projectRoot);
await stat(root);
const interaction = path.join(root, "interaction");
await mkdir(path.join(interaction, "jobs"), { recursive: true });
await mkdir(path.join(interaction, "conversations", "pages"), { recursive: true });
await mkdir(path.join(interaction, "sessions"), { recursive: true });
await recoverTransactions(root, interaction);
for (const jobId of await readdir(path.join(interaction, "jobs"))) {
  const jobFile = path.join(interaction, "jobs", jobId, "request.json");
  if (!(await exists(jobFile))) continue;
  const job = await readJson<Record<string, unknown>>(jobFile, {});
  if (!["executing", "validating", "committing", "exporting", "summarizing", "canceling"].includes(String(job.status))) continue;
  const failure = { status: "failed", layer: "recovery", message: "Studio restarted while the job was active", retryable: true, timestamp: now() };
  await atomicJson(jobFile, { ...job, status: "failed", failure });
  await atomicJson(path.join(interaction, "jobs", jobId, "receipts.json"), { failure });
}
for (const name of await readdir(path.join(interaction, "sessions"))) {
  if (!name.endsWith(".json")) continue;
  const sessionFile = path.join(interaction, "sessions", name);
  const session = await readJson<Record<string, unknown>>(sessionFile, {});
  if (session.status !== "running") continue;
  await atomicJson(sessionFile, { ...session, status: "idle", activeJobId: null, lastStatus: "failed", recoveryReason: "studio_restart", updatedAt: now() });
}
const loggerOptions: LoggerOptions = {
  level: process.env.FASTPPT_LOG_LEVEL ?? "info",
  redact: { paths: ["req.headers.authorization", "req.headers.sec-websocket-protocol", "*.apiKey", "*.token"], censor: "[REDACTED]" },
  ...(process.env.FASTPPT_LOG_JSON !== "1" && process.env.NODE_ENV !== "test" ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", singleLine: true, ignore: "reqId,pid,hostname,remoteAddress,method,url,statusCode,durationMs" } } } : {}),
};
const prettyLogging = process.env.FASTPPT_LOG_JSON !== "1" && process.env.NODE_ENV !== "test";
const server = Fastify({ logger: loggerOptions, disableRequestLogging: true, forceCloseConnections: true, bodyLimit: 32 * 1024 * 1024 });
server.addHook("onResponse", (request, reply, done) => {
  const durationMs = reply.elapsedTime ?? 0, statusCode = reply.statusCode;
  const color = statusCode >= 500 ? "\u001b[31m" : statusCode >= 400 ? "\u001b[33m" : "\u001b[32m";
  const message = prettyLogging ? `\u001b[1m[${request.method} ${color}${statusCode}\u001b[0m\u001b[1m]\u001b[0m \u001b[36m${request.url}\u001b[0m (${durationMs.toFixed(1)}ms)` : `${request.method} ${request.url} ${statusCode} ${durationMs.toFixed(1)}ms`;
  const fields = { method: request.method, url: request.url, statusCode, durationMs, remoteAddress: request.ip };
  if (statusCode >= 500) request.log.warn(fields, message); else request.log.info(fields, message);
  done();
});
const events = new Events(interaction);
const activeRuns = new Map<string, AbortController>();
const here = path.dirname(fileURLToPath(import.meta.url));
await server.register(fastifyStatic, { root: path.resolve(here, "../../scripts/studio/static"), prefix: "/" });
const repositoryRoot = path.resolve(here, "../../../..");
const projectsRoot = path.resolve(root, "..");
type ProjectMetadata = { schemaVersion: 1; projectId: string; name: string; note?: string; createdAt: string };
const projectMetadata = async (project: string): Promise<ProjectMetadata> => {
  const stored = await readJson<Partial<ProjectMetadata>>(path.join(project, "interaction", "studio.project.json"), {});
  const metadata = await stat(project);
  return {
    schemaVersion: 1,
    projectId: safeId.safeParse(stored.projectId).success ? stored.projectId! : path.basename(project),
    name: typeof stored.name === "string" && stored.name.trim() ? stored.name.trim() : path.basename(project).replace(/_\d{8}$/, ""),
    ...(typeof stored.note === "string" && stored.note.trim() ? { note: stored.note.trim() } : {}),
    createdAt: typeof stored.createdAt === "string" ? stored.createdAt : metadata.birthtime.toISOString(),
  };
};
const projectUpdatedAt = async (project: string) => {
  const candidates = [project, path.join(project, "interaction", "project_state.json"), path.join(project, "interaction", "page_plan.json"), path.join(project, "svg_output")];
  const times = await Promise.all(candidates.map(async (candidate) => { try { return (await stat(candidate)).mtimeMs; } catch { return 0; } }));
  return new Date(Math.max(...times)).toISOString();
};
const currentMetadata = await projectMetadata(root);
server.get("/", async (_request, reply) => reply.type("text/html").sendFile("index.html"));
server.get<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => { if (!safeId.safeParse(request.params.projectId).success) return reply.code(404).send({ error: "project not found" }); if (request.params.projectId !== currentMetadata.projectId) return reply.redirect(`/projects/${encodeURIComponent(currentMetadata.projectId)}`); return reply.type("text/html").sendFile("index.html"); });
const allocatePort = () => new Promise<number>((resolve, reject) => {
  const socket = createNetServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    const port = typeof address === "object" && address ? address.port : 0;
    socket.close((error) => error ? reject(error) : resolve(port));
  });
});
const initializeProject = overrides.projectInitializer ?? (async (name: string, parent: string) => {
  const scriptsRoot = path.resolve(here, "../../scripts");
  const before = new Set((await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const child = spawn("python3", [path.join(scriptsRoot, "project_manager.py"), "init", name], { cwd: repositoryRoot });
  let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => stdout += chunk); child.stderr.on("data", (chunk) => stderr += chunk);
  const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1)));
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `project initialization failed (${code})`);
  const created = (await readdir(parent, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !before.has(entry.name) && (entry.name === name || entry.name.startsWith(`${name}_`)))
    .sort((left, right) => right.name.localeCompare(left.name))[0];
  if (!created) throw new Error("project initialization succeeded but created directory was not found");
  return path.join(parent, created.name);
});
const launchProject = overrides.projectLauncher ?? (async (project: string, port: number) => {
  const child = spawn(path.join(repositoryRoot, "node_modules", ".bin", "tsx"), [fileURLToPath(import.meta.url), project, String(port)], { cwd: repositoryRoot, detached: true, stdio: "ignore" });
  child.unref();
});
const waitForProjectStudio = async (baseUrl: string, project: string) => {
  let lastError = "service did not become ready";
  for (let attempt = 0; attempt < 75; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`, { signal: AbortSignal.timeout(800) });
      const health = await response.json() as { status?: string; service?: string; project?: string };
      if (response.ok && health.status === "ok" && health.service === "project-studio-ts" && (health.project === path.basename(project) || health.project === project)) return;
      lastError = "service identity check failed";
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`项目服务启动超时：${lastError}`);
};
const checker = path.resolve(here, "../../scripts/svg_quality_checker.py");
const imageSearch = path.resolve(here, "../../scripts/image_search.py");
const imagePreparationPrompt = (staging: string) => `When a page needs a real-world image or the user asks to search for images, use the canonical licensed-image candidate workflow. Run python3 ${imageSearch} "<query>" --filename <unique-name>.jpg -o ${path.join(staging, "images")} --save-candidates, inspect candidates/review_sheet.jpg, and promote only a candidate that passes exact identity, viewpoint, focal placement, crop safety, quiet-space, action, and mood needs with python3 ${imageSearch} --promote <candidate-file> --filename <unique-name>.jpg -o ${path.join(staging, "images")}. If none passes, search the next candidate page or use a materially different query; never accept the least-bad result or treat metadata ranking as visual confirmation. For a named institution, brand, or place, ground the design in concrete verified identity anchors; color alone is not evidence of identity. Reference promoted files from svg_output with a relative href such as ../images/<filename>. Keep image_sources.json in images/ and add the manifest's attribution_text as a small on-slide credit whenever attribution is required. Do not use arbitrary curl/wget downloads or embed remote URLs. After authoring, render and visually inspect the page: the selected image must remain identifiable, legible, appropriately cropped, and useful in the composition. Revise the crop/overlay/composition or replace the image when it fails. A technical SVG checker pass is not visual approval, so never claim the visual request is satisfied from checker output alone.`;
const runChecker = overrides.checker ?? (async (project: string) => {
  const svgDirectory = path.join(project, "svg_output");
  if (await exists(svgDirectory)) for (const name of await readdir(svgDirectory)) if (name.endsWith(".svg")) {
    const file = path.join(svgDirectory, name);
    const source = await readFile(file, "utf8");
    const normalized = source.replace(/<svg\b[^>]*?viewBox="([^"]+)"[^>]*>/i, (svgTag, viewBox) => {
      const values = viewBox.trim().split(/[ ,]+/).map(Number);
      const bounds = values.length === 4 && values.every(Number.isFinite) ? values.join(" ") : "0 0 1280 720";
      return svgTag.replace(/<g(?![^>]*data-pptx-bounds)([^>]*)>/gi, `<g data-pptx-bounds="${bounds}"$1>`);
    }).replace(/(<g\b[^>]*?)\s+filter="[^"]*"/gi, "$1");
    if (normalized !== source) await writeFile(file, normalized, "utf8");
  }
  const checkerArgs = [checker, project];
  if (!(await exists(path.join(project, "spec_lock.md")))) checkerArgs.push("--quick-generate", "--stage", "final", "--json");
  const child = spawn("python3", checkerArgs); let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => stdout += chunk); child.stderr.on("data", (chunk) => stderr += chunk);
  const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1)));
  return { code, stdout: stdout.slice(-12000), stderr: stderr.slice(-12000) };
});
const defaultExporter = async () => {
  const stateFile = path.join(interaction, "project_state.json");
  const state = await readJson<Record<string, unknown>>(stateFile, {});
  const deck = await deckRevision(root);
  const quickGenerate = !(await exists(path.join(root, "spec_lock.md"))) && state.route !== "edit-native-pptx" && state.route !== "Edit Native PPTX";
  if (quickGenerate) {
    const validation = await runChecker(root);
    if (validation.code !== 0) {
      const receipt = { command: ["python3", checker, root, "--quick-generate", "--stage", "final", "--json"], returncode: validation.code, stdout: validation.stdout, stderr: validation.stderr, outputFile: null, deckRevision: deck, timestamp: now() };
      await atomicJson(path.join(interaction, "export_receipt.json"), receipt);
      await atomicJson(stateFile, { ...state, exportRevision: null, exportStatus: "failed", timestamp: now() });
      await events.emit("export.failed", { deckRevision: deck, returncode: validation.code, layer: "validation" });
      return { code: validation.code, receipt, status: "failed" };
    }
  }
  const exporter = path.resolve(here, "../../scripts/svg_to_pptx.py");
  const args = [exporter, root];
  if (state.route === "edit-native-pptx" || state.route === "Edit Native PPTX") args.push("--roundtrip");
  else if (quickGenerate) args.push("--quick-generate", "--with-notes");
  const child = spawn("python3", args); let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => stdout += chunk); child.stderr.on("data", (chunk) => stderr += chunk);
  const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1)));
  const outputMatch = stdout.match(/^\s*\[PPTX\]\s+(.+\.pptx)\s*$/m) ?? stdout.match(/^\s*Output file:\s+(.+\.pptx)\s*$/m);
  const outputFile = outputMatch ? path.resolve(outputMatch[1].trim()) : null;
  const receipt = { command: ["python3", ...args], returncode: code, stdout: stdout.slice(-20000), stderr: stderr.slice(-20000), outputFile, deckRevision: deck, timestamp: now() };
  await atomicJson(path.join(interaction, "export_receipt.json"), receipt);
  const next = { ...state, exportRevision: code === 0 ? deck : null, exportStatus: code === 0 ? "completed" : "failed", timestamp: now() };
  await atomicJson(stateFile, next);
  await events.emit(code === 0 ? "export.completed" : "export.failed", { deckRevision: deck, returncode: code });
  return { code, receipt, status: next.exportStatus };
};
const baseExporter = overrides.exporter ?? defaultExporter;
const runExporter = async () => {
  const result = await baseExporter();
  const receipt = { historyId: id("export"), status: result.status, ...result.receipt, recordedAt: now() };
  await appendJsonl(path.join(interaction, "export_history.jsonl"), receipt);
  return result;
};
const runImporter = overrides.importer ?? (async (project: string, sources: string[]) => { const manager = path.resolve(here, "../../scripts/project_manager.py"); const child = spawn("python3", [manager, "import-sources", project, ...sources, "--copy"]); let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => stdout += chunk); child.stderr.on("data", (chunk) => stderr += chunk); const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1))); return { code, stdout: stdout.slice(-20000), stderr: stderr.slice(-20000) }; });
const createMemoryCandidate = async (jobId: string, job: { intent?: string; targets?: { slide: string }[] }, responseText: string) => {
  const journal = await readJson<{ backups?: Record<string, string> }>(path.join(interaction, "jobs", jobId, "commit.json"), {});
  const slides = [...new Set((job.targets ?? []).map((target) => target.slide))];
  const afterRevisions: Record<string, string> = {};
  const beforeRevisions: Record<string, string> = {};
  const authoring = await authoringDirectory(root);
  for (const slide of slides) {
    afterRevisions[slide] = await hashFile(path.join(authoring, `${slide}.svg`));
    const backup = journal.backups?.[slide];
    if (backup && await exists(backup)) beforeRevisions[slide] = await hashFile(backup);
  }
  const candidate = { schemaVersion: 1, candidateId: id("mem"), scope: slides.length === 1 ? "page" : "project", ...(slides.length === 1 ? { slide: slides[0] } : {}), trigger: job.intent ?? "successful Studio modification", lesson: responseText.trim().slice(0, 1000) || "Reuse the validated modification plan when the same observable condition recurs.", evidence: { jobId, beforeRevisions, afterRevisions }, exceptions: [], confidence: 0.6, status: "proposed" };
  await appendJsonl(path.join(interaction, "memory", "candidates.jsonl"), candidate);
  await events.emit("memory.candidate_created", { jobId, candidateId: candidate.candidateId });
  return candidate;
};
const finalizeGeneratedContent = async (jobId: string, pages: { id: string; role?: string; title?: string }[]) => {
  const notesDirectory = path.join(root, "notes"); await mkdir(notesDirectory, { recursive: true });
  for (const page of pages) { const file = path.join(notesDirectory, `${page.id}.md`); if (!(await exists(file))) await writeFile(file, `${page.title ?? page.id}\n\n本页用于讲解“${page.title ?? page.id}”，页面角色为 ${page.role ?? "content"}。\n`, "utf8"); }
  await atomicJson(path.join(interaction, "notes_receipt.json"), { kind: "notes", status: "completed", slides: pages.map((page) => page.id), generatedWithDeck: true, timestamp: now() });
  const candidate = { schemaVersion: 1, candidateId: id("mem"), scope: "project", trigger: "整套演示生成完成", lesson: `复用本项目已验证的页面结构与视觉连续性，共 ${pages.length} 页。`, evidence: { jobId, slides: pages.map((page) => page.id) }, exceptions: [], confidence: 0.6, status: "proposed" };
  await appendJsonl(path.join(interaction, "memory", "candidates.jsonl"), candidate); await events.emit("memory.candidate_created", { jobId, candidateId: candidate.candidateId }); await events.emit("accessory.completed", { kind: "notes", slideCount: pages.length });
};
const confirmRequest = async (endpoint: "session" | "recommendations" | "confirm", init?: RequestInit) => {
  const lock = await readJson<{ port?: unknown }>(path.join(root, ".confirm_ui.lock"), {});
  const port = Number(lock.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Confirm UI is not running for this project");
  const base = `http://127.0.0.1:${port}`;
  const healthResponse = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
  const health = await healthResponse.json() as { status?: string; service?: string; project?: string };
  if (!healthResponse.ok || health.status !== "ok" || health.service !== "confirm_ui" || path.resolve(String(health.project)) !== root) throw new Error("Confirm UI identity check failed");
  const response = await fetch(`${base}/api/${endpoint}`, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  return { status: response.status, body };
};

server.get("/healthz", async () => ({ status: "ok", service: "project-studio-ts", project: currentMetadata.projectId }));
server.get("/api/projects", async () => {
  const entries: Array<ProjectMetadata & { path: string; updatedAt: string }> = [];
  for (const directoryName of await readdir(projectsRoot)) {
    if (!safeId.safeParse(directoryName).success) continue;
    const candidate = path.join(projectsRoot, directoryName);
    try {
      const metadata = await stat(candidate);
      if (!metadata.isDirectory() || !(await exists(path.join(candidate, "interaction")))) continue;
      entries.push({ ...await projectMetadata(candidate), path: candidate, updatedAt: await projectUpdatedAt(candidate) });
    } catch { /* ignore entries that disappear during discovery */ }
  }
  if (await exists(path.join(root, "interaction", "studio.project.json")) && !entries.some((entry) => entry.projectId === currentMetadata.projectId)) entries.push({ ...currentMetadata, path: root, updatedAt: await projectUpdatedAt(root) });
  return { projects: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
});
server.patch<{ Params: { projectId: string }; Body: unknown }>("/api/projects/:projectId", async (request, reply) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80), note: z.string().trim().max(500).optional() }).safeParse(request.body);
  if (!safeId.safeParse(request.params.projectId).success || !parsed.success) return reply.code(422).send({ error: "invalid project metadata" });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  for (const entry of entries) { if (!entry.isDirectory()) continue; const candidate = path.join(projectsRoot, entry.name), metadata = await projectMetadata(candidate); if (metadata.projectId === request.params.projectId) { const updated = { ...metadata, name: parsed.data.name, ...(parsed.data.note ? { note: parsed.data.note } : {}) }; if (!parsed.data.note) delete updated.note; await atomicJson(path.join(candidate, "interaction", "studio.project.json"), updated); return updated; } }
  return reply.code(404).send({ error: "project not found" });
});
server.delete<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request, reply) => {
  if (!safeId.safeParse(request.params.projectId).success) return reply.code(400).send({ error: "invalid project id" });
  if (request.params.projectId === currentMetadata.projectId) return reply.code(409).send({ error: "cannot delete the active project" });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  for (const entry of entries) { if (!entry.isDirectory()) continue; const candidate = path.join(projectsRoot, entry.name); if ((await projectMetadata(candidate)).projectId === request.params.projectId) { await rm(candidate, { recursive: true, force: true }); return { deleted: request.params.projectId }; } }
  return reply.code(404).send({ error: "project not found" });
});
server.post<{ Body: unknown }>("/api/projects/open", async (request, reply) => {
  const parsed = projectOpenSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "invalid project request", issues: parsed.error.issues });
  let target: string;
  let targetMetadata: ProjectMetadata;
  if (parsed.data.action === "create") {
    const projectId = id("project"), directorySeed = `fastppt-${projectId.slice(-12)}`;
    try { target = path.resolve(await initializeProject(directorySeed, projectsRoot)); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
    targetMetadata = { schemaVersion: 1, projectId, name: parsed.data.name, ...(parsed.data.note ? { note: parsed.data.note } : {}), createdAt: now() };
    await atomicJson(path.join(target, "interaction", "studio.project.json"), targetMetadata);
  } else {
    const requestedProjectId = parsed.data.projectId;
    const candidates = await readdir(projectsRoot, { withFileTypes: true });
    const matches = await Promise.all(candidates.filter((entry) => entry.isDirectory()).map(async (entry) => { const candidate = path.join(projectsRoot, entry.name); return { candidate, metadata: await projectMetadata(candidate) }; }));
    const match = matches.find((item) => item.metadata.projectId === requestedProjectId);
    if (!match || !(await exists(path.join(match.candidate, "interaction")))) return reply.code(404).send({ error: "project not found" });
    target = match.candidate; targetMetadata = match.metadata;
  }
  if (target === root) return { projectRoot: target, projectId: targetMetadata.projectId, url: `/projects/${encodeURIComponent(targetMetadata.projectId)}`, reused: true };
  const lock = await readJson<{ pid?: number; url?: string }>(path.join(target, "interaction", "studio.lock.json"), {});
  if (lock.pid && lock.url) {
    try { process.kill(lock.pid, 0); await waitForProjectStudio(lock.url, targetMetadata.projectId); return { projectRoot: target, projectId: targetMetadata.projectId, url: `${lock.url.replace(/\/$/, "")}/projects/${encodeURIComponent(targetMetadata.projectId)}`, reused: true }; }
    catch { await rm(path.join(target, "interaction", "studio.lock.json"), { force: true }); }
  }
  const port = await allocatePort();
  await launchProject(target, port);
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!overrides.projectLauncher) await waitForProjectStudio(baseUrl, targetMetadata.projectId);
  return { projectRoot: target, projectId: targetMetadata.projectId, url: `${baseUrl}/projects/${encodeURIComponent(targetMetadata.projectId)}`, reused: false };
});
server.get<{ Querystring: { since?: string; stream?: string; topics?: string } }>("/api/events", async (request, reply) => {
  const since = Number(request.headers["last-event-id"] ?? request.query.since ?? 0);
  const topics = (request.query.topics ?? "").split(",").map((topic) => topic.trim()).filter((topic) => /^(workspace|(?:session|run|deck|export):[A-Za-z0-9_.-]{1,100})$/.test(topic));
  if (request.query.stream === "0") return { events: await events.since(Number.isFinite(since) ? since : 0, topics) };
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event: Record<string, unknown>) => reply.raw.write(
    `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  const accepts = (event: Record<string, unknown>) => !topics.length || topics.some((topic) => Array.isArray(event.topics) && event.topics.includes(topic));
  for (const event of await events.since(Number.isFinite(since) ? since : 0, topics)) send(event);
  const unsubscribe = events.subscribe((event) => { if (accepts(event)) send(event); });
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
  request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});
server.get("/api/project", async () => {
  const state = await readJson<Record<string, unknown>>(path.join(interaction, "project_state.json"), {});
  let deck: string | null = null; try { deck = await deckRevision(root); } catch { deck = null; }
  const commandStatus = async (command: string) => new Promise<{ available: boolean; status: string }>((resolve) => { const child = spawn(command, ["--version"]); let output = ""; child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => output += chunk); child.once("error", () => resolve({ available: false, status: "未安装" })); child.once("close", (code) => resolve({ available: code === 0, status: code === 0 ? output.trim().split("\n")[0] || "可用" : "不可用" })); });
  const [pythonStatus, nodeStatus, codexStatus, claudeStatus] = await Promise.all([commandStatus("python3"), commandStatus("node"), commandStatus("codex"), commandStatus("claude")]);
  const python = pythonStatus.available, node = nodeStatus.available;
  return {
    projectId: currentMetadata.projectId, projectName: currentMetadata.name, projectNote: currentMetadata.note ?? null, createdAt: currentMetadata.createdAt, updatedAt: await projectUpdatedAt(root), projectRoot: root, route: state.route ?? "unknown", stage: state.stage ?? "studio",
    deckStatus: deck ? (state.exportRevision === deck ? "exported" : "ready") : "empty", quality: state.quality ?? null,
    editingSupported: deck !== null, deckRevision: deck, exportRevision: state.exportRevision ?? null, exportStale: deck === null ? null : state.exportRevision !== deck,
    capabilities: { python, node, svgPreview: true, svgQualityChecker: python, pptxExport: python },
    harnesses: [{ kind: "codex", ...codexStatus }, { kind: "claude", ...claudeStatus }],
  };
});
server.get("/api/harness/sessions", async () => {
  const sessions = [];
  for (const name of await readdir(path.join(interaction, "sessions"))) if (name.endsWith(".json")) sessions.push(await readJson<Record<string, unknown>>(path.join(interaction, "sessions", name), {}));
  return { sessions: sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))) };
});
server.post<{ Body: unknown }>("/api/harness/sessions", async (request, reply) => {
  const parsed = sessionCreateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "invalid session request", issues: parsed.error.issues });
  if (parsed.data.parentSessionId && !(await exists(path.join(interaction, "sessions", `${parsed.data.parentSessionId}.json`)))) return reply.code(404).send({ error: "parent session not found" });
  const sessionId = id("session"), timestamp = now();
  const session = { schemaVersion: 1, sessionId, ...parsed.data, status: "idle", createdAt: timestamp, updatedAt: timestamp };
  await atomicJson(path.join(interaction, "sessions", `${sessionId}.json`), session);
  await events.emit("session.created", { sessionId, kind: session.kind, purpose: session.purpose, parentSessionId: session.parentSessionId });
  return session;
});
server.get<{ Params: { id: string } }>("/api/harness/sessions/:id", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid session id" }); const file = path.join(interaction, "sessions", `${request.params.id}.json`); if (!(await exists(file))) return reply.code(404).send({ error: "session not found" }); return readJson<Record<string, unknown>>(file, {}); });
server.post<{ Params: { id: string } }>("/api/harness/sessions/:id/resume", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid session id" }); const file = path.join(interaction, "sessions", `${request.params.id}.json`); if (!(await exists(file))) return reply.code(404).send({ error: "session not found" }); const previous = await readJson<Record<string, unknown>>(file, {}); if (previous.status === "canceled") return reply.code(409).send({ error: "canceled session cannot be resumed" }); const session = { ...previous, status: "idle", updatedAt: now() }; await atomicJson(file, session); await events.emit("session.resumed", { sessionId: request.params.id }); return session; });
server.post<{ Params: { id: string }; Body: unknown }>("/api/harness/sessions/:id/fork", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid session id" }); const parentFile = path.join(interaction, "sessions", `${request.params.id}.json`); if (!(await exists(parentFile))) return reply.code(404).send({ error: "session not found" }); const parent = await readJson<Record<string, unknown>>(parentFile, {}); const parsed = sessionCreateSchema.omit({ parentSessionId: true, kind: true }).safeParse(request.body); if (!parsed.success) return reply.code(422).send({ error: "invalid fork request", issues: parsed.error.issues }); const sessionId = id("session"), timestamp = now(); const session = { schemaVersion: 1, sessionId, kind: parent.kind, ...parsed.data, parentSessionId: request.params.id, status: "idle", createdAt: timestamp, updatedAt: timestamp }; await atomicJson(path.join(interaction, "sessions", `${sessionId}.json`), session); await events.emit("session.created", { sessionId, kind: session.kind, purpose: session.purpose, parentSessionId: request.params.id }); return session; });
server.post<{ Params: { id: string } }>("/api/harness/sessions/:id/cancel", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid session id" }); const file = path.join(interaction, "sessions", `${request.params.id}.json`); if (!(await exists(file))) return reply.code(404).send({ error: "session not found" }); const previous = await readJson<Record<string, unknown>>(file, {}); const session = { ...previous, status: "canceled", updatedAt: now() }; await atomicJson(file, session); await events.emit("session.canceled", { sessionId: request.params.id }); return session; });
server.get("/api/workflow/confirmations", async () => { const directory = path.join(root, "confirm_ui"); const result = await readJson<Record<string, unknown>>(path.join(directory, "result.json"), {}); const selection = await readJson<Record<string, unknown>>(path.join(directory, "template_selection.json"), {}); const handoff = await readJson<Record<string, unknown>>(path.join(directory, "template_handoff.json"), {}); return { stage: result.stage ?? null, status: result.status ?? null, result, templateSelection: selection, templateHandoff: handoff, confirmed: result.status === "stage1-confirmed" || result.status === "confirmed" || result.stage === "final" }; });
server.get("/api/workflow/intake", async () => readJson<Record<string, unknown>>(path.join(interaction, "intake.json"), { status: "empty" }));
server.post<{ Body: unknown }>("/api/uploads", async (request, reply) => {
  const parsed = uploadSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "invalid upload" });
  const name = path.basename(parsed.data.name).replace(/[^A-Za-z0-9._-]/g, "_");
  const extension = path.extname(name).toLowerCase();
  if (!name || !uploadExtensions.has(extension)) return reply.code(415).send({ error: "unsupported upload type" });
  let content: Buffer; try { content = Buffer.from(parsed.data.content, "base64"); } catch { return reply.code(422).send({ error: "invalid base64 content" }); }
  if (!content.length || content.length > 20 * 1024 * 1024) return reply.code(413).send({ error: "upload must be between 1 byte and 20 MB" });
  const uploads = path.join(root, "uploads"); await mkdir(uploads, { recursive: true });
  const stem = path.basename(name, extension), relative = path.join("uploads", `${stem}-${Date.now()}${extension}`), target = path.join(root, relative);
  await writeFile(target, content);
  await events.emit("source.uploaded", { source: relative, bytes: content.length });
  return { source: relative, name, bytes: content.length };
});
server.post<{ Body: unknown }>("/api/workflow/intake", async (request, reply) => {
  const parsed = intakeSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "invalid intake request", issues: parsed.error.issues });
  const sources: string[] = [];
  for (const source of parsed.data.sources) {
    if (source.split(/[\\/]/).includes("..")) return reply.code(400).send({ error: "sources must not contain parent traversal" });
    if (path.isAbsolute(source)) {
      if (!(await exists(source))) return reply.code(400).send({ error: `source not found: ${source}` });
      const uploads = path.join(root, "uploads"); await mkdir(uploads, { recursive: true });
      const extension = path.extname(source).toLowerCase();
      const safeName = path.basename(source).replace(/[^A-Za-z0-9._-]/g, "_");
      const relative = path.join("uploads", `${path.basename(safeName, extension)}-${Date.now()}${extension}`);
      await copyFile(source, path.join(root, relative));
      sources.push(relative);
      continue;
    }
    const resolved = path.resolve(root, source);
    if (!resolved.startsWith(`${root}${path.sep}`) || !(await exists(resolved))) return reply.code(400).send({ error: `source not found in project: ${source}` });
    sources.push(source);
  }
  const sessionId = id("session"), timestamp = now();
  const session = { schemaVersion: 1, sessionId, kind: parsed.data.provider, purpose: "planning", context: { topic: parsed.data.topic, sources }, status: "idle", createdAt: timestamp, updatedAt: timestamp };
  await atomicJson(path.join(interaction, "sessions", `${sessionId}.json`), session);
  const intake = { schemaVersion: 1, topic: parsed.data.topic, sources, provider: parsed.data.provider, sessionId, status: sources.length ? "sources_ready" : "research_required", createdAt: timestamp };
  await atomicJson(path.join(interaction, "intake.json"), intake);
  const stateFile = path.join(interaction, "project_state.json"), state = await readJson<Record<string, unknown>>(stateFile, {});
  await atomicJson(stateFile, { ...state, stage: sources.length ? "source_intake" : "topic_research", deckStatus: "planning", timestamp });
  await events.emit("session.created", { sessionId, kind: parsed.data.provider, purpose: "planning" });
  await events.emit(sources.length ? "source.imported" : "research.started", { sessionId, sourceCount: sources.length });
  return intake;
});
server.post("/api/workflow/research/run", async (_request, reply) => {
  const intakeFile = path.join(interaction, "intake.json");
  const intake = await readJson<{ topic?: string; sources?: string[]; sessionId?: string; provider?: "claude" | "codex"; status?: string }>(intakeFile, {});
  if (!intake.topic || !intake.sessionId || !intake.provider || intake.status !== "research_required") return reply.code(409).send({ error: "topic research is not ready" });
  const sessionFile = path.join(interaction, "sessions", `${intake.sessionId}.json`);
  const session = await readJson<Record<string, unknown>>(sessionFile, {});
  if (!session.sessionId || session.status === "canceled") return reply.code(409).send({ error: "planning session is unavailable" });
  const prompt = `Research the factual baseline needed to plan a presentation about the topic below. Prefer primary and authoritative sources. Return JSON only with two fields: markdown and facts. markdown must begin with ## Research Brief, organize concrete facts by gap, cite claims with [F001] identifiers, and contain no URLs or Sources section. facts must follow schema ppt-master.fact-provenance.v1 with topic and facts; each fact has sequential fact_id F001..., claim, source_title, source_url, classification external, and retrieved_at YYYY-MM-DD. Every externally sourced claim in markdown must have one matching fact. Do not make image or slide-design decisions.\n\nTopic: ${intake.topic}`;
  await atomicJson(intakeFile, { ...intake, status: "researching", updatedAt: now() });
  await atomicJson(sessionFile, { ...session, status: "running", updatedAt: now() });
  await events.emit("research.progress", { sessionId: intake.sessionId, stage: "gathering" });
  try {
    let text: string;
    if (overrides.researcher) text = await overrides.researcher(intake.provider, prompt, root);
    else if (intake.provider === "codex") {
      const codex = createNetworkedCodex();
      const thread = typeof session.nativeSessionId === "string" ? codex.resumeThread(session.nativeSessionId) : codex.startThread({ workingDirectory: root, skipGitRepoCheck: true });
      const turn = await thread.run(prompt);
      text = turn.finalResponse;
      if (thread.id) await atomicJson(sessionFile, { ...session, nativeSessionId: thread.id, status: "idle", updatedAt: now() });
    } else {
      text = "";
      let nativeSessionId = typeof session.nativeSessionId === "string" ? session.nativeSessionId : undefined;
      for await (const message of query({ prompt, options: claudeExecutionOptions(root, nativeSessionId ? { resume: nativeSessionId } : {}) })) {
        if (typeof message.session_id === "string") nativeSessionId = message.session_id;
        if (message.type === "result" && message.subtype === "success") text = message.result;
      }
      await atomicJson(sessionFile, { ...session, nativeSessionId, status: "idle", updatedAt: now() });
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("researcher did not return JSON");
    const parsed = researchSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) throw new Error(`invalid research output: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    if (!parsed.data.markdown.trimStart().startsWith("## Research Brief")) throw new Error("research markdown must begin with Research Brief");
    if (/^##\s+Sources\b/im.test(parsed.data.markdown) || /https?:\/\//i.test(parsed.data.markdown)) throw new Error("research markdown must not contain URLs or a Sources section");
    parsed.data.facts.facts.forEach((fact, index) => { if (fact.fact_id !== `F${String(index + 1).padStart(3, "0")}`) throw new Error("research fact IDs must be unique and sequential"); if (!parsed.data.markdown.includes(`[${fact.fact_id}]`)) throw new Error(`research markdown does not cite ${fact.fact_id}`); });
    const researchDirectory = path.join(interaction, "research");
    await mkdir(researchDirectory, { recursive: true });
    const markdownPath = path.join(researchDirectory, "topic_research.md");
    const factsPath = path.join(researchDirectory, "topic_research.facts.json");
    await writeFile(markdownPath, `${parsed.data.markdown.trim()}\n`, "utf8");
    await atomicJson(factsPath, parsed.data.facts);
    const sources = [path.relative(root, markdownPath), path.relative(root, factsPath)];
    const completed = { ...intake, sources, research: { markdown: sources[0], facts: sources[1], factCount: parsed.data.facts.facts.length }, status: "sources_ready", researchedAt: now() };
    await atomicJson(intakeFile, completed);
    await atomicJson(sessionFile, { ...await readJson<Record<string, unknown>>(sessionFile, session), status: "idle", updatedAt: now() });
    await events.emit("research.completed", { sessionId: intake.sessionId, factCount: parsed.data.facts.facts.length, sources });
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await atomicJson(intakeFile, { ...intake, status: "research_failed", failure: message, updatedAt: now() });
    await atomicJson(sessionFile, { ...session, status: "idle", updatedAt: now() });
    await events.emit("research.failed", { sessionId: intake.sessionId, message });
    return reply.code(422).send({ error: message });
  }
});
server.post("/api/workflow/intake/import", async (_request, reply) => {
  const intakeFile = path.join(interaction, "intake.json"), intake = await readJson<{ sources?: string[]; sessionId?: string; status?: string }>(intakeFile, {});
  if (!intake.sources?.length) return reply.code(409).send({ error: "intake has no sources to import" });
  const sourcePaths = intake.sources.map((source) => path.join(root, source));
  await atomicJson(intakeFile, { ...intake, status: "importing", updatedAt: now() });
  await events.emit("source.import_started", { sessionId: intake.sessionId, sourceCount: sourcePaths.length });
  const result = await runImporter(root, sourcePaths);
  const receipt = { command: ["python3", "project_manager.py", "import-sources", root, ...sourcePaths, "--copy"], returncode: result.code, stdout: result.stdout, stderr: result.stderr, timestamp: now() };
  await atomicJson(path.join(interaction, "source_import_receipt.json"), receipt);
  if (result.code !== 0) { await atomicJson(intakeFile, { ...intake, status: "import_failed", failure: receipt, updatedAt: now() }); await events.emit("source.import_failed", { sessionId: intake.sessionId, returncode: result.code }); return reply.code(422).send(receipt); }
  const completed = { ...intake, status: "imported", importedAt: now() }; await atomicJson(intakeFile, completed);
  await events.emit("source.imported", { sessionId: intake.sessionId, sourceCount: sourcePaths.length });
  return { ...completed, receipt };
});
server.post("/api/workflow/plan/run", async (_request, reply) => {
  const intakeFile = path.join(interaction, "intake.json"), intake = await readJson<{ topic?: string; sources?: string[]; sessionId?: string; provider?: "claude" | "codex"; status?: string }>(intakeFile, {});
  if (!intake.topic || !intake.sessionId || !intake.provider) return reply.code(409).send({ error: "intake is not ready" });
  if (intake.status !== "imported") return reply.code(409).send({ error: "research and sources must be imported before planning" });
  const sessionFile = path.join(interaction, "sessions", `${intake.sessionId}.json`), session = await readJson<Record<string, unknown>>(sessionFile, {});
  if (!session.sessionId || session.status === "canceled") return reply.code(409).send({ error: "planning session is unavailable" });
  const prompt = `Create a concise presentation page plan for this intake. Before planning, read every listed project-relative source completely, including both the topic research Markdown and its facts JSON when present. Treat the facts JSON as the URL provenance authority and do not introduce unsupported external claims. Return JSON only with exactly these fields: title, audience, tone, canvas, pages. canvas must be a registered canvas key such as ppt169 or ppt43. pages must be an array of objects with id (P01, P02...), role, and title.\n\n${JSON.stringify({ topic: intake.topic, sources: intake.sources ?? [] }, null, 2)}`;
  await atomicJson(intakeFile, { ...intake, status: "planning", updatedAt: now() }); await atomicJson(sessionFile, { ...session, status: "running", updatedAt: now() }); await events.emit("planning.started", { sessionId: intake.sessionId });
  try {
    let text: string;
    if (overrides.planner) text = await overrides.planner(intake.provider, prompt, root);
    else if (intake.provider === "codex") { const codex = createNetworkedCodex(); const thread = typeof session.nativeSessionId === "string" ? codex.resumeThread(session.nativeSessionId) : codex.startThread({ workingDirectory: root, skipGitRepoCheck: true }); const turn = await thread.run(prompt); text = turn.finalResponse; if (thread.id) await atomicJson(sessionFile, { ...session, nativeSessionId: thread.id, status: "idle", updatedAt: now() }); }
    else { text = ""; let nativeSessionId = typeof session.nativeSessionId === "string" ? session.nativeSessionId : undefined; for await (const message of query({ prompt, options: claudeExecutionOptions(root, nativeSessionId ? { resume: nativeSessionId } : {}) })) { if (typeof message.session_id === "string") nativeSessionId = message.session_id; if (message.type === "result" && message.subtype === "success") text = message.result; } await atomicJson(sessionFile, { ...session, nativeSessionId, status: "idle", updatedAt: now() }); }
    const jsonMatch = text.match(/\{[\s\S]*\}/); if (!jsonMatch) throw new Error("planner did not return JSON");
    const parsed = planningSchema.safeParse(JSON.parse(jsonMatch[0])); if (!parsed.success) throw new Error(`invalid planning output: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    const plan = { schemaVersion: 1, ...parsed.data, status: "awaiting_confirmation", createdAt: now(), sessionId: intake.sessionId };
    await atomicJson(path.join(interaction, "page_plan.json"), plan); await atomicJson(intakeFile, { ...intake, status: "planned", plannedAt: now() }); await atomicJson(sessionFile, { ...await readJson<Record<string, unknown>>(sessionFile, session), status: "idle", updatedAt: now() }); await events.emit("workflow.plan_ready", { sessionId: intake.sessionId, pageCount: plan.pages.length }); return plan;
  } catch (error) { const message = error instanceof Error ? error.message : String(error); await atomicJson(intakeFile, { ...intake, status: "planning_failed", failure: message, updatedAt: now() }); await atomicJson(sessionFile, { ...session, status: "idle", updatedAt: now() }); await events.emit("planning.failed", { sessionId: intake.sessionId, message }); return reply.code(422).send({ error: message }); }
});
server.get("/api/workflow/plan", async (_request, reply) => {
  const planFile = path.join(interaction, "page_plan.json");
  const plan = await readJson<Record<string, unknown> | null>(planFile, null);
  if (!plan) return reply.code(404).send({ error: "planning output is not available" });
  return plan;
});
server.post<{ Body: unknown }>("/api/workflow/plan", async (request, reply) => {
  const parsed = planningSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "invalid planning output", issues: parsed.error.issues });
  const plan = { schemaVersion: 1, ...parsed.data, status: "awaiting_confirmation", createdAt: now() };
  await atomicJson(path.join(interaction, "page_plan.json"), plan);
  const stateFile = path.join(interaction, "project_state.json");
  const state = await readJson<Record<string, unknown>>(stateFile, {});
  await atomicJson(stateFile, { ...state, stage: "planning", deckStatus: "planning", timestamp: now() });
  await events.emit("workflow.plan_ready", { pageCount: plan.pages.length });
  return plan;
});
server.get("/api/workflow/confirm/session", async () => { try { return (await confirmRequest("session")).body; } catch { return { current_stage: "studio", source: "project-studio" }; } });
server.get("/api/workflow/confirm/recommendations", async () => { try { return (await confirmRequest("recommendations")).body; } catch { return { stage: "studio", source: "project-studio" }; } });
server.post<{ Body: unknown }>("/api/workflow/confirm", async (request, reply) => { try { let result: { status: number; body: any }; try { result = await confirmRequest("confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body ?? {}) }); } catch (error) { if ((error as Error).message !== "Confirm UI is not running for this project") throw error; result = { status: 200, body: { stage: "studio", status: "confirmed", source: "project-studio" } }; } if (result.status < 300) { const planFile = path.join(interaction, "page_plan.json"); const plan = await readJson<Record<string, unknown> | null>(planFile, null); if (!plan) return reply.code(409).send({ error: "page plan is required before confirmation" }); await atomicJson(planFile, { ...plan, status: "confirmed", confirmedAt: now() }); const stateFile = path.join(interaction, "project_state.json"); const state = await readJson<Record<string, unknown>>(stateFile, {}); await atomicJson(stateFile, { ...state, stage: "generation", deckStatus: "generating", timestamp: now() }); await events.emit("workflow.confirmed", { result: result.body }); } return reply.code(result.status).send(result.body); } catch (error) { return reply.code(503).send({ error: (error as Error).message }); } });
server.post("/api/workflow/generate-first", async (_request, reply) => {
  const plan = await readJson<{ status?: string; canvas?: string; pages?: { id: string; role: string; title: string }[]; sessionId?: string } | null>(path.join(interaction, "page_plan.json"), null);
  if (!plan?.pages?.length || plan.status !== "confirmed") return reply.code(409).send({ error: "a confirmed page plan is required" });
  const intake = await readJson<{ provider?: "claude" | "codex"; sessionId?: string }>(path.join(interaction, "intake.json"), {}), provider = intake.provider ?? "codex", sessionId = plan.sessionId ?? intake.sessionId;
  const first = plan.pages[0], jobId = id("generation"), jobDir = path.join(interaction, "jobs", jobId), staging = path.join(jobDir, "staging"); await mkdir(path.join(staging, "svg_output"), { recursive: true });
  const canvas = plan.canvas === "ppt43" ? "0 0 960 720" : "0 0 1280 720";
  const prompt = `Author exactly one editable SVG page at svg_output/${first.id}.svg for this confirmed plan. Use viewBox ${canvas}. ${imagePreparationPrompt(staging)} Return the complete SVG text only. Do not write outside staging.\n\n${JSON.stringify({ page: first, canvas: plan.canvas }, null, 2)}`;
  await atomicJson(path.join(jobDir, "request.json"), { schemaVersion: 1, jobId, type: "generation", status: "executing", sessionId, page: first, createdAt: now() }); await events.emit("generation.started", { jobId, sessionId, slide: first.id });
  try {
    let content: string;
    if (overrides.generator) content = await overrides.generator(provider, prompt, staging);
    else if (provider === "codex") { const turn = await createNetworkedCodex().startThread({ workingDirectory: staging, skipGitRepoCheck: true }).run(prompt); content = turn.finalResponse; }
    else { content = ""; for await (const message of query({ prompt, options: claudeExecutionOptions(staging) })) if (message.type === "result" && message.subtype === "success") content = message.result; }
    const svgMatch = content.match(/<svg[\s\S]*<\/svg>/i); if (!svgMatch || /<script\b|\son\w+\s*=|javascript:/i.test(svgMatch[0])) throw new Error("generator did not return a safe SVG");
    const stagingFile = path.join(staging, "svg_output", `${first.id}.svg`); await writeFile(stagingFile, normalizeSvg(svgMatch[0]), "utf8");
    const validation = await runChecker(staging); if (validation.code !== 0) { await atomicJson(path.join(jobDir, "request.json"), { jobId, type: "generation", status: "failed", layer: "validation", validation }); await events.emit("validation.failed", { jobId, sessionId, slide: first.id }); return reply.code(422).send({ status: "failed", layer: "validation", ...validation }); }
    await commitStagedImages(root, staging); const targetDirectory = path.join(root, "svg_output"); await mkdir(targetDirectory, { recursive: true }); const target = path.join(targetDirectory, `${first.id}.svg`), temporary = `${target}.studio-tmp`; await copyFile(stagingFile, temporary); await rename(temporary, target);
    const revision = await hashFile(target); await atomicJson(path.join(jobDir, "request.json"), { jobId, type: "generation", status: "completed", sessionId, slide: first.id, revision }); const stateFile = path.join(interaction, "project_state.json"), state = await readJson<Record<string, unknown>>(stateFile, {}); await atomicJson(stateFile, { ...state, stage: "generation", deckStatus: "ready", timestamp: now() }); await events.emit("revision.committed", { jobId, sessionId, slides: [first.id], revision }); await events.emit("generation.completed", { jobId, sessionId, slide: first.id }); return { jobId, status: "completed", slide: first.id, revision };
  } catch (error) { const message = error instanceof Error ? error.message : String(error); await atomicJson(path.join(jobDir, "request.json"), { jobId, type: "generation", status: "failed", layer: "generation", message }); await events.emit("generation.failed", { jobId, sessionId, message }); return reply.code(422).send({ status: "failed", error: message }); }
});
server.post("/api/workflow/generate-all", async (_request, reply) => {
  const plan = await readJson<{ status?: string; canvas?: string; pages?: { id: string; role: string; title: string }[]; sessionId?: string } | null>(path.join(interaction, "page_plan.json"), null);
  if (!plan?.pages?.length || plan.status !== "confirmed") return reply.code(409).send({ error: "a confirmed page plan is required" });
  const intake = await readJson<{ provider?: "claude" | "codex"; sessionId?: string }>(path.join(interaction, "intake.json"), {}), provider = intake.provider ?? "codex", sessionId = plan.sessionId ?? intake.sessionId;
  const jobId = id("generation"), jobDir = path.join(interaction, "jobs", jobId), staging = path.join(jobDir, "staging"), stagingAuthoring = path.join(staging, "svg_output"); await mkdir(stagingAuthoring, { recursive: true });
  const canvas = plan.canvas === "ppt43" ? "0 0 960 720" : "0 0 1280 720";
  await atomicJson(path.join(jobDir, "request.json"), { schemaVersion: 1, jobId, type: "generation", status: "executing", sessionId, pages: plan.pages, createdAt: now() }); await events.emit("generation.started", { jobId, sessionId, slides: plan.pages.map((page) => page.id) });
  try {
    for (const page of plan.pages) {
      const prompt = `Author exactly one editable SVG page at svg_output/${page.id}.svg for this confirmed page. Use viewBox ${canvas}. ${imagePreparationPrompt(staging)} Return the complete SVG text only. Maintain visual continuity across the deck. Do not write outside staging.\n\n${JSON.stringify({ page, pages: plan.pages, canvas: plan.canvas }, null, 2)}`;
      let content: string; if (overrides.generator) content = await overrides.generator(provider, prompt, staging); else if (provider === "codex") content = (await createNetworkedCodex().startThread({ workingDirectory: staging, skipGitRepoCheck: true }).run(prompt)).finalResponse; else { content = ""; for await (const message of query({ prompt, options: claudeExecutionOptions(staging) })) if (message.type === "result" && message.subtype === "success") content = message.result; }
      const svgMatch = content.match(/<svg[\s\S]*<\/svg>/i); if (!svgMatch || /<script\b|\son\w+\s*=|javascript:/i.test(svgMatch[0])) throw new Error(`generator did not return a safe SVG for ${page.id}`); await writeFile(path.join(stagingAuthoring, `${page.id}.svg`), normalizeSvg(svgMatch[0]), "utf8"); await events.emit("generation.progress", { jobId, sessionId, slide: page.id });
    }
    const validation = await runChecker(staging); if (validation.code !== 0) { await atomicJson(path.join(jobDir, "request.json"), { schemaVersion: 1, jobId, type: "generation", status: "failed", layer: "validation", sessionId, pages: plan.pages, createdAt: now(), validation }); await events.emit("validation.failed", { jobId, sessionId, slides: plan.pages.map((page) => page.id) }); return reply.code(422).send({ status: "failed", layer: "validation", jobId, slides: plan.pages.map((page) => page.id), ...validation }); }
    const targetDirectory = path.join(root, "svg_output"); await commitStagedImages(root, staging); await commitGeneratedSlides(root, interaction, jobId, plan.pages.map((page) => page.id)); await finalizeGeneratedContent(jobId, plan.pages);
    const revisions = Object.fromEntries(await Promise.all(plan.pages.map(async (page) => [page.id, await hashFile(path.join(targetDirectory, `${page.id}.svg`))]))); await atomicJson(path.join(jobDir, "request.json"), { jobId, type: "generation", status: "completed", sessionId, revisions }); const stateFile = path.join(interaction, "project_state.json"), state = await readJson<Record<string, unknown>>(stateFile, {}); await atomicJson(stateFile, { ...state, stage: "generation", deckStatus: "ready", timestamp: now() }); await events.emit("revision.committed", { jobId, sessionId, slides: plan.pages.map((page) => page.id), revisions }); await events.emit("generation.completed", { jobId, sessionId, slides: plan.pages.map((page) => page.id) }); return { jobId, status: "completed", slides: plan.pages.map((page) => page.id), revisions };
  } catch (error) { const message = error instanceof Error ? error.message : String(error); await atomicJson(path.join(jobDir, "request.json"), { jobId, type: "generation", status: "failed", layer: "generation", message }); await events.emit("generation.failed", { jobId, sessionId, message }); return reply.code(422).send({ status: "failed", error: message }); }
});
server.get("/api/workflow/page-plan", async () => { const plan = await readJson<{ schema?: string; pages?: { source_slide: number; svg?: string }[] }>(path.join(root, "page_plan.json"), {}); return { schema: plan.schema ?? null, pages: (plan.pages ?? []).map((page, index) => ({ outputPage: index + 1, sourceSlide: page.source_slide, svg: page.svg ?? `slide_${String(page.source_slide).padStart(2, "0")}.svg`, mode: page.svg ? "edited_or_copy" : "referenced" })) }; });
server.get("/api/sidecars", async () => { const items = []; for (const name of visibleSidecars) { const target = path.join(root, name); if (!(await exists(target))) continue; const metadata = await stat(target); items.push({ name, type: metadata.isDirectory() ? "directory" : "file", editable: editableSidecars.has(name), updatedAt: metadata.mtime.toISOString() }); } return { items }; });
server.get<{ Querystring: { name?: string } }>("/api/sidecar-content", async (request, reply) => { const name = request.query.name ?? ""; if (!visibleSidecars.includes(name) || name.includes("..")) return reply.code(400).send({ error: "unsupported sidecar" }); const file = path.join(root, name); if (!(await exists(file))) return reply.code(404).send({ error: "sidecar not found" }); const metadata = await stat(file); if (!metadata.isFile()) return reply.code(409).send({ error: "sidecar is a directory" }); const content = await readFile(file, "utf8"); return { name, content, revision: hashText(content), editable: editableSidecars.has(name) }; });
server.get<{ Params: { name: string } }>("/api/sidecars/:name", async (request, reply) => { const name = decodeURIComponent(request.params.name); if (!visibleSidecars.includes(name) || name.includes("..")) return reply.code(400).send({ error: "unsupported sidecar" }); const file = path.join(root, name); if (!(await exists(file))) return reply.code(404).send({ error: "sidecar not found" }); const metadata = await stat(file); if (!metadata.isFile()) return reply.code(409).send({ error: "sidecar is a directory" }); const content = await readFile(file, "utf8"); return { name, content, revision: hashText(content), editable: editableSidecars.has(name) }; });
server.put<{ Params: { name: string }; Body: { content: string; revision?: string } }>("/api/sidecars/:name", async (request, reply) => { const name = decodeURIComponent(request.params.name); if (!editableSidecars.has(name)) return reply.code(400).send({ error: "unsupported sidecar" }); const file = path.join(root, name); const previous = await exists(file) ? await readFile(file, "utf8") : ""; if (request.body.revision && request.body.revision !== hashText(previous)) return reply.code(409).send({ error: "sidecar changed since it was opened", revision: hashText(previous) }); let content: unknown; try { content = JSON.parse(request.body.content); } catch { return reply.code(422).send({ error: "sidecar must contain valid JSON" }); } await atomicJson(file, content); const saved = await readFile(file, "utf8"); await events.emit("export.stale", { sidecar: name }); return { name, status: "saved", revision: hashText(saved), deckRevision: await deckRevision(root) }; });
server.get("/api/accessories/notes", async () => { let roster = (await slideFiles(root)).map((name) => path.basename(name, ".svg")); if (!roster.length) { const plan = await readJson<{ pages?: { id: string }[] }>(path.join(interaction, "page_plan.json"), {}); roster = (plan.pages ?? []).map((page) => page.id); } const notes: Record<string, string> = {}; for (const slide of roster) { const file = path.join(root, "notes", `${slide}.md`); notes[slide] = await exists(file) ? await readFile(file, "utf8") : ""; } return { roster, notes, complete: roster.length > 0 && roster.every((slide) => notes[slide].trim()) }; });
server.post<{ Body: { slide?: string; intent?: string } }>("/api/accessories/notes/generate", async (request, reply) => { let roster = (await slideFiles(root)).map((name) => path.basename(name, ".svg")); if (!roster.length) { const plan = await readJson<{ pages?: { id: string }[] }>(path.join(interaction, "page_plan.json"), {}); roster = (plan.pages ?? []).map((page) => page.id); } if (!roster.length) return reply.code(409).send({ error: "暂无页面可生成讲稿" }); const targets = request.body.slide ? roster.filter((slide) => slide === request.body.slide) : roster; if (request.body.slide && !targets.length) return reply.code(404).send({ error: "页面不存在" }); const plan = await readJson<{ pages?: { id: string; role?: string; title?: string }[] }>(path.join(interaction, "page_plan.json"), {}); const pages = (plan.pages ?? []).filter((page) => targets.includes(page.id)); await finalizeGeneratedContent(`notes-${Date.now()}`, pages.length ? pages : targets.map((id) => ({ id }))); return { status: "completed", slides: targets }; });
server.put<{ Body: unknown }>("/api/accessories/notes", async (request, reply) => { const parsed = notesSchema.safeParse(request.body); if (!parsed.success) return reply.code(422).send({ error: "invalid speaker notes", issues: parsed.error.issues }); const roster = (await slideFiles(root)).map((name) => path.basename(name, ".svg")).sort(); if (JSON.stringify(Object.keys(parsed.data.notes).sort()) !== JSON.stringify(roster)) return reply.code(422).send({ error: "notes must exactly match the current slide roster" }); const notesDirectory = path.join(root, "notes"); await mkdir(notesDirectory, { recursive: true }); for (const slide of roster) await writeFile(path.join(notesDirectory, `${slide}.md`), `${parsed.data.notes[slide].trim()}\n`, "utf8"); const receipt = { kind: "notes", status: "completed", slides: roster, timestamp: now() }; await atomicJson(path.join(interaction, "notes_receipt.json"), receipt); await events.emit("accessory.completed", { kind: "notes", slideCount: roster.length }); await events.emit("export.stale", { sidecar: "notes" }); return receipt; });
server.get("/api/export/history", async () => ({ exports: (await readJsonl(path.join(interaction, "export_history.jsonl"))).reverse() }));
server.get("/api/slides", async () => {
  const labels: Record<string, string> = { ungenerated: "未生成", planning: "规划中", generating: "生成中", awaiting_confirmation: "待确认", generated: "已生成", modifying: "修改中", validation_failed: "检查失败", exportable: "可导出", exported: "已导出" };
  let directory: string | null = null; try { directory = await authoringDirectory(root); } catch { directory = null; }
  const existing = new Map<string, string>(); if (directory) for (const name of await slideFiles(root)) existing.set(path.basename(name, ".svg"), await hashFile(path.join(directory, name)));
  const plan = await readJson<{ status?: string; pages?: { id: string }[] }>(path.join(interaction, "page_plan.json"), {}), state = await readJson<Record<string, unknown>>(path.join(interaction, "project_state.json"), {}); let currentDeck: string | null = null; try { currentDeck = await deckRevision(root); } catch { currentDeck = null; }
  const active = new Map<string, string>(); for (const jobId of await readdir(path.join(interaction, "jobs"))) { const job = await readJson<{ status?: string; type?: string; targets?: { slide: string }[]; pages?: { id: string }[] }>(path.join(interaction, "jobs", jobId, "request.json"), {}); const jobSlides = [...(job.targets ?? []).map((target) => target.slide), ...(job.pages ?? []).map((page) => page.id)]; for (const slide of jobSlides) if (["executing", "validating", "committing", "exporting", "summarizing"].includes(job.status ?? "")) active.set(slide, job.status === "validating" ? "generating" : "modifying"); }
  const staging = new Map<string, string>(); for (const jobId of await readdir(path.join(interaction, "jobs"))) { const job = await readJson<{ status?: string }>(path.join(interaction, "jobs", jobId, "request.json"), {}); const directory = path.join(interaction, "jobs", jobId, "staging", "svg_output"); if (!(await exists(directory))) continue; for (const name of await readdir(directory)) if (name.endsWith(".svg")) staging.set(path.basename(name, ".svg"), job.status === "failed" ? "validation_failed" : "generated"); }
  const roster = [...new Set([...(plan.pages ?? []).map((page) => page.id), ...existing.keys()])];
  return { slides: roster.map((id) => { const revision = existing.get(id); let status = revision ? (state.exportRevision && state.exportRevision === currentDeck ? "exported" : "exportable") : active.get(id); if (!status) status = staging.get(id); if (!status) status = plan.status === "awaiting_confirmation" ? "awaiting_confirmation" : plan.status ? "planning" : "ungenerated"; return { id, revision: revision ?? null, status, statusLabel: labels[status] }; }) };
});
server.get<{ Params: { name: string } }>("/api/slides/images/:name", async (request, reply) => { const extension = path.extname(request.params.name).toLowerCase(); if (!safeId.safeParse(request.params.name).success || !imageMimeTypes[extension]) return reply.code(400).send({ error: "invalid image name" }); const file = path.join(root, "images", request.params.name); if (!(await exists(file))) return reply.code(404).send({ error: "image not found" }); return reply.type(imageMimeTypes[extension]).send(await readFile(file)); });
server.get<{ Params: { id: string } }>("/api/slides/:id/raw", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid slide id" }); const file = path.join(await authoringDirectory(root), `${request.params.id}.svg`); if (!(await exists(file))) return reply.code(404).send({ error: "slide not found" }); const svg = await readFile(file, "utf8"); const responsive = svg.replace(/<svg\b([^>]*)>/i, (_match, attrs) => `<svg${attrs.replace(/\swidth="[^"]*"/i, " width=\"100%\"").replace(/\sheight="[^"]*"/i, " height=\"100%\"")} preserveAspectRatio="xMidYMid meet">`); return reply.type("image/svg+xml").send(responsive); });
server.get<{ Params: { jobId: string; name: string } }>("/api/jobs/:jobId/staging/images/:name", async (request, reply) => { const extension = path.extname(request.params.name).toLowerCase(); if (!safeId.safeParse(request.params.jobId).success || !safeId.safeParse(request.params.name).success || !imageMimeTypes[extension]) return reply.code(400).send({ error: "invalid staging image reference" }); const file = path.join(interaction, "jobs", request.params.jobId, "staging", "images", request.params.name); if (!(await exists(file))) return reply.code(404).send({ error: "staging image not found" }); return reply.type(imageMimeTypes[extension]).send(await readFile(file)); });
server.get<{ Params: { jobId: string; id: string } }>("/api/jobs/:jobId/staging/:id/raw", async (request, reply) => { if (!safeId.safeParse(request.params.jobId).success || !safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid staging reference" }); const file = path.resolve(interaction, "jobs", request.params.jobId, "staging", "svg_output", `${request.params.id}.svg`); const stagingRoot = path.resolve(interaction, "jobs", request.params.jobId, "staging"); if (!file.startsWith(`${stagingRoot}${path.sep}`) || !(await exists(file))) return reply.code(404).send({ error: "staging slide not found" }); const svg = normalizeSvg(await readFile(file, "utf8")); if (/<script\b|\son\w+\s*=|javascript:/i.test(svg)) return reply.code(422).send({ error: "unsafe staging SVG" }); return reply.type("image/svg+xml").send(svg.replace(/<svg\b([^>]*)>/i, (_match, attrs) => `<svg${attrs.replace(/\swidth="[^"]*"/i, " width=\"100%\"").replace(/\sheight="[^"]*"/i, " height=\"100%\"")} preserveAspectRatio="xMidYMid meet">`)); });
server.get("/api/workflow/generation/staging", async () => { const candidates = []; for (const jobId of await readdir(path.join(interaction, "jobs"))) { const request = await readJson<{ type?: string; status?: string; createdAt?: string; pages?: { id: string }[]; validation?: unknown }>(path.join(interaction, "jobs", jobId, "request.json"), {}); if (request.type !== "generation") continue; const directory = path.join(interaction, "jobs", jobId, "staging", "svg_output"); if (!(await exists(directory))) continue; const slides = (await readdir(directory)).filter((name) => name.endsWith(".svg")).map((name) => path.basename(name, ".svg")); if (slides.length) candidates.push({ jobId, status: request.status, createdAt: request.createdAt, slides, validation: request.validation }); } return candidates.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null; });
server.addHook("preValidation", async (request) => { const match = request.url.match(/^\/api\/workflow\/generation\/([A-Za-z0-9_.-]+)\/repair$/); if (!match || request.method !== "POST") return; const jobFile = path.join(interaction, "jobs", match[1], "request.json"), job = await readJson<{ type?: string; pages?: { id: string }[] }>(jobFile, {}); if (job.type !== "generation" || job.pages?.length) return; const directory = path.join(interaction, "jobs", match[1], "staging", "svg_output"); if (!(await exists(directory))) return; const pages = (await readdir(directory)).filter((name) => name.endsWith(".svg")).sort().map((name) => ({ id: path.basename(name, ".svg") })); if (pages.length) await atomicJson(jobFile, { ...job, pages, recoveredAt: now() }); });
server.post<{ Params: { jobId: string }; Body: { provider?: "claude" | "codex"; intent?: string } }>("/api/workflow/generation/:jobId/repair", async (request, reply) => { if (!safeId.safeParse(request.params.jobId).success) return reply.code(400).send({ error: "invalid generation job" }); const jobFile = path.join(interaction, "jobs", request.params.jobId, "request.json"), job = await readJson<{ type?: string; status?: string; pages?: { id: string }[]; sessionId?: string }>(jobFile, {}); if (job.type !== "generation" || !job.pages?.length) return reply.code(404).send({ error: "generation job not found" }); const staging = path.join(interaction, "jobs", request.params.jobId, "staging"), provider = request.body.provider ?? "codex"; await atomicJson(jobFile, { ...job, status: "executing", repairIntent: request.body.intent, updatedAt: now() }); const checker = path.resolve(here, "../../scripts/svg_quality_checker.py"); const prompt = `Repair the generated SVG deck in svg_output according to this user request: ${request.body.intent ?? "Fix all validation errors"}. ${imagePreparationPrompt(staging)} Run python3 ${checker} ${staging} --quick-generate --stage final --json and continue repairing until it passes. Do not write outside staging.`; try { if (overrides.agent) await overrides.agent(provider, prompt, staging); else if (provider === "codex") await createNetworkedCodex().startThread({ workingDirectory: staging, skipGitRepoCheck: true }).run(prompt); else for await (const _message of query({ prompt, options: claudeExecutionOptions(staging) })) { /* consume */ } const validation = await runChecker(staging); if (validation.code !== 0) { await atomicJson(jobFile, { ...job, status: "failed", layer: "validation", validation, updatedAt: now() }); await events.emit("validation.failed", { jobId: request.params.jobId }); return reply.code(422).send({ status: "failed", layer: "validation", ...validation }); } await commitStagedImages(root, staging); await commitGeneratedSlides(root, interaction, request.params.jobId, job.pages.map((page) => page.id)); await atomicJson(jobFile, { ...job, status: "completed", repairedAt: now() }); await events.emit("revision.committed", { jobId: request.params.jobId, slides: job.pages.map((page) => page.id) }); await events.emit("generation.completed", { jobId: request.params.jobId, slides: job.pages.map((page) => page.id) }); return { status: "completed", jobId: request.params.jobId, slides: job.pages.map((page) => page.id) }; } catch (error) { const message = error instanceof Error ? error.message : String(error); await atomicJson(jobFile, { ...job, status: "failed", layer: "repair", message, updatedAt: now() }); return reply.code(422).send({ error: message }); } });
server.get<{ Params: { id: string } }>("/api/slides/:id", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid slide id" }); const file = path.join(await authoringDirectory(root), `${request.params.id}.svg`); if (!(await exists(file))) return reply.code(404).send({ error: "slide not found" }); return { id: request.params.id, revision: await hashFile(file), content: await readFile(file, "utf8") }; });
server.get<{ Params: { id: string } }>("/api/slides/:id/elements", async (request, reply) => {
  if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid slide id" });
  const file = path.join(await authoringDirectory(root), `${request.params.id}.svg`);
  if (!(await exists(file))) return reply.code(404).send({ error: "slide not found" });
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true }).parse(await readFile(file, "utf8"));
  const elements: Record<string, unknown>[] = [];
  const visit = (nodes: unknown, parentPath = "") => {
    if (!Array.isArray(nodes)) return;
    const counts = new Map<string, number>();
    for (const node of nodes as Record<string, unknown>[]) for (const [tag, value] of Object.entries(node)) {
      if (tag === ":@" || tag === "#text") continue;
      const index = (counts.get(tag) ?? 0) + 1; counts.set(tag, index);
      const structuralPath = `${parentPath}/${tag}[${index}]`;
      const attrs = node[":@"] as Record<string, unknown> | undefined;
      const text = typeof value === "string" ? value : JSON.stringify(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      if (attrs?.["@_id"]) {
        const numbers = ["x", "y", "width", "height"].map((key) => Number(attrs[`@_${key}`] ?? 0));
        elements.push({ id: String(attrs["@_id"]), tag, structuralPath, bbox: numbers, text, textDigest: hashText(text) });
      }
      visit(value, structuralPath);
    }
  };
  visit(parsed);
  return { slide: request.params.id, revision: await hashFile(file), elements };
});
server.post<{ Params: { id: string }; Body: { revision: string; elementId: string; tag?: string; structuralPath?: string; bbox?: number[]; textDigest?: string } }>("/api/slides/:id/resolve-element", async (request, reply) => {
  if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid slide id" });
  const file = path.join(await authoringDirectory(root), `${request.params.id}.svg`);
  if (!(await exists(file))) return reply.code(404).send({ error: "slide not found" });
  const currentRevision = await hashFile(file);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true }).parse(await readFile(file, "utf8"));
  const candidates: { id: string; tag: string; structuralPath: string; bbox: number[]; textDigest: string }[] = [];
  const visit = (nodes: unknown, parentPath = "") => { if (!Array.isArray(nodes)) return; const counts = new Map<string, number>(); for (const node of nodes as Record<string, unknown>[]) for (const [tag, value] of Object.entries(node)) { if (tag === ":@" || tag === "#text") continue; const index = (counts.get(tag) ?? 0) + 1; counts.set(tag, index); const structuralPath = `${parentPath}/${tag}[${index}]`; const attrs = node[":@"] as Record<string, unknown> | undefined; if (attrs?.["@_id"]) { const text = typeof value === "string" ? value : JSON.stringify(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 500); candidates.push({ id: String(attrs["@_id"]), tag, structuralPath, bbox: ["x", "y", "width", "height"].map((key) => Number(attrs[`@_${key}`] ?? 0)), textDigest: hashText(text) }); } visit(value, structuralPath); } };
  visit(parsed);
  if (request.body.revision === currentRevision) { const exact = candidates.find((candidate) => candidate.id === request.body.elementId); if (exact) return { status: "exact", confidence: 1, revision: currentRevision, element: exact }; return reply.code(409).send({ error: "element no longer exists in the bound revision" }); }
  const scored = candidates.map((candidate) => { let score = 0; if (request.body.structuralPath && candidate.structuralPath === request.body.structuralPath) score += 0.55; if (request.body.tag && candidate.tag === request.body.tag) score += 0.15; if (request.body.textDigest && candidate.textDigest === request.body.textDigest) score += 0.25; if (request.body.bbox?.length === 4) { const distance = candidate.bbox.reduce((sum, value, index) => sum + Math.abs(value - Number(request.body.bbox?.[index])), 0); score += Math.max(0, 0.15 - distance / 10000); } return { candidate, score }; }).sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best || best.score < 0.7 || (scored[1] && Math.abs(best.score - scored[1].score) < 0.05)) return reply.code(409).send({ error: "element reference is ambiguous or low confidence", candidates: scored.slice(0, 5).map((item) => ({ element: item.candidate, confidence: item.score })) });
  return { status: "relocated", confidence: best.score, revision: currentRevision, element: best.candidate };
});
server.get<{ Params: { id: string } }>("/api/slides/:id/annotations", async (request) => ({ slide: request.params.id, annotations: (await readJsonl(path.join(root, "live_preview", "annotations.jsonl"))).filter((item) => !item.slide || item.slide === request.params.id) }));
server.post<{ Params: { id: string }; Body: { text: string; region?: unknown; elementId?: string } }>("/api/slides/:id/annotations", async (request, reply) => { if (!request.body.text) return reply.code(422).send({ error: "annotation text is required" }); const value = { annotationId: id("ann"), slide: request.params.id, ...request.body, timestamp: now() }; await appendJsonl(path.join(root, "live_preview", "annotations.jsonl"), value); await events.emit("annotation.created", { slide: request.params.id, annotationId: value.annotationId }); return value; });
server.get<{ Params: { id: string } }>("/api/slides/:id/revisions", async (request) => { const directory = path.join(interaction, "revisions", request.params.id); const files = await exists(directory) ? (await readdir(directory)).filter((name) => name.endsWith(".svg")).sort().reverse() : []; return { slide: request.params.id, revisions: await Promise.all(files.map(async (name, index) => { const metadata = await stat(path.join(directory, name)); return { id: path.basename(name, ".svg"), label: `版本 ${files.length - index}`, createdAt: metadata.mtime.toISOString() }; })) }; });
server.get<{ Params: { id: string } }>("/api/slides/:id/staging-revisions", async (request) => { const revisions = []; for (const jobId of await readdir(path.join(interaction, "jobs"))) { const file = path.join(interaction, "jobs", jobId, "staging", "svg_output", `${request.params.id}.svg`); if (!(await exists(file))) continue; const metadata = await stat(file), job = await readJson<{ status?: string }>(path.join(interaction, "jobs", jobId, "request.json"), {}); revisions.push({ id: jobId, label: `生成暂存 · ${job.status ?? "unknown"}`, createdAt: metadata.mtime.toISOString(), kind: "staging", previewUrl: `/api/jobs/${jobId}/staging/${request.params.id}/raw` }); } return { slide: request.params.id, revisions: revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }; });
server.post<{ Params: { id: string; revision: string } }>("/api/slides/:id/revisions/:revision/restore", async (request, reply) => { const source = path.join(interaction, "revisions", request.params.id, `${request.params.revision}.svg`); if (!(await exists(source))) return reply.code(404).send({ error: "revision not found" }); const target = path.join(await authoringDirectory(root), `${request.params.id}.svg`); const archive = path.join(interaction, "revisions", request.params.id); await mkdir(archive, { recursive: true }); const currentBackup = path.join(archive, `${Date.now()}-${(await hashFile(target)).slice(7, 19)}.svg`); await copyFile(target, currentBackup); await rm(path.join(interaction, "redo", request.params.id), { recursive: true, force: true }); await copyFile(source, `${target}.tmp`); await rename(`${target}.tmp`, target); const current = await hashFile(target); await events.emit("revision.committed", { slide: request.params.id, revision: current, operation: "restore" }); await events.emit("export.stale", { slide: request.params.id }); return { slide: request.params.id, revision: current }; });
server.get<{ Params: { id: string } }>("/api/slides/:id/history-state", async (request, reply) => { if (!safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid slide id" }); const undoDirectory = path.join(interaction, "revisions", request.params.id), redoDirectory = path.join(interaction, "redo", request.params.id); const undo = await exists(undoDirectory) ? (await readdir(undoDirectory)).filter((name) => name.endsWith(".svg")).length : 0; const redo = await exists(redoDirectory) ? (await readdir(redoDirectory)).filter((name) => name.endsWith(".svg")).length : 0; return { slide: request.params.id, canUndo: undo > 0, canRedo: redo > 0, undo, redo }; });
server.post<{ Params: { id: string; operation: string } }>("/api/slides/:id/history/:operation", async (request, reply) => {
  if (!safeId.safeParse(request.params.id).success || !["undo", "redo"].includes(request.params.operation)) return reply.code(400).send({ error: "invalid history request" });
  const operation = request.params.operation as "undo" | "redo";
  const sourceDirectory = path.join(interaction, operation === "undo" ? "revisions" : "redo", request.params.id);
  const destinationDirectory = path.join(interaction, operation === "undo" ? "redo" : "revisions", request.params.id);
  const candidates = await exists(sourceDirectory) ? (await readdir(sourceDirectory)).filter((name) => name.endsWith(".svg")).sort() : [];
  const name = candidates.at(-1); if (!name) return reply.code(409).send({ error: `nothing to ${operation}` });
  const target = path.join(await authoringDirectory(root), `${request.params.id}.svg`); if (!(await exists(target))) return reply.code(404).send({ error: "slide not found" });
  await mkdir(destinationDirectory, { recursive: true });
  const currentBackup = path.join(destinationDirectory, `${Date.now()}-${(await hashFile(target)).slice(7, 19)}.svg`);
  await copyFile(target, currentBackup); await copyFile(path.join(sourceDirectory, name), `${target}.tmp`); await rename(`${target}.tmp`, target); await rm(path.join(sourceDirectory, name));
  const revision = await hashFile(target); await events.emit("revision.committed", { slide: request.params.id, revision, operation }); await events.emit("export.stale", { slide: request.params.id });
  return { slide: request.params.id, revision, operation };
});
server.get<{ Params: { scope: string; id: string } }>("/api/conversations/:scope/:id", async (request, reply) => { if (!conversationScope.safeParse(request.params.scope).success || !safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid conversation" }); const file = request.params.scope === "deck" ? path.join(interaction, "conversations", "deck.jsonl") : path.join(interaction, "conversations", "pages", `${request.params.id}.jsonl`); const messages = await readJsonl(file); return { messages, conversationRevision: hashText(JSON.stringify(messages)) }; });
server.post<{ Params: { scope: string; id: string }; Body: unknown }>("/api/conversations/:scope/:id/messages", async (request, reply) => {
  if (!conversationScope.safeParse(request.params.scope).success || !safeId.safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid conversation" });
  const parsed = messageSchema.safeParse(request.body); if (!parsed.success) return reply.code(422).send(parsed.error.flatten());
  const attachments = [];
  for (const attachment of parsed.data.attachments) { if (path.isAbsolute(attachment.path) || attachment.path.split(/[\\/]/).includes("..")) return reply.code(400).send({ error: "attachments must use project-relative paths" }); const resolved = path.resolve(root, attachment.path); if (!resolved.startsWith(`${root}${path.sep}`) || !(await exists(resolved))) return reply.code(400).send({ error: "attachment not found in project" }); attachments.push({ path: attachment.path, mimeType: attachment.mimeType ?? "application/octet-stream" }); }
  const message = { messageId: id("msg"), role: "user", content: parsed.data.content, attachments, timestamp: now() };
  const file = request.params.scope === "deck" ? path.join(interaction, "conversations", "deck.jsonl") : path.join(interaction, "conversations", "pages", `${request.params.id}.jsonl`);
  await appendJsonl(file, message); await events.emit("message.created", { conversationId: request.params.id, messageId: message.messageId }); const messages = await readJsonl(file); return { ...message, conversationRevision: hashText(JSON.stringify(messages)) };
});
server.post<{ Body: unknown }>("/api/jobs", async (request, reply) => {
  const parsed = requestSchema.safeParse(request.body); if (!parsed.success) return reply.code(422).send(parsed.error.flatten());
  let sessionId = parsed.data.sessionId;
  if (parsed.data.mode === "agent") {
    if (sessionId && !(await exists(path.join(interaction, "sessions", `${sessionId}.json`)))) return reply.code(404).send({ error: "session not found" });
  }
  let authoring: string; try { authoring = await authoringDirectory(root); } catch { return reply.code(409).send({ error: "the current route has no page editing workspace" }); }
  const targetSlides = [...new Set(parsed.data.targets.map((target) => target.slide))];
  const revisionSlides = Object.keys(parsed.data.baseRevisions).sort();
  if (JSON.stringify(targetSlides.slice().sort()) !== JSON.stringify(revisionSlides)) return reply.code(422).send({ error: "baseRevisions must exactly match target slides" });
  if (parsed.data.scope === "selection" && parsed.data.targets.some((target) => !target.elementRefs?.length)) return reply.code(422).send({ error: "selection scope requires elementRefs for every target" });
  if (parsed.data.scope === "region" && (parsed.data.targets.length !== 1 || !parsed.data.targets[0].region)) return reply.code(422).send({ error: "region scope requires one target with region" });
  if (["page", "selection", "region"].includes(parsed.data.scope) && targetSlides.length !== 1) return reply.code(422).send({ error: `${parsed.data.scope} scope requires exactly one slide` });
  for (const target of parsed.data.targets) for (const reference of target.elementRefs ?? []) if (reference.revision !== parsed.data.baseRevisions[target.slide]) return reply.code(422).send({ error: `element reference revision does not match ${target.slide}` });
  for (const [slide, expected] of Object.entries(parsed.data.baseRevisions)) {
    if (await hashFile(path.join(authoring, `${slide}.svg`)) !== expected) return reply.code(409).send({ error: `stale revision: ${slide}` });
  }
  const jobId = id("job"); const jobDir = path.join(interaction, "jobs", jobId); await mkdir(jobDir, { recursive: true });
  const layer = owningLayer(parsed.data.intent, parsed.data.scope);
  const requiresApproval = parsed.data.targets.length > 1 || ["plan", "spec"].includes(layer);
  const projectState = await readJson<Record<string, unknown>>(path.join(interaction, "project_state.json"), {});
  const defaultGenerate = ["generate-pptx", "Generate PPTX", "default-generate"].includes(String(projectState.route));
  const waitingWorkflow = defaultGenerate && projectState.editingReady !== true;
  const status = waitingWorkflow ? "waiting_workflow" : requiresApproval ? "awaiting_approval" : "queued";
  const job = { schemaVersion: 1, jobId, status, owningLayer: layer, requiresApproval, waitingWorkflow, ...parsed.data, ...(sessionId ? { sessionId } : {}) };
  const plan = {
    schemaVersion: 1,
    jobId,
    scope: parsed.data.scope,
    slides: targetSlides,
    targets: parsed.data.targets,
    owningLayer: layer,
    touches: { spec: layer === "spec", plan: layer === "plan", sidecar: layer === "sidecar" },
    preserve: ["unlisted slides", "existing route contract"],
    checks: ["svg_quality_checker", "route exporter"],
    requiresApproval,
  };
  await atomicJson(path.join(jobDir, "request.json"), job);
  await atomicJson(path.join(jobDir, "plan.json"), plan);
  await events.emit("job.created", { jobId, ...(sessionId ? { sessionId } : {}) });
  await events.emit("job.plan_ready", { jobId, plan, ...(sessionId ? { sessionId } : {}) });
  if (requiresApproval) await events.emit("gate.required", { jobId, owningLayer: layer });
  return { jobId, status, ...(sessionId ? { sessionId } : {}) };
});
server.post("/api/workflow/edits-ready", async () => {
  const stateFile = path.join(interaction, "project_state.json");
  const state = await readJson<Record<string, unknown>>(stateFile, {});
  await atomicJson(stateFile, { ...state, editingReady: true, editingReadyAt: now() });
  const released: string[] = [];
  for (const jobId of await readdir(path.join(interaction, "jobs"))) {
    const jobFile = path.join(interaction, "jobs", jobId, "request.json");
    const job = await readJson<Record<string, unknown>>(jobFile, {});
    if (job.status !== "waiting_workflow") continue;
    const status = job.requiresApproval ? "awaiting_approval" : "queued";
    await atomicJson(jobFile, { ...job, status, waitingWorkflow: false });
    await events.emit("job.released", { jobId, status });
    released.push(jobId);
  }
  return { editingReady: true, released };
});
server.post<{ Body: unknown }>("/api/jobs/impact", async (request, reply) => { const parsed = requestSchema.safeParse(request.body); if (!parsed.success) return reply.code(422).send(parsed.error.flatten()); const slides = parsed.data.targets.map((target) => target.slide); const layer = owningLayer(parsed.data.intent, parsed.data.scope); return { scope: parsed.data.scope, slides, owningLayer: layer, requiresApproval: slides.length > 1 || ["plan", "spec"].includes(layer), preserve: ["unlisted slides", "existing route contract"], checks: ["svg_quality_checker", "route exporter"] }; });
server.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => { const file = path.join(interaction, "jobs", request.params.id, "request.json"); if (!(await exists(file))) return reply.code(404).send({ error: "job not found" }); return { request: await readJson(file, {}), plan: await readJson(path.join(path.dirname(file), "plan.json"), null), events: await readJsonl(path.join(path.dirname(file), "events.jsonl")), receipts: await readJson(path.join(path.dirname(file), "receipts.json"), {}) }; });
server.post<{ Params: { id: string } }>("/api/jobs/:id/file-handoff", async (request, reply) => {
  const jobDir = path.join(interaction, "jobs", request.params.id), jobFile = path.join(jobDir, "request.json");
  if (!(await exists(jobFile))) return reply.code(404).send({ error: "job not found" });
  const job = await readJson<Record<string, unknown>>(jobFile, {});
  if (!["queued", "approved", "failed"].includes(String(job.status))) return reply.code(409).send({ error: "job is not ready for file handoff" });
  const staging = await prepareStaging(root, interaction, request.params.id, ((job.targets as { slide: string }[] | undefined) ?? []).map((target) => target.slide));
  const envelope = { schemaVersion: 1, jobId: request.params.id, status: "waiting_agent", request: job, stagingRoot: staging, responseFile: path.join(jobDir, "outbox", "response.json"), createdAt: now() };
  await atomicJson(path.join(jobDir, "inbox", "request.json"), envelope); await atomicJson(jobFile, { ...job, status: "waiting_agent", gateway: "file" }); await events.emit("job.handoff_ready", { jobId: request.params.id, gateway: "file" }); return envelope;
});
server.post<{ Params: { id: string } }>("/api/jobs/:id/file-response", async (request, reply) => {
  const jobDir = path.join(interaction, "jobs", request.params.id), jobFile = path.join(jobDir, "request.json"), responseFile = path.join(jobDir, "outbox", "response.json");
  if (!(await exists(jobFile))) return reply.code(404).send({ error: "job not found" });
  const job = await readJson<{ status?: string; targets?: { slide: string }[]; exportAfter?: boolean; intent?: string }>(jobFile, {});
  if (job.status !== "waiting_agent") return reply.code(409).send({ error: "job is not waiting for a file response" });
  if (!(await exists(responseFile))) return reply.code(404).send({ error: "file response not found" });
  const response = await readJson<{ status?: string; text?: string }>(responseFile, {});
  if (response.status !== "completed") { await atomicJson(jobFile, { ...job, status: "failed", failure: response }); await events.emit("job.failed", { jobId: request.params.id, layer: "agent" }); return reply.code(422).send(response); }
  const slides = [...new Set((job.targets ?? []).map((target) => target.slide))], staging = path.join(jobDir, "staging"), stagingAuthoring = await authoringDirectory(staging);
  const scopeError = await verifyScope(job, await authoringDirectory(root), stagingAuthoring); if (scopeError) return reply.code(422).send({ error: scopeError, layer: "scope" });
  await atomicJson(jobFile, { ...job, status: "validating" }); await events.emit("validation.started", { jobId: request.params.id }); const validation = await runChecker(staging); if (validation.code !== 0) { await atomicJson(jobFile, { ...job, status: "failed", failure: validation }); await events.emit("validation.failed", { jobId: request.params.id }); return reply.code(422).send(validation); }
  await events.emit("validation.passed", { jobId: request.params.id }); await commitStaging(root, interaction, request.params.id, slides); await events.emit("revision.committed", { jobId: request.params.id, slides });
  let exportReceipt = null; if (job.exportAfter) { await events.emit("export.started", { jobId: request.params.id }); const exported = await runExporter(); if (exported.code !== 0) return reply.code(422).send(exported.receipt); exportReceipt = exported.receipt; }
  const memoryCandidate = job.exportAfter ? await createMemoryCandidate(request.params.id, job, response.text ?? "") : null; const completed = { status: "completed", provider: "file", text: response.text ?? "", exportReceipt, memoryCandidate }; await atomicJson(jobFile, { ...job, status: "completed", response: completed }); await events.emit("job.completed", { jobId: request.params.id }); return completed;
});
server.get<{ Params: { id: string } }>("/api/jobs/:id/diff", async (request, reply) => {
  const jobFile = path.join(interaction, "jobs", request.params.id, "request.json");
  if (!(await exists(jobFile))) return reply.code(404).send({ error: "job not found" });
  const job = await readJson<{ targets?: { slide: string }[]; status?: string }>(jobFile, {});
  const commit = await readJson<{ backups?: Record<string, string> }>(path.join(interaction, "jobs", request.params.id, "commit.json"), {});
  const projectAuthoring = await authoringDirectory(root);
  const stagingAuthoring = path.join(interaction, "jobs", request.params.id, "staging", path.basename(projectAuthoring));
  const slides = [];
  for (const slide of [...new Set((job.targets ?? []).map((target) => target.slide))]) {
    const committedBackup = commit.backups?.[slide];
    const beforeFile = committedBackup && await exists(committedBackup) ? committedBackup : path.join(projectAuthoring, `${slide}.svg`), afterFile = path.join(stagingAuthoring, `${slide}.svg`);
    if (!(await exists(afterFile))) { slides.push({ slide, available: false }); continue; }
    const before = await readFile(beforeFile, "utf8"), after = await readFile(afterFile, "utf8");
    slides.push({ slide, available: true, changed: before !== after, beforeRevision: await hashFile(beforeFile), afterRevision: await hashFile(afterFile), before, after });
  }
  return { jobId: request.params.id, status: job.status ?? "unknown", settled: ["completed", "failed", "awaiting_approval"].includes(job.status ?? ""), slides };
});
server.post<{ Params: { id: string } }>("/api/jobs/:id/poll", async (request, reply) => { const file = path.join(interaction, "jobs", request.params.id, "request.json"); if (!(await exists(file))) return reply.code(404).send({ error: "job not found" }); const data = await readJson<Record<string, unknown>>(file, {}); return { jobId: request.params.id, status: data.status ?? "queued", response: data.response ?? null }; });
server.post<{ Params: { id: string } }>("/api/jobs/:id/approve", async (request, reply) => { const file = path.join(interaction, "jobs", request.params.id, "request.json"); if (!(await exists(file))) return reply.code(404).send({ error: "job not found" }); const data = await readJson<Record<string, unknown>>(file, {}); if (data.status !== "awaiting_approval") return reply.code(409).send({ error: "job is not awaiting approval" }); data.status = "approved"; await atomicJson(file, data); await events.emit("gate.approved", { jobId: request.params.id }); return { jobId: request.params.id, status: "approved" }; });
server.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request, reply) => { const file = path.join(interaction, "jobs", request.params.id, "request.json"); if (!(await exists(file))) return reply.code(404).send({ error: "job not found" }); const data = await readJson<Record<string, unknown>>(file, {}); const running = ["executing", "validating", "committing", "exporting", "summarizing"].includes(String(data.status)); if (!["queued", "waiting_workflow", "awaiting_approval", "approved", "failed"].includes(String(data.status)) && !running) return reply.code(409).send({ error: "job can no longer be canceled" }); data.status = running ? "canceling" : "canceled"; data.cancelRequestedAt = now(); await atomicJson(file, data); activeRuns.get(request.params.id)?.abort(); await events.emit(running ? "run.cancel_requested" : "job.canceled", { jobId: request.params.id, ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}) }); return { jobId: request.params.id, status: data.status }; });
server.post<{ Params: { id: string }; Body: { slides: Record<string, string> } }>("/api/jobs/:id/run-direct", async (request, reply) => {
  const jobFile = path.join(interaction, "jobs", request.params.id, "request.json");
  if (!(await exists(jobFile))) return reply.code(404).send({ error: "job not found" });
  const job = await readJson<{ scope?: string; targets: { slide: string; elementRefs?: { elementId: string }[]; region?: { x: number; y: number; width: number; height: number } }[]; baseRevisions: Record<string, string>; mode?: string; status?: string; exportAfter?: boolean }>(jobFile, { targets: [], baseRevisions: {} });
  if (!['direct', 'auto'].includes(job.mode ?? '')) return reply.code(409).send({ error: "job is not a direct edit" });
  if (!['queued', 'approved', 'failed'].includes(job.status ?? '')) return reply.code(409).send({ error: "job is not ready for direct execution" });
  const targetSlides = [...new Set(job.targets.map((target) => target.slide))];
  if (JSON.stringify(Object.keys(request.body.slides ?? {}).sort()) !== JSON.stringify(targetSlides.slice().sort())) return reply.code(422).send({ error: "direct payload must include every target slide exactly once" });
  for (const slide of targetSlides) if (await hashFile(path.join(await authoringDirectory(root), `${slide}.svg`)) !== job.baseRevisions[slide]) return reply.code(409).send({ error: `stale revision: ${slide}` });
  const staging = await prepareStaging(root, interaction, request.params.id, targetSlides);
  const stagingAuthoring = await authoringDirectory(staging);
  for (const slide of targetSlides) { const content = request.body.slides[slide]; if (!/^\s*<svg[\s>]/i.test(content) || /<script\b|\son\w+\s*=|javascript:/i.test(content)) return reply.code(422).send({ error: `unsafe SVG payload: ${slide}` }); await writeFile(path.join(stagingAuthoring, `${slide}.svg`), content, "utf8"); }
  const scopeError = await verifyScope(job, await authoringDirectory(root), stagingAuthoring); if (scopeError) return reply.code(422).send({ error: scopeError, layer: "scope" });
  await atomicJson(jobFile, { ...job, status: "validating" }); await events.emit("validation.started", { jobId: request.params.id });
  const validation = await runChecker(staging); if (validation.code !== 0) { await atomicJson(jobFile, { ...job, status: "failed", failure: { layer: "validation", ...validation } }); await events.emit("validation.failed", { jobId: request.params.id }); return reply.code(422).send({ status: "failed", layer: "validation", ...validation }); }
  await events.emit("validation.passed", { jobId: request.params.id }); await atomicJson(jobFile, { ...job, status: "committing" }); await commitStaging(root, interaction, request.params.id, targetSlides); await events.emit("revision.committed", { jobId: request.params.id, slides: targetSlides });
  let exportReceipt = null; if (job.exportAfter) { await atomicJson(jobFile, { ...job, status: "exporting" }); await events.emit("export.started", { jobId: request.params.id }); const exported = await runExporter(); if (exported.code !== 0) return reply.code(422).send({ status: "failed", layer: "export", ...exported.receipt }); exportReceipt = exported.receipt; }
  const response = { status: "completed", provider: "direct", exportReceipt }; await atomicJson(jobFile, { ...job, status: "completed", response }); await events.emit("job.completed", { jobId: request.params.id }); return response;
});
server.post<{ Params: { id: string }; Body: { provider: "claude" | "codex" } }>("/api/jobs/:id/run-agent", async (request, reply) => {
  const jobFile = path.join(interaction, "jobs", request.params.id, "request.json");
  if (!(await exists(jobFile))) return reply.code(404).send({ error: "job not found" });
  const job = await readJson<{ scope?: string; targets: { slide: string; elementRefs?: { elementId: string }[]; region?: { x: number; y: number; width: number; height: number } }[]; status?: string; requiresApproval?: boolean; exportAfter?: boolean; intent?: string; sessionId?: string }>(jobFile, { targets: [] });
  if (!job.sessionId) {
    job.sessionId = id("session"); const timestamp = now();
    const implicitSession = { schemaVersion: 1, sessionId: job.sessionId, kind: request.body.provider, purpose: "page_revision", context: { implicit: true }, status: "idle", createdAt: timestamp, updatedAt: timestamp };
    await atomicJson(path.join(interaction, "sessions", `${job.sessionId}.json`), implicitSession);
    await atomicJson(jobFile, job);
    await events.emit("session.created", { sessionId: job.sessionId, kind: request.body.provider, purpose: "page_revision" });
  }
  const sessionFile = path.join(interaction, "sessions", `${job.sessionId}.json`);
  if (!(await exists(sessionFile))) return reply.code(409).send({ error: "bound session is unavailable" });
  const session = await readJson<Record<string, unknown>>(sessionFile, {});
  if (session.status === "canceled") return reply.code(409).send({ error: "bound session is canceled" });
  if (session.kind !== request.body.provider) return reply.code(409).send({ error: "provider does not match bound session" });
  if (job.status === "waiting_workflow") return reply.code(409).send({ error: "job is waiting for the owning workflow to finish export" });
  if (job.requiresApproval && job.status !== "approved") return reply.code(409).send({ error: "job requires approval" });
  if (["executing", "validating", "committing"].includes(job.status ?? "")) return reply.code(409).send({ error: "job is already running" });
  const slides = [...new Set(job.targets.map((target) => target.slide))];
  const staging = await prepareStaging(root, interaction, request.params.id, slides);
  const stagingAuthoring = await authoringDirectory(staging);
  const decisions = await readJsonl(path.join(interaction, "memory", "decisions.jsonl"));
  const latestMemory = new Map<string, Record<string, unknown>>();
  for (const decision of decisions) latestMemory.set(String(decision.candidateId), decision);
  const memories = [...latestMemory.values()].filter((item) => item.status === "accepted" && (!item.slide || slides.includes(String(item.slide))));
  const memoryContext = memories.map((item) => `- ${item.trigger}: ${item.lesson}`).join("\n");
  const checkerCommand = !(await exists(path.join(staging, "spec_lock.md"))) ? `python3 ${checker} ${staging} --quick-generate --stage final --json` : `python3 ${checker} ${staging}`;
  const prompt = `${await readFile(jobFile, "utf8")}\n\nAccepted project memories:\n${memoryContext || "(none)"}\n\nOnly edit SVG files under ${stagingAuthoring}. Do not edit the source project. Do not run svg_to_pptx.py, create PPTX exports, or move/replace svg_output: the Studio server exclusively owns commit and export after your edits return. ${imagePreparationPrompt(staging)} Before finishing, run this exact validation command and repair the authored SVG until it exits successfully:\n${checkerCommand}`;
  await atomicJson(jobFile, { ...job, status: "executing", provider: request.body.provider });
  const abortController = new AbortController(); activeRuns.set(request.params.id, abortController);
  await atomicJson(sessionFile, { ...session, status: "running", activeJobId: request.params.id, updatedAt: now() });
  await events.emit("job.execution_started", { jobId: request.params.id, sessionId: job.sessionId, provider: request.body.provider });
  const releaseSession = async (lastStatus: "completed" | "failed") => { activeRuns.delete(request.params.id); const current = await readJson<Record<string, unknown>>(sessionFile, session); await atomicJson(sessionFile, { ...current, status: "idle", activeJobId: null, lastJobId: request.params.id, lastStatus, updatedAt: now() }); };
  const fail = async (layer: string, error: unknown, receipt: Record<string, unknown> = {}) => {
    activeRuns.delete(request.params.id);
    if (abortController.signal.aborted) { const canceled = { status: "canceled", layer: "agent", timestamp: now() }; await atomicJson(jobFile, { ...job, ...canceled }); await releaseSession("failed"); await events.emit("run.canceled", { jobId: request.params.id, sessionId: job.sessionId }); return reply.code(409).send(canceled); }
    const message = error instanceof Error ? error.message : String(error);
    const failure = { status: "failed", layer, message, retryable: true, timestamp: now(), ...receipt };
    await atomicJson(jobFile, { ...job, status: "failed", failure });
    await atomicJson(path.join(path.dirname(jobFile), "receipts.json"), { failure });
    await releaseSession("failed");
    await events.emit("job.failed", { jobId: request.params.id, sessionId: job.sessionId, layer, message });
    return reply.code(422).send(failure);
  };
  try {
  if (overrides.agent) {
    const text = await overrides.agent(request.body.provider, prompt, staging);
    const scopeError = await verifyScope(job, await authoringDirectory(root), stagingAuthoring); if (scopeError) return fail("scope", scopeError);
    await atomicJson(jobFile, { ...job, status: "validating", provider: request.body.provider }); await events.emit("validation.started", { jobId: request.params.id });
    const validation = await runChecker(staging); if (validation.code !== 0) return fail("validation", "checker failed", validation);
    await events.emit("validation.passed", { jobId: request.params.id }); await atomicJson(jobFile, { ...job, status: "committing", provider: request.body.provider }); await commitStagedImages(root, staging); await commitStaging(root, interaction, request.params.id, slides); await events.emit("revision.committed", { jobId: request.params.id, slides });
    let exportReceipt = null; if (job.exportAfter) { await atomicJson(jobFile, { ...job, status: "exporting" }); await events.emit("export.started", { jobId: request.params.id }); const exported = await runExporter(); if (exported.code !== 0) return fail("export", "exporter failed", exported.receipt); exportReceipt = exported.receipt; }
    await atomicJson(jobFile, { ...job, status: "summarizing" }); const memoryCandidate = job.exportAfter ? await createMemoryCandidate(request.params.id, job, text) : null; const response = { status: "completed", provider: request.body.provider, text, exportReceipt, memoryCandidate }; await atomicJson(jobFile, { ...job, status: "completed", response }); await releaseSession("completed"); await events.emit("job.completed", { jobId: request.params.id, sessionId: job.sessionId }); return response;
  }
  if (request.body.provider === "codex") {
    const codex = createNetworkedCodex();
    const thread = typeof session.nativeSessionId === "string" ? codex.resumeThread(session.nativeSessionId) : codex.startThread({ workingDirectory: staging, skipGitRepoCheck: true });
    const turn = await thread.run(prompt, { signal: abortController.signal });
    if (thread.id && session.nativeSessionId !== thread.id) await atomicJson(sessionFile, { ...await readJson<Record<string, unknown>>(sessionFile, session), nativeSessionId: thread.id, updatedAt: now() });
    const scopeError = await verifyScope(job, await authoringDirectory(root), stagingAuthoring); if (scopeError) return fail("scope", scopeError);
    await atomicJson(jobFile, { ...job, status: "validating", provider: request.body.provider });
    await events.emit("validation.started", { jobId: request.params.id });
    const validation = await runChecker(staging); if (validation.code !== 0) { await events.emit("validation.failed", { jobId: request.params.id }); return fail("validation", "checker failed", validation); }
    await events.emit("validation.passed", { jobId: request.params.id });
    await atomicJson(jobFile, { ...job, status: "committing", provider: request.body.provider });
    await commitStagedImages(root, staging); await commitStaging(root, interaction, request.params.id, slides);
    await events.emit("revision.committed", { jobId: request.params.id, slides });
    let exportReceipt = null;
    if (job.exportAfter) { await atomicJson(jobFile, { ...job, status: "exporting" }); await events.emit("export.started", { jobId: request.params.id }); const exported = await runExporter(); if (exported.code !== 0) return fail("export", "exporter failed", exported.receipt); exportReceipt = exported.receipt; }
    await atomicJson(jobFile, { ...job, status: "summarizing" });
    const memoryCandidate = job.exportAfter ? await createMemoryCandidate(request.params.id, job, turn.finalResponse) : null;
    const response = { status: "completed", provider: "codex", text: turn.finalResponse, exportReceipt, memoryCandidate };
    await atomicJson(jobFile, { ...job, status: "completed", response }); await releaseSession("completed"); await events.emit("job.completed", { jobId: request.params.id, sessionId: job.sessionId });
    return response;
  }
  let text = "", nativeSessionId = typeof session.nativeSessionId === "string" ? session.nativeSessionId : undefined; for await (const message of query({ prompt, options: claudeExecutionOptions(staging, { abortController, ...(nativeSessionId ? { resume: nativeSessionId } : {}) }) })) { if (typeof message.session_id === "string") nativeSessionId = message.session_id; if (message.type === "result" && message.subtype === "success") text = message.result; }
  if (nativeSessionId && session.nativeSessionId !== nativeSessionId) await atomicJson(sessionFile, { ...await readJson<Record<string, unknown>>(sessionFile, session), nativeSessionId, updatedAt: now() });
  const scopeError = await verifyScope(job, await authoringDirectory(root), stagingAuthoring); if (scopeError) return fail("scope", scopeError);
  await atomicJson(jobFile, { ...job, status: "validating", provider: request.body.provider });
  await events.emit("validation.started", { jobId: request.params.id });
  const validation = await runChecker(staging); if (validation.code !== 0) { await events.emit("validation.failed", { jobId: request.params.id }); return fail("validation", "checker failed", validation); }
  await events.emit("validation.passed", { jobId: request.params.id });
  await atomicJson(jobFile, { ...job, status: "committing", provider: request.body.provider });
  await commitStagedImages(root, staging); await commitStaging(root, interaction, request.params.id, slides);
  await events.emit("revision.committed", { jobId: request.params.id, slides });
  let exportReceipt = null;
  if (job.exportAfter) { await atomicJson(jobFile, { ...job, status: "exporting" }); await events.emit("export.started", { jobId: request.params.id }); const exported = await runExporter(); if (exported.code !== 0) return fail("export", "exporter failed", exported.receipt); exportReceipt = exported.receipt; }
  await atomicJson(jobFile, { ...job, status: "summarizing" });
  const memoryCandidate = job.exportAfter ? await createMemoryCandidate(request.params.id, job, text) : null;
  const response = { status: "completed", provider: "claude", text, exportReceipt, memoryCandidate };
  await atomicJson(jobFile, { ...job, status: "completed", response }); await releaseSession("completed"); await events.emit("job.completed", { jobId: request.params.id, sessionId: job.sessionId });
  return response;
  } catch (error) {
    return fail("agent", error);
  }
});
server.post("/api/export", async () => { const deck = await deckRevision(root); const stateFile = path.join(interaction, "project_state.json"); const state = await readJson<Record<string, unknown>>(stateFile, {}); await atomicJson(stateFile, { ...state, exportRevision: null, exportTarget: deck, exportStatus: "requested", timestamp: now() }); await events.emit("export.started", { deckRevision: deck }); return { status: "requested", deckRevision: deck }; });
server.post("/api/export/run", async (_request, reply) => {
  let authoring: string; try { authoring = await authoringDirectory(root); } catch { return reply.code(409).send({ error: "当前项目没有已提交的 SVG；请先在对话面板修复生成结果并通过检查" }); }
  if (!(await slideFiles(root)).length || !(await exists(authoring))) return reply.code(409).send({ error: "当前项目没有已提交的 SVG；staging 预览不能直接导出，请先修复并提交" });
  const result = await runExporter();
  return reply.code(result.code === 0 ? 200 : 422).send({ status: result.status, ...result.receipt, ...(result.code === 0 ? { downloadUrl: "/api/export/download" } : {}) });
});
server.get("/api/export/download", async (_request, reply) => { const receipt = await readJson<{ outputFile?: string | null }>(path.join(interaction, "export_receipt.json"), {}); if (!receipt.outputFile) return reply.code(404).send({ error: "no exported PPTX is available" }); const exportsRoot = path.resolve(root, "exports"); const outputFile = path.resolve(receipt.outputFile); if (path.dirname(outputFile) !== exportsRoot || path.extname(outputFile).toLowerCase() !== ".pptx" || !(await exists(outputFile))) return reply.code(404).send({ error: "exported PPTX is unavailable" }); return reply.header("content-disposition", `attachment; filename="${path.basename(outputFile)}"`).type("application/vnd.openxmlformats-officedocument.presentationml.presentation").sendFile(path.basename(outputFile), exportsRoot); });
server.get<{ Params: { id: string } }>("/api/export/history/:id/download", async (request, reply) => { const record = (await readJsonl(path.join(interaction, "export_history.jsonl")) as Array<{ historyId?: string; outputFile?: string | null }>).find((item) => item.historyId === request.params.id); if (!record?.outputFile) return reply.code(404).send({ error: "historical export is unavailable" }); const exportsRoot = path.resolve(root, "exports"); const outputFile = path.resolve(record.outputFile); if (path.dirname(outputFile) !== exportsRoot || path.extname(outputFile).toLowerCase() !== ".pptx" || !(await exists(outputFile))) return reply.code(404).send({ error: "historical export is unavailable" }); return reply.header("content-disposition", `attachment; filename="${path.basename(outputFile)}"`).type("application/vnd.openxmlformats-officedocument.presentationml.presentation").sendFile(path.basename(outputFile), exportsRoot); });
server.post<{ Body: { status: "completed" | "failed"; deckRevision: string } }>("/api/export/result", async (request, reply) => { const current = await deckRevision(root); if (request.body.deckRevision !== current) return reply.code(409).send({ error: "export revision is stale" }); const stateFile = path.join(interaction, "project_state.json"); const previous = await readJson<Record<string, unknown>>(stateFile, {}); const state = { ...previous, exportRevision: request.body.status === "completed" ? current : null, exportStatus: request.body.status, timestamp: now() }; await atomicJson(stateFile, state); await events.emit(`export.${request.body.status}`, { deckRevision: current }); return state; });
server.post("/api/validate", async (_request, reply) => {
  let hasPages = false; try { hasPages = (await slideFiles(root)).length > 0; } catch { hasPages = false; }
  if (!hasPages) {
    let candidate: { jobId: string; pages: { id: string }[]; createdAt?: string } | null = null;
    for (const jobId of await readdir(path.join(interaction, "jobs"))) { const job = await readJson<{ type?: string; status?: string; pages?: { id: string }[]; createdAt?: string }>(path.join(interaction, "jobs", jobId, "request.json"), {}); const staging = path.join(interaction, "jobs", jobId, "staging", "svg_output"); if (job.type === "generation" && job.pages?.length && await exists(staging) && (!candidate || String(job.createdAt).localeCompare(String(candidate.createdAt)) > 0)) candidate = { jobId, pages: job.pages, createdAt: job.createdAt }; }
    if (candidate) { const staging = path.join(interaction, "jobs", candidate.jobId, "staging"); const result = await runChecker(staging); if (result.code === 0) { await commitStagedImages(root, staging); await commitGeneratedSlides(root, interaction, candidate.jobId, candidate.pages.map((page) => page.id)); await atomicJson(path.join(interaction, "jobs", candidate.jobId, "request.json"), { type: "generation", jobId: candidate.jobId, status: "completed", pages: candidate.pages, completedAt: now() }); await events.emit("revision.committed", { jobId: candidate.jobId, slides: candidate.pages.map((page) => page.id) }); await events.emit("validation.passed", { returncode: 0 }); return { status: "passed", returncode: 0, stdout: result.stdout, stderr: result.stderr }; } return reply.code(422).send({ status: "failed", returncode: result.code, stdout: result.stdout, stderr: result.stderr }); }
    return { status: "not_started", returncode: 0, stdout: "No pages generated yet", stderr: "" };
  }
  const result = await runChecker(root); await events.emit(result.code === 0 ? "validation.passed" : "validation.failed", { returncode: result.code }); return reply.code(result.code === 0 ? 200 : 422).send({ status: result.code === 0 ? "passed" : "failed", returncode: result.code, stdout: result.stdout, stderr: result.stderr });
});
server.get("/api/memory/candidates", async () => { const latest = new Map<string, Record<string, unknown>>(); for (const candidate of await readJsonl(path.join(interaction, "memory", "candidates.jsonl"))) latest.set(String(candidate.candidateId), candidate); for (const decision of await readJsonl(path.join(interaction, "memory", "decisions.jsonl"))) latest.set(String(decision.candidateId), decision); return { candidates: [...latest.values()] }; });
server.post<{ Body: { trigger: string; lesson: string; scope?: string; evidence?: unknown; exceptions?: string[]; confidence?: number } }>("/api/memory/candidates", async (request, reply) => { if (!request.body.trigger || !request.body.lesson) return reply.code(422).send({ error: "trigger and lesson are required" }); const candidate = { schemaVersion: 1, candidateId: id("mem"), scope: request.body.scope ?? "project", trigger: request.body.trigger, lesson: request.body.lesson, evidence: request.body.evidence ?? {}, exceptions: request.body.exceptions ?? [], confidence: request.body.confidence ?? 0.5, status: "proposed" }; await appendJsonl(path.join(interaction, "memory", "candidates.jsonl"), candidate); await events.emit("memory.candidate_created", { candidateId: candidate.candidateId }); return candidate; });
server.get<{ Querystring: { scope?: string; slide?: string } }>("/api/memory/search", async (request) => {
  const decisions = await readJsonl(path.join(interaction, "memory", "decisions.jsonl"));
  const latest = new Map<string, Record<string, unknown>>();
  for (const decision of decisions) latest.set(String(decision.candidateId), decision);
  const memories = [...latest.values()].filter((item) => item.status === "accepted" && (!request.query.scope || item.scope === request.query.scope || item.scope === "project") && (!item.slide || item.slide === request.query.slide));
  return { memories };
});
server.patch<{ Params: { id: string }; Body: { trigger?: string; lesson?: string; scope?: string; exceptions?: string[]; confidence?: number } }>("/api/memory/candidates/:id", async (request, reply) => {
  const candidate = (await readJsonl(path.join(interaction, "memory", "candidates.jsonl"))).find((item) => item.candidateId === request.params.id);
  if (!candidate) return reply.code(404).send({ error: "candidate not found" });
  const edited = { ...candidate, ...request.body, status: "proposed", editedAt: now() };
  await appendJsonl(path.join(interaction, "memory", "candidates.jsonl"), edited);
  return edited;
});
server.post<{ Params: { id: string; decision: string } }>("/api/memory/candidates/:id/:decision", async (request, reply) => {
  if (!["accept", "reject", "withdraw"].includes(request.params.decision)) return reply.code(400).send({ error: "invalid decision" });
  const candidates = await readJsonl(path.join(interaction, "memory", "candidates.jsonl"));
  const candidate = candidates.filter((item) => item.candidateId === request.params.id).at(-1);
  if (!candidate) return reply.code(404).send({ error: "candidate not found" });
  const status = request.params.decision === "accept" ? "accepted" : request.params.decision === "reject" ? "rejected" : "withdrawn";
  const decided = { ...candidate, status, timestamp: now() };
  await appendJsonl(path.join(interaction, "memory", "decisions.jsonl"), decided);
  if (status === "accepted") await appendJsonl(path.join(interaction, "memory", "accepted", candidate.scope === "global" ? "recipes.jsonl" : "project.jsonl"), decided);
  await events.emit(`memory.${status}`, { candidateId: request.params.id });
  return decided;
});

return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let projectRoot: string;
  let portArgument: string | undefined;
  const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts");
  const projectsRoot = path.resolve(scriptsRoot, "../../../projects");
  if (!process.argv[2]) {
    await mkdir(projectsRoot, { recursive: true });
    const candidates: Array<{ name: string; modified: number }> = [];
    for (const entry of await readdir(projectsRoot, { withFileTypes: true })) if (entry.isDirectory() && await exists(path.join(projectsRoot, entry.name, "interaction"))) candidates.push({ name: entry.name, modified: (await stat(path.join(projectsRoot, entry.name))).mtimeMs });
    const recent = candidates.sort((left, right) => right.modified - left.modified)[0];
    if (recent) projectRoot = path.join(projectsRoot, recent.name);
    else {
      const child = spawn("python3", [path.join(scriptsRoot, "project_manager.py"), "init", "studio"], { stdio: "inherit" });
      const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1)));
      if (code !== 0) throw new Error(`default project initialization failed (${code})`);
      const created = (await readdir(projectsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith("studio_")).sort((left, right) => right.name.localeCompare(left.name))[0];
      if (!created) throw new Error("default project initialization succeeded but created directory was not found");
      projectRoot = path.join(projectsRoot, created.name);
    }
  } else if (process.argv[2] === "--new") {
    const projectName = process.argv[3];
    if (!projectName || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(projectName)) throw new Error("project name must contain 1-80 safe characters");
    projectRoot = path.join(projectsRoot, projectName);
    const existingProject = (await readdir(projectsRoot, { withFileTypes: true })).find((entry) => entry.isDirectory() && (entry.name === projectName || entry.name.startsWith(`${projectName}_`)));
    if (existingProject) { console.error(`[ERROR] Project already exists: ${path.join(projectsRoot, existingProject.name)}`); process.exit(1); }
    const child = spawn("python3", [path.join(scriptsRoot, "project_manager.py"), "init", projectName], { stdio: "inherit" });
    const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1)));
    if (code !== 0) throw new Error(`project initialization failed (${code})`);
    const created = (await readdir(projectsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith(`${projectName}_`)).sort((left, right) => right.name.localeCompare(left.name))[0];
    if (!created) throw new Error("project initialization succeeded but created directory was not found");
    projectRoot = path.join(projectsRoot, created.name);
  } else {
    projectRoot = path.resolve(process.argv[2]);
    portArgument = process.argv[3];
  }
  const lockFile = path.join(projectRoot, "interaction", "studio.lock.json");
  const existing = await readJson<{ pid?: number; port?: number }>(lockFile, {});
  const port = Number(portArgument ?? 6070);
  if (existing.pid) {
    try {
      process.kill(existing.pid, 0);
      if (existing.port === port) throw new Error(`FastPPT 已在端口 ${port} 运行`);
      process.kill(existing.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const server = await createStudio(projectRoot);
  const cleanup = async () => { await rm(lockFile, { force: true }); };
  server.addHook("onClose", cleanup);
  let shuttingDown = false;
  const shutdown = (signal: "SIGINT" | "SIGTERM") => { if (shuttingDown) return; shuttingDown = true; server.log.info({ signal }, "FastPPT 正在停止"); server.server.closeAllConnections(); void server.close().then(() => process.exit(0), (error) => { server.log.error(error, "FastPPT 停止失败"); process.exit(1); }); };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown(signal));
  await server.listen({ host: "127.0.0.1", port });
  await atomicJson(lockFile, { schemaVersion: 1, service: "project-studio-ts", projectRoot, pid: process.pid, port, url: `http://127.0.0.1:${port}`, startedAt: now() });
}
