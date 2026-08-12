import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/index.js'

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

describe('database', () => {
  it('migrates and answers health checks', () => {
    const database = createDatabase(':memory:')
    expect(database.healthcheck()).toBe(true)
    database.close()
  })

  it('applies versioned migrations once and reopens existing databases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fastppt-db-'))
    temporaryDirectories.add(directory)
    const filename = join(directory, 'state.sqlite')
    const first = createDatabase(filename)
    expect(
      first.sqlite
        .prepare('SELECT name FROM schema_migrations ORDER BY name')
        .all(),
    ).toEqual([
      { name: '0000_initial.sql' },
      { name: '0001_application_state.sql' },
      { name: '0002_run_resolution_status.sql' },
    ])
    first.recordWorkspace({
      id: 'workspace-1',
      root: '/tmp/workspace',
      name: 'Workspace',
      startedAt: '2026-08-04T00:00:00.000Z',
    })
    first.close()

    const reopened = createDatabase(filename)
    expect(
      reopened.sqlite.prepare('SELECT name FROM workspaces').get(),
    ).toEqual({ name: 'Workspace' })
    expect(
      reopened.sqlite
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get(),
    ).toEqual({ count: 3 })
    reopened.close()
  })

  it('persists an auditable Skill invocation timeline for a run', () => {
    const database = createDatabase(':memory:')
    const base = {
      harness: 'codex' as const,
      sessionId: 'session-1',
      runId: 'run-1',
      themeId: 'slidev-theme-academy',
      themeSkillId: 'fastppt-theme-academy',
      themeSkillVersion: '0.1.0',
      timestamp: '2026-08-03T00:00:00.000Z',
    }
    database.recordAgentEvent(
      {
        ...base,
        eventId: 'event-1',
        sequence: 1,
        type: 'run.started',
        data: {},
      },
      'registry-1',
      'resolved',
    )
    database.recordAgentEvent(
      {
        ...base,
        eventId: 'event-2',
        sequence: 2,
        type: 'skill.invocation.unknown',
        data: {
          mechanism: 'codex-app-server:typed-skill-input+$skill-name',
          evidence: null,
        },
      },
      'registry-1',
    )
    expect(database.getRunAudit('run-1')).toMatchObject({
      themeId: 'slidev-theme-academy',
      themeSkillId: 'fastppt-theme-academy',
      registryVersion: 'registry-1',
      skillResolutionStatus: 'resolved',
      status: 'running',
      invocationStatus: 'unknown',
      invocationMechanism: 'codex-app-server:typed-skill-input+$skill-name',
      events: [{ type: 'run.started' }, { type: 'skill.invocation.unknown' }],
    })
    database.recordAgentEvent(
      {
        ...base,
        runId: 'run-2',
        eventId: 'event-3',
        sequence: 1,
        timestamp: '2026-08-03T00:01:00.000Z',
        type: 'run.started',
        data: {},
      },
      'registry-2',
      'resolved',
    )
    expect(database.getLatestRunAudit('codex', 'session-1')).toMatchObject({
      runId: 'run-2',
      registryVersion: 'registry-2',
      skillResolutionStatus: 'resolved',
    })
    expect(database.getLatestRunAudit('claude', 'session-1')).toBeUndefined()
    database.close()
  })

  it('persists export state and recovers interrupted jobs', () => {
    const database = createDatabase(':memory:')
    const job = {
      id: 'export-1',
      deckId: 'deck-1',
      format: 'editable-pptx' as const,
      outputName: 'deck.pptx',
      status: 'running' as const,
      phase: 'capturing-slides',
      progress: 50,
      createdAt: '2026-08-03T00:00:00.000Z',
      startedAt: '2026-08-03T00:00:01.000Z',
      warnings: [],
    }
    database.recordExportJob(job, '/tmp/deck.pptx')
    expect(database.getExportJob('export-1')).toMatchObject({
      job: { status: 'running', progress: 50 },
      outputPath: '/tmp/deck.pptx',
    })
    const [recovered] = database.recoverInterruptedExports()
    expect(recovered).toMatchObject({
      id: 'export-1',
      status: 'failed',
      phase: 'interrupted',
    })
    expect(recovered?.error?.code).toBe('EXPORT_INTERRUPTED')
    expect(database.getExportJob('export-1')?.job.status).toBe('failed')
    expect(database.recoverInterruptedExports()).toEqual([])
    database.close()
  })

  it('persists stable application, approval and installation state', () => {
    const database = createDatabase(':memory:')
    database.recordWorkspace({
      id: 'workspace-1',
      root: '/tmp/workspace',
      name: 'Workspace',
      startedAt: '2026-08-03T00:00:00.000Z',
    })
    database.recordDecks('workspace-1', [
      {
        id: 'deck-1',
        entryFile: 'slides.md',
        name: 'Slides',
        themeId: 'slidev-theme-academy',
        revision: 'revision-1',
        modifiedAt: '2026-08-03T00:00:00.000Z',
      },
    ])
    database.recordSessionAlias('codex', 'session-1', 'Quarterly review')
    expect(database.getSessionAlias('codex', 'session-1')).toBe(
      'Quarterly review',
    )
    expect(database.getSessionAlias('codex', 'missing')).toBeUndefined()
    database.setAppSetting('recentHarness', 'codex')
    database.setAppSetting(
      'recentSession',
      JSON.stringify({ harness: 'codex', sessionId: 'session-1' }),
    )
    database.setAppSetting('recentTheme', 'slidev-theme-academy')
    database.recordApproval({
      approvalId: 'approval-1',
      harness: 'codex',
      sessionId: 'session-1',
      runId: 'run-1',
      requestedAt: '2026-08-03T00:00:00.000Z',
      payload: { kind: 'command' },
    })
    expect(database.getAppSetting('recentHarness')).toBe('codex')
    expect(database.getAppSetting('missing')).toBeUndefined()
    expect(database.getPendingApprovals()).toEqual([
      { harness: 'codex', payload: { kind: 'command' } },
    ])
    expect(database.expirePendingApprovals('gateway-restarted')).toBe(1)
    expect(database.getPendingApprovals()).toEqual([])
    database.recordManagedInstallations([
      {
        harness: 'codex',
        skillId: 'fastppt-theme-academy',
        themeId: 'slidev-theme-academy',
        state: 'installed',
        expectedVersion: '1.0.0',
        installedVersion: '1.0.0',
        targetPath: '/tmp/skills/fastppt-theme-academy',
        managed: true,
      },
    ])
    expect(
      database.sqlite.prepare('SELECT COUNT(*) AS count FROM workspaces').get(),
    ).toEqual({ count: 1 })
    expect(database.sqlite.prepare('SELECT theme_id FROM decks').get()).toEqual(
      { theme_id: 'slidev-theme-academy' },
    )
    expect(
      database.sqlite.prepare('SELECT status, decision FROM approvals').get(),
    ).toEqual({ status: 'resolved', decision: 'gateway-restarted' })
    expect(
      database.sqlite
        .prepare('SELECT state, managed FROM managed_installations')
        .get(),
    ).toEqual({ state: 'installed', managed: 1 })
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM app_settings')
        .get(),
    ).toEqual({ count: 3 })
    database.close()
  })
})
