import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DecorStore, DecorVariant } from '../composables/decor-store'

type Next = () => void

type DecorSaveMiddlewareOptions = {
  store: DecorStore
  expectedOrigin?: string
  maxBytes?: number
}

export const MAX_DECOR_SAVE_BYTES = 1024 * 1024
const SAVE_PATH = '/__decor-library/save'

class RequestBodyTooLargeError extends Error {}

function drainRequest(req: IncomingMessage) {
  const cleanup = () => {
    req.off('error', cleanup)
    req.off('end', cleanup)
    req.off('close', cleanup)
  }

  req.once('error', cleanup)
  req.once('end', cleanup)
  req.once('close', cleanup)
  req.resume()
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.byteLength

      if (bytes > maxBytes) {
        chunks.length = 0
        cleanup()
        drainRequest(req)
        reject(new RequestBodyTooLargeError('Request body exceeds 1 MiB'))
        return
      }

      chunks.push(buffer)
    }
    const onEnd = () => {
      cleanup()

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      }
      catch (error) {
        reject(error)
      }
    }
    const onError = (error: Error) => fail(error)
    const onAborted = () => fail(new Error('Request aborted'))

    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
    req.on('data', onData)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}

function sendError(res: ServerResponse, status: number, error: string) {
  sendJson(res, status, { ok: false, error })
}

function sendInternalError(res: ServerResponse, error: unknown) {
  sendError(
    res,
    500,
    error instanceof Error ? error.message : 'Unknown save error',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getHeader(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()]

  return Array.isArray(value) ? value[0] : value
}

function isJsonRequest(req: IncomingMessage) {
  const contentType = getHeader(req, 'content-type')

  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

function normalizeOrigin(value: string) {
  const url = new URL(value)

  if (
    url.origin === 'null'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    return null
  }

  return url.origin
}

function readRequestOrigin(req: IncomingMessage) {
  const host = getHeader(req, 'host')
  if (!host)
    return null

  const protocol = (req.socket as { encrypted?: boolean } | undefined)?.encrypted
    ? 'https'
    : 'http'

  try {
    return normalizeOrigin(`${protocol}://${host}`)
  }
  catch {
    return null
  }
}

function isSameOriginRequest(req: IncomingMessage, expectedOrigin?: string) {
  const origin = getHeader(req, 'origin')
  if (!origin)
    return false

  try {
    const normalizedOrigin = normalizeOrigin(origin)
    const normalizedExpectedOrigin = expectedOrigin == null
      ? readRequestOrigin(req)
      : normalizeOrigin(expectedOrigin)

    return normalizedOrigin !== null && normalizedOrigin === normalizedExpectedOrigin
  }
  catch {
    return false
  }
}

function isCrossSiteRequest(req: IncomingMessage) {
  return getHeader(req, 'sec-fetch-site') === 'cross-site'
}

function parseRequestPathname(req: IncomingMessage) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  }
  catch {
    return null
  }
}

export function createDecorSaveMiddleware({
  store,
  expectedOrigin,
  maxBytes = MAX_DECOR_SAVE_BYTES,
}: DecorSaveMiddlewareOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const pathname = parseRequestPathname(req)

    if (pathname === null) {
      sendError(res, 400, 'Invalid request URL')
      return
    }

    if (pathname !== SAVE_PATH) {
      next()
      return
    }

    if (req.method !== 'POST') {
      sendError(res, 405, 'Method not allowed')
      return
    }

    if (!isJsonRequest(req)) {
      sendError(res, 415, 'Expected application/json')
      return
    }

    if (!isSameOriginRequest(req, expectedOrigin) || isCrossSiteRequest(req)) {
      sendError(res, 403, 'Forbidden origin')
      return
    }

    let payload: unknown

    try {
      payload = await readJsonBody(req, maxBytes)
    }
    catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendError(res, 413, error.message)
        return
      }

      if (error instanceof SyntaxError) {
        sendError(res, 400, 'Invalid JSON')
        return
      }

      sendInternalError(res, error)
      return
    }

    const overrides = isRecord(payload) ? payload.overrides : null
    if (!Array.isArray(overrides)) {
      sendError(res, 400, 'Expected overrides array')
      return
    }

    try {
      sendJson(res, 200, await store.save(overrides as DecorVariant[]))
    }
    catch (error) {
      sendInternalError(res, error)
    }
  }
}
