import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  root: text('root').notNull().unique(),
  name: text('name').notNull(),
  startedAt: text('started_at').notNull(),
})

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  entryFile: text('entry_file').notNull(),
  name: text('name').notNull(),
  themeId: text('theme_id'),
  revision: text('revision').notNull(),
  modifiedAt: text('modified_at').notNull(),
})

export const sessionAliases = sqliteTable('session_aliases', {
  id: text('id').primaryKey(),
  harness: text('harness').notNull(),
  sessionId: text('session_id').notNull(),
  alias: text('alias').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const sessionProfiles = sqliteTable('session_profiles', {
  id: text('id').primaryKey(),
  harness: text('harness').notNull(),
  sessionId: text('session_id').notNull(),
  profile: text('profile').notNull(),
  profileDigest: text('profile_digest').notNull(),
  registryVersion: text('registry_version').notNull(),
  themeSkillId: text('theme_skill_id'),
  themeSkillVersion: text('theme_skill_version'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const approvals = sqliteTable('approvals', {
  approvalId: text('approval_id').primaryKey(),
  harness: text('harness').notNull(),
  sessionId: text('session_id').notNull(),
  runId: text('run_id'),
  status: text('status').notNull(),
  decision: text('decision'),
  requestedAt: text('requested_at').notNull(),
  resolvedAt: text('resolved_at'),
  payload: text('payload').notNull(),
})

export const managedInstallations = sqliteTable('managed_installations', {
  id: text('id').primaryKey(),
  harness: text('harness').notNull(),
  skillId: text('skill_id').notNull(),
  themeId: text('theme_id'),
  state: text('state').notNull(),
  expectedVersion: text('expected_version').notNull(),
  installedVersion: text('installed_version'),
  targetPath: text('target_path').notNull(),
  managed: integer('managed', { mode: 'boolean' }).notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const runs = sqliteTable('runs', {
  runId: text('run_id').primaryKey(),
  harness: text('harness').notNull(),
  sessionId: text('session_id').notNull(),
  themeId: text('theme_id'),
  themeSkillId: text('theme_skill_id'),
  themeSkillVersion: text('theme_skill_version'),
  registryVersion: text('registry_version').notNull(),
  resolutionStatus: text('resolution_status').notNull(),
  status: text('status').notNull(),
  invocationStatus: text('invocation_status').notNull(),
  invocationMechanism: text('invocation_mechanism'),
  observationEvidence: text('observation_evidence'),
  sessionProfile: text('session_profile'),
  profileDigest: text('profile_digest'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
})

export const agentEvents = sqliteTable('agent_events', {
  eventId: text('event_id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.runId, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  type: text('type').notNull(),
  timestamp: text('timestamp').notNull(),
  payload: text('payload').notNull(),
})

export const exports = sqliteTable('exports', {
  exportId: text('export_id').primaryKey(),
  deckId: text('deck_id').notNull(),
  status: text('status').notNull(),
  outputName: text('output_name').notNull(),
  outputPath: text('output_path').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  payload: text('payload').notNull(),
})

export const qualityReports = sqliteTable('quality_reports', {
  deckId: text('deck_id').primaryKey(),
  revision: text('revision').notNull(),
  report: text('report').notNull(),
  updatedAt: text('updated_at').notNull(),
})
