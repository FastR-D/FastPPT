import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import {
  DeckQualityReportSchema,
  ExportJobSchema,
  SessionDeckProfileSchema,
  SessionProfileRecordSchema,
} from '@fastppt/protocol'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type {
  DeckQualityReport,
  ExportJob,
  SessionDeckProfile,
  SessionProfileRecord,
} from '@fastppt/protocol'

import * as schema from './schema.js'

const migrationsDirectory = new URL('../migrations/', import.meta.url)

function applyMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = sqlite.prepare(
    'SELECT checksum FROM schema_migrations WHERE name = ?',
  )
  const record = sqlite.prepare(`
    INSERT INTO schema_migrations (name, checksum, applied_at)
    VALUES (?, ?, ?)
  `)
  for (const name of readdirSync(migrationsDirectory)
    .filter((entry) => /^\d+_[a-z0-9_-]+\.sql$/i.test(entry))
    .sort()) {
    const sql = readFileSync(new URL(name, migrationsDirectory), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = applied.get(name) as { checksum: string } | undefined
    if (existing) {
      if (existing.checksum !== checksum)
        throw new Error(`Database migration changed after apply: ${name}`)
      continue
    }
    sqlite.transaction(() => {
      sqlite.exec(sql)
      record.run(name, checksum, new Date().toISOString())
    })()
  }
}

export interface PersistedAgentEvent {
  eventId: string
  sequence: number
  harness: 'claude' | 'codex'
  sessionId: string
  runId?: string | undefined
  themeId?: string | undefined
  themeSkillId?: string | undefined
  themeSkillVersion?: string | undefined
  timestamp: string
  type: string
  data: unknown
  providerPayload?: unknown
}

export interface RunAuditRecord {
  runId: string
  harness: string
  sessionId: string
  themeId: string | null
  themeSkillId: string | null
  themeSkillVersion: string | null
  registryVersion: string
  skillResolutionStatus: 'resolved' | 'unknown'
  status: string
  invocationStatus: string
  invocationMechanism: string | null
  observationEvidence: unknown
  sessionProfile: SessionDeckProfile | null
  profileDigest: string | null
  startedAt: string
  completedAt: string | null
  events: PersistedAgentEvent[]
}

interface RunRow {
  run_id: string
  harness: string
  session_id: string
  theme_id: string | null
  theme_skill_id: string | null
  theme_skill_version: string | null
  registry_version: string
  resolution_status: 'resolved' | 'unknown'
  status: string
  invocation_status: string
  invocation_mechanism: string | null
  observation_evidence: string | null
  session_profile: string | null
  profile_digest: string | null
  started_at: string
  completed_at: string | null
}

export interface FastPptDatabase {
  db: BetterSQLite3Database<typeof schema>
  sqlite: Database.Database
  healthcheck(): boolean
  recordWorkspace(input: {
    id: string
    root: string
    name: string
    startedAt: string
  }): void
  recordDecks(
    workspaceId: string,
    decks: readonly {
      id: string
      entryFile: string
      name: string
      themeId?: string | undefined
      revision: string
      modifiedAt: string
    }[],
  ): void
  recordSessionAlias(harness: string, sessionId: string, alias: string): void
  getSessionAlias(harness: string, sessionId: string): string | undefined
  recordSessionProfile(record: SessionProfileRecord): void
  getSessionProfile(
    harness: string,
    sessionId: string,
  ): SessionProfileRecord | undefined
  setAppSetting(key: string, value: string): void
  getAppSetting(key: string): string | undefined
  recordApproval(input: {
    approvalId: string
    harness: string
    sessionId: string
    runId?: string | undefined
    requestedAt: string
    payload: unknown
  }): void
  resolveApproval(approvalId: string, decision: string): void
  expirePendingApprovals(decision: string): number
  getPendingApprovals(): Array<{ harness: string; payload: unknown }>
  recordManagedInstallations(
    statuses: readonly {
      harness: string
      skillId: string
      themeId?: string | undefined
      state: string
      expectedVersion: string
      installedVersion?: string | undefined
      targetPath: string
      managed: boolean
    }[],
  ): void
  recordAgentEvent(
    event: PersistedAgentEvent,
    registryVersion: string,
    skillResolutionStatus?: 'resolved' | 'unknown',
  ): void
  getRunAudit(runId: string): RunAuditRecord | undefined
  getLatestRunAudit(
    harness: string,
    sessionId: string,
  ): RunAuditRecord | undefined
  recordExportJob(job: ExportJob, outputPath: string): void
  getExportJob(
    exportId: string,
  ): { job: ExportJob; outputPath: string } | undefined
  recoverInterruptedExports(): ExportJob[]
  recordQualityReport(report: DeckQualityReport): void
  getQualityReport(deckId: string): DeckQualityReport | undefined
  close(): void
}

export function createDatabase(filename: string): FastPptDatabase {
  mkdirSync(dirname(filename), { recursive: true })
  const sqlite = new BetterSqlite3(filename)
  sqlite.pragma('journal_mode = WAL')
  applyMigrations(sqlite)
  const db = drizzle(sqlite, { schema })
  const upsertRun = sqlite.prepare(`
    INSERT INTO runs (
      run_id, harness, session_id, theme_id, theme_skill_id,
      theme_skill_version, registry_version, resolution_status, status, invocation_status,
      invocation_mechanism, observation_evidence, started_at, completed_at
      , session_profile, profile_digest
    ) VALUES (
      @runId, @harness, @sessionId, @themeId, @themeSkillId,
      @themeSkillVersion, @registryVersion, @resolutionStatus, @status, @invocationStatus,
      @invocationMechanism, @observationEvidence, @startedAt, @completedAt
      , @sessionProfile, @profileDigest
    )
    ON CONFLICT(run_id) DO UPDATE SET
      theme_id = COALESCE(excluded.theme_id, runs.theme_id),
      theme_skill_id = COALESCE(excluded.theme_skill_id, runs.theme_skill_id),
      theme_skill_version = COALESCE(excluded.theme_skill_version, runs.theme_skill_version),
      resolution_status = CASE
        WHEN excluded.resolution_status = 'unknown' THEN runs.resolution_status
        ELSE excluded.resolution_status
      END,
      status = CASE WHEN excluded.status = 'running' THEN runs.status ELSE excluded.status END,
      invocation_status = CASE
        WHEN excluded.invocation_status = 'not-requested' THEN runs.invocation_status
        ELSE excluded.invocation_status
      END,
      invocation_mechanism = COALESCE(excluded.invocation_mechanism, runs.invocation_mechanism),
      observation_evidence = COALESCE(excluded.observation_evidence, runs.observation_evidence),
      session_profile = COALESCE(excluded.session_profile, runs.session_profile),
      profile_digest = COALESCE(excluded.profile_digest, runs.profile_digest),
      completed_at = COALESCE(excluded.completed_at, runs.completed_at)
  `)
  const insertEvent = sqlite.prepare(`
    INSERT OR IGNORE INTO agent_events (
      event_id, run_id, sequence, type, timestamp, payload
    ) VALUES (@eventId, @runId, @sequence, @type, @timestamp, @payload)
  `)
  const recordEvent = sqlite.transaction(
    (
      event: PersistedAgentEvent,
      registryVersion: string,
      skillResolutionStatus: 'resolved' | 'unknown',
    ) => {
      if (!event.runId) return
      const data =
        event.data &&
        typeof event.data === 'object' &&
        !Array.isArray(event.data)
          ? (event.data as Record<string, unknown>)
          : {}
      const terminalStatus =
        event.type === 'run.completed'
          ? 'completed'
          : event.type === 'run.failed'
            ? 'failed'
            : event.type === 'run.cancelled'
              ? 'cancelled'
              : 'running'
      const invocationStatus = event.type.startsWith('skill.invocation.')
        ? event.type.slice('skill.invocation.'.length)
        : 'not-requested'
      const evidence =
        data.evidence ?? (data.simulated === true ? data : undefined)
      upsertRun.run({
        runId: event.runId,
        harness: event.harness,
        sessionId: event.sessionId,
        themeId: event.themeId ?? null,
        themeSkillId: event.themeSkillId ?? null,
        themeSkillVersion: event.themeSkillVersion ?? null,
        registryVersion,
        resolutionStatus: skillResolutionStatus,
        status: terminalStatus,
        invocationStatus,
        invocationMechanism:
          typeof data.mechanism === 'string' ? data.mechanism : null,
        observationEvidence:
          evidence === undefined ? null : JSON.stringify(evidence),
        sessionProfile:
          typeof data.sessionProfile === 'object' && data.sessionProfile !== null
            ? JSON.stringify(data.sessionProfile)
            : null,
        profileDigest:
          typeof data.profileDigest === 'string' ? data.profileDigest : null,
        startedAt: event.timestamp,
        completedAt: terminalStatus === 'running' ? null : event.timestamp,
      })
      insertEvent.run({
        eventId: event.eventId,
        runId: event.runId,
        sequence: event.sequence,
        type: event.type,
        timestamp: event.timestamp,
        payload: JSON.stringify(event),
      })
    },
  )
  const upsertExport = sqlite.prepare(`
    INSERT INTO exports (
      export_id, deck_id, status, output_name, output_path,
      created_at, updated_at, payload
    ) VALUES (
      @exportId, @deckId, @status, @outputName, @outputPath,
      @createdAt, @updatedAt, @payload
    )
    ON CONFLICT(export_id) DO UPDATE SET
      status = excluded.status,
      output_name = excluded.output_name,
      output_path = excluded.output_path,
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `)
  const upsertWorkspace = sqlite.prepare(`
    INSERT INTO workspaces (id, root, name, started_at)
    VALUES (@id, @root, @name, @startedAt)
    ON CONFLICT(root) DO UPDATE SET name = excluded.name, started_at = excluded.started_at
  `)
  const readRunAudit = (runId: string): RunAuditRecord | undefined => {
    const run = sqlite
      .prepare('SELECT * FROM runs WHERE run_id = ?')
      .get(runId) as RunRow | undefined
    if (!run) return undefined
    const events = sqlite
      .prepare(
        'SELECT payload FROM agent_events WHERE run_id = ? ORDER BY sequence',
      )
      .all(runId) as Array<{ payload: string }>
    return {
      runId: run.run_id,
      harness: run.harness,
      sessionId: run.session_id,
      themeId: run.theme_id,
      themeSkillId: run.theme_skill_id,
      themeSkillVersion: run.theme_skill_version,
      registryVersion: run.registry_version,
      skillResolutionStatus: run.resolution_status,
      status: run.status,
      invocationStatus: run.invocation_status,
      invocationMechanism: run.invocation_mechanism,
      observationEvidence:
        run.observation_evidence === null
          ? null
          : (JSON.parse(run.observation_evidence) as unknown),
      sessionProfile:
        run.session_profile === null
          ? null
          : SessionDeckProfileSchema.parse(JSON.parse(run.session_profile)),
      profileDigest: run.profile_digest,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      events: events.map(
        ({ payload }) => JSON.parse(payload) as PersistedAgentEvent,
      ),
    }
  }
  const upsertDeck = sqlite.prepare(`
    INSERT INTO decks (id, workspace_id, entry_file, name, theme_id, revision, modified_at)
    VALUES (@id, @workspaceId, @entryFile, @name, @themeId, @revision, @modifiedAt)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      entry_file = excluded.entry_file,
      name = excluded.name,
      theme_id = excluded.theme_id,
      revision = excluded.revision,
      modified_at = excluded.modified_at
  `)
  const upsertAlias = sqlite.prepare(`
    INSERT INTO session_aliases (id, harness, session_id, alias, updated_at)
    VALUES (@id, @harness, @sessionId, @alias, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET alias = excluded.alias, updated_at = excluded.updated_at
  `)
  const selectAlias = sqlite.prepare(`
    SELECT alias FROM session_aliases
    WHERE harness = ? AND session_id = ?
  `)
  const upsertSessionProfile = sqlite.prepare(`
    INSERT INTO session_profiles (
      id, harness, session_id, profile, profile_digest, registry_version,
      theme_skill_id, theme_skill_version, created_at, updated_at
    ) VALUES (
      @id, @harness, @sessionId, @profile, @profileDigest, @registryVersion,
      @themeSkillId, @themeSkillVersion, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      profile = excluded.profile,
      profile_digest = excluded.profile_digest,
      registry_version = excluded.registry_version,
      theme_skill_id = excluded.theme_skill_id,
      theme_skill_version = excluded.theme_skill_version,
      updated_at = excluded.updated_at
  `)
  const selectSessionProfile = sqlite.prepare(`
    SELECT * FROM session_profiles WHERE harness = ? AND session_id = ?
  `)
  const upsertSetting = sqlite.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const upsertApproval = sqlite.prepare(`
    INSERT INTO approvals (
      approval_id, harness, session_id, run_id, status, decision,
      requested_at, resolved_at, payload
    ) VALUES (
      @approvalId, @harness, @sessionId, @runId, 'pending', NULL,
      @requestedAt, NULL, @payload
    )
    ON CONFLICT(approval_id) DO UPDATE SET payload = excluded.payload
  `)
  const updateApproval = sqlite.prepare(`
    UPDATE approvals SET status = 'resolved', decision = ?, resolved_at = ?
    WHERE approval_id = ?
  `)
  const expirePendingApprovals = sqlite.prepare(`
    UPDATE approvals
    SET status = 'resolved', decision = ?, resolved_at = ?
    WHERE status = 'pending'
  `)
  const selectSetting = sqlite.prepare(
    'SELECT value FROM app_settings WHERE key = ?',
  )
  const selectPendingApprovals = sqlite.prepare(`
    SELECT harness, payload FROM approvals
    WHERE status = 'pending'
    ORDER BY requested_at
  `)
  const upsertInstallation = sqlite.prepare(`
    INSERT INTO managed_installations (
      id, harness, skill_id, theme_id, state, expected_version,
      installed_version, target_path, managed, updated_at
    ) VALUES (
      @id, @harness, @skillId, @themeId, @state, @expectedVersion,
      @installedVersion, @targetPath, @managed, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      theme_id = excluded.theme_id,
      state = excluded.state,
      expected_version = excluded.expected_version,
      installed_version = excluded.installed_version,
      target_path = excluded.target_path,
      managed = excluded.managed,
      updated_at = excluded.updated_at
  `)
  const upsertQualityReport = sqlite.prepare(`
    INSERT INTO quality_reports (deck_id, revision, report, updated_at)
    VALUES (@deckId, @revision, @report, @updatedAt)
    ON CONFLICT(deck_id) DO UPDATE SET
      revision = excluded.revision,
      report = excluded.report,
      updated_at = excluded.updated_at
  `)
  const selectQualityReport = sqlite.prepare(
    'SELECT report FROM quality_reports WHERE deck_id = ?',
  )

  return {
    db,
    sqlite,
    healthcheck(): boolean {
      return sqlite.prepare('SELECT 1 AS ok').get() !== undefined
    },
    recordWorkspace(input): void {
      upsertWorkspace.run(input)
    },
    recordDecks(workspaceId, decks): void {
      sqlite.transaction(() => {
        for (const deck of decks)
          upsertDeck.run({
            ...deck,
            workspaceId,
            themeId: deck.themeId ?? null,
          })
      })()
    },
    recordSessionAlias(harness, sessionId, alias): void {
      upsertAlias.run({
        id: `${harness}:${sessionId}`,
        harness,
        sessionId,
        alias,
        updatedAt: new Date().toISOString(),
      })
    },
    getSessionAlias(harness, sessionId): string | undefined {
      return (
        selectAlias.get(harness, sessionId) as { alias: string } | undefined
      )?.alias
    },
    recordSessionProfile(record): void {
      const parsed = SessionProfileRecordSchema.parse(record)
      upsertSessionProfile.run({
        ...parsed,
        id: `${parsed.harness}:${parsed.sessionId}`,
        profile: JSON.stringify(parsed.profile),
      })
    },
    getSessionProfile(harness, sessionId): SessionProfileRecord | undefined {
      const row = selectSessionProfile.get(harness, sessionId) as
        | {
            harness: string
            session_id: string
            profile: string
            profile_digest: string
            registry_version: string
            theme_skill_id: string | null
            theme_skill_version: string | null
            created_at: string
            updated_at: string
          }
        | undefined
      return row
        ? SessionProfileRecordSchema.parse({
            harness: row.harness,
            sessionId: row.session_id,
            profile: JSON.parse(row.profile),
            profileDigest: row.profile_digest,
            registryVersion: row.registry_version,
            themeSkillId: row.theme_skill_id,
            themeSkillVersion: row.theme_skill_version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })
        : undefined
    },
    setAppSetting(key, value): void {
      upsertSetting.run({ key, value, updatedAt: Date.now() })
    },
    getAppSetting(key): string | undefined {
      return (selectSetting.get(key) as { value: string } | undefined)?.value
    },
    recordApproval(input): void {
      upsertApproval.run({
        ...input,
        runId: input.runId ?? null,
        payload: JSON.stringify(input.payload),
      })
    },
    resolveApproval(approvalId, decision): void {
      updateApproval.run(decision, new Date().toISOString(), approvalId)
    },
    expirePendingApprovals(decision): number {
      return expirePendingApprovals.run(
        decision,
        new Date().toISOString(),
      ).changes
    },
    getPendingApprovals(): Array<{ harness: string; payload: unknown }> {
      return (
        selectPendingApprovals.all() as Array<{
          harness: string
          payload: string
        }>
      ).map((row) => ({
        harness: row.harness,
        payload: JSON.parse(row.payload) as unknown,
      }))
    },
    recordManagedInstallations(statuses): void {
      const updatedAt = new Date().toISOString()
      sqlite.transaction(() => {
        for (const status of statuses)
          upsertInstallation.run({
            ...status,
            id: `${status.harness}:${status.skillId}`,
            themeId: status.themeId ?? null,
            installedVersion: status.installedVersion ?? null,
            managed: status.managed ? 1 : 0,
            updatedAt,
          })
      })()
    },
    recordAgentEvent(
      event,
      registryVersion,
      skillResolutionStatus = 'unknown',
    ): void {
      recordEvent(event, registryVersion, skillResolutionStatus)
    },
    getRunAudit(runId): RunAuditRecord | undefined {
      return readRunAudit(runId)
    },
    getLatestRunAudit(harness, sessionId): RunAuditRecord | undefined {
      const latest = sqlite
        .prepare(
          `SELECT run_id FROM runs
           WHERE harness = ? AND session_id = ?
           ORDER BY started_at DESC, rowid DESC LIMIT 1`,
        )
        .get(harness, sessionId) as { run_id: string } | undefined
      return latest ? readRunAudit(latest.run_id) : undefined
    },
    recordExportJob(job, outputPath): void {
      upsertExport.run({
        exportId: job.id,
        deckId: job.deckId,
        status: job.status,
        outputName: job.outputName,
        outputPath,
        createdAt: job.createdAt,
        updatedAt: new Date().toISOString(),
        payload: JSON.stringify(job),
      })
    },
    getExportJob(exportId) {
      const row = sqlite
        .prepare('SELECT output_path, payload FROM exports WHERE export_id = ?')
        .get(exportId) as { output_path: string; payload: string } | undefined
      return row
        ? {
            job: ExportJobSchema.parse(JSON.parse(row.payload) as unknown),
            outputPath: row.output_path,
          }
        : undefined
    },
    recoverInterruptedExports(): ExportJob[] {
      const rows = sqlite
        .prepare(
          "SELECT output_path, payload FROM exports WHERE status IN ('queued', 'running')",
        )
        .all() as Array<{ output_path: string; payload: string }>
      return rows.map((row) => {
        const previous = ExportJobSchema.parse(
          JSON.parse(row.payload) as unknown,
        )
        const job = ExportJobSchema.parse({
          ...previous,
          status: 'failed',
          phase: 'interrupted',
          completedAt: new Date().toISOString(),
          error: {
            code: 'EXPORT_INTERRUPTED',
            message: 'Gateway stopped before the export completed.',
          },
        })
        upsertExport.run({
          exportId: job.id,
          deckId: job.deckId,
          status: job.status,
          outputName: job.outputName,
          outputPath: row.output_path,
          createdAt: job.createdAt,
          updatedAt: new Date().toISOString(),
          payload: JSON.stringify(job),
        })
        return job
      })
    },
    recordQualityReport(report): void {
      const parsed = DeckQualityReportSchema.parse(report)
      upsertQualityReport.run({
        deckId: parsed.deckId,
        revision: parsed.revision,
        report: JSON.stringify(parsed),
        updatedAt: new Date().toISOString(),
      })
    },
    getQualityReport(deckId): DeckQualityReport | undefined {
      const row = selectQualityReport.get(deckId) as
        | { report: string }
        | undefined
      return row
        ? DeckQualityReportSchema.parse(JSON.parse(row.report))
        : undefined
    },
    close(): void {
      sqlite.close()
    },
  }
}

export {
  agentEvents,
  appSettings,
  approvals,
  decks,
  exports,
  managedInstallations,
  runs,
  sessionAliases,
  workspaces,
} from './schema.js'
