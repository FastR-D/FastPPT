import { createHash } from 'node:crypto'

export function createRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('base64url')
}

export function isBinaryContent(content: Uint8Array): boolean {
  if (content.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content)
    return false
  } catch {
    return true
  }
}
