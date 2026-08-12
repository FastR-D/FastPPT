export { WorkspaceError, type WorkspaceErrorCode } from './errors.js'
export {
  assertNonSecretPath,
  createIgnoreMatcher,
  isContained,
  normalizeRelativePath,
  resolveExistingPath,
} from './path-policy.js'
export { createRevision, isBinaryContent } from './revision.js'
export {
  WorkspaceService,
  type WorkspaceServiceOptions,
} from './workspace-service.js'
export {
  WorkspaceWatcher,
  type WorkspaceWatcherOptions,
} from './workspace-watcher.js'
