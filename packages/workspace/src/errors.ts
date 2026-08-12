export type WorkspaceErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'FILE_REVISION_CONFLICT'
  | 'INVALID_REQUEST'

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}
