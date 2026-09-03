import { copyFile, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { atomicJson, authoringDirectory, exists, hashFile, now, readJson } from "./store.js";

export async function prepareStaging(root: string, interaction: string, jobId: string, slides: string[]) {
  const staging = path.join(interaction, "jobs", jobId, "staging");
  await rm(staging, { recursive: true, force: true });
  const interactionRoot = path.resolve(interaction);
  for (const entry of await readdir(root)) {
    const source = path.join(root, entry);
    if (path.resolve(source) === interactionRoot) continue;
    await cp(source, path.join(staging, entry), { recursive: true });
  }
  await mkdir(path.join(staging, "interaction"), { recursive: true });
  return staging;
}

export async function commitStaging(root: string, interaction: string, jobId: string, slides: string[]) {
  const jobDir = path.join(interaction, "jobs", jobId);
  const projectAuthoring = await authoringDirectory(root);
  const authoringName = path.basename(projectAuthoring);
  const staging = path.join(jobDir, "staging", authoringName);
  const journal = path.join(jobDir, "commit.json");
  const backups: Record<string, string> = {};
  for (const slide of slides) {
    const target = path.join(projectAuthoring, `${slide}.svg`);
    const archive = path.join(interaction, "revisions", slide);
    await mkdir(archive, { recursive: true });
    const backup = path.join(archive, `${Date.now()}-${(await hashFile(target)).slice(7, 19)}.svg`);
    await copyFile(target, backup);
    backups[slide] = backup;
    await rm(path.join(interaction, "redo", slide), { recursive: true, force: true });
  }
  await atomicJson(journal, { jobId, status: "started", slides, backups, applied: [], timestamp: now() });
  const applied: string[] = [];
  for (const slide of slides) {
    const target = path.join(projectAuthoring, `${slide}.svg`);
    const temporary = `${target}.studio-tmp`;
    await copyFile(path.join(staging, `${slide}.svg`), temporary);
    await rename(temporary, target);
    applied.push(slide);
    await atomicJson(journal, { jobId, status: "started", slides, backups, applied, timestamp: now() });
  }
  await atomicJson(journal, { jobId, status: "committed", slides, backups, applied, timestamp: now() });
}

export async function commitGeneratedSlides(root: string, interaction: string, jobId: string, slides: string[]) {
  const jobDir = path.join(interaction, "jobs", jobId);
  const targetDirectory = path.join(root, "svg_output");
  const staging = path.join(jobDir, "staging", "svg_output");
  const journal = path.join(jobDir, "commit.json");
  await mkdir(targetDirectory, { recursive: true });
  const backups: Record<string, string> = {};
  const created: string[] = [];
  for (const slide of slides) {
    const target = path.join(targetDirectory, `${slide}.svg`);
    if (!(await exists(target))) { created.push(slide); continue; }
    const archive = path.join(interaction, "revisions", slide); await mkdir(archive, { recursive: true });
    const backup = path.join(archive, `${Date.now()}-${(await hashFile(target)).slice(7, 19)}.svg`); await copyFile(target, backup); backups[slide] = backup;
    await rm(path.join(interaction, "redo", slide), { recursive: true, force: true });
  }
  await atomicJson(journal, { jobId, status: "started", slides, backups, created, applied: [], timestamp: now() });
  const applied: string[] = [];
  try {
    for (const slide of slides) {
      const target = path.join(targetDirectory, `${slide}.svg`), temporary = `${target}.studio-tmp`;
      await copyFile(path.join(staging, `${slide}.svg`), temporary); await rename(temporary, target); applied.push(slide);
      await atomicJson(journal, { jobId, status: "started", slides, backups, created, applied, timestamp: now() });
    }
    await atomicJson(journal, { jobId, status: "committed", slides, backups, created, applied, timestamp: now() });
  } catch (error) {
    for (const slide of applied.reverse()) { const target = path.join(targetDirectory, `${slide}.svg`), backup = backups[slide]; if (backup) await copyFile(backup, target); else await rm(target, { force: true }); }
    await atomicJson(journal, { jobId, status: "rolled_back", slides, backups, created, applied, timestamp: now() });
    throw error;
  }
}

export async function recoverTransactions(root: string, interaction: string) {
  const jobs = path.join(interaction, "jobs");
  if (!(await exists(jobs))) return [];
  const recovered: string[] = [];
  for (const jobId of await readdir(jobs)) {
    const journal = path.join(jobs, jobId, "commit.json");
    const data = await readJson<{ status?: string; slides?: string[]; backups?: Record<string, string>; created?: string[]; applied?: string[] }>(journal, {});
    if (data.status !== "started" || !data.slides) continue;
    const projectAuthoring = await authoringDirectory(root);
    for (const slide of data.applied ?? []) {
      const backup = data.backups?.[slide];
      if (backup && await exists(backup)) await copyFile(backup, path.join(projectAuthoring, `${slide}.svg`)); else if (data.created?.includes(slide)) await rm(path.join(projectAuthoring, `${slide}.svg`), { force: true });
    }
    await atomicJson(journal, { ...data, status: "rolled_back", timestamp: now() });
    recovered.push(jobId);
  }
  return recovered;
}
