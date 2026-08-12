import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const STATIC_PREFIXES = ['/assets/', '/theme/']
const MAX_DECODE_PASSES = 10
const ALLOWED_LOCAL_STORAGE_WARNING = '`--localstorage-file` was provided without a valid path'

export function classifyBrowserConsoleMessage(type, text) {
  if (type === 'warning' && text === ALLOWED_LOCAL_STORAGE_WARNING)
    return 'allowed'

  if (type === 'error')
    return 'rejected'

  return 'ignored'
}

export function isSameOriginUrl(origin, candidateUrl) {
  try {
    return new URL(candidateUrl).origin === new URL(origin).origin
  }
  catch {
    return false
  }
}

export function createInFlightRequestTracker({
  clearTimer = clearTimeout,
  idleMs = 150,
  origin,
  setTimer = setTimeout,
  timeoutMs = 15_000,
}) {
  const expectedOrigin = new URL(origin).origin
  const inFlight = new Set()
  const waiters = new Set()
  let disposed = false

  function isSameOrigin(request) {
    try {
      const requestUrl = typeof request === 'string' ? request : request.url()
      return isSameOriginUrl(expectedOrigin, requestUrl)
    }
    catch {
      return false
    }
  }

  function clearIdleTimer(waiter) {
    if (waiter.idleTimer === undefined)
      return

    clearTimer(waiter.idleTimer)
    waiter.idleTimer = undefined
  }

  function removeWaiter(waiter) {
    if (!waiters.delete(waiter))
      return false

    clearIdleTimer(waiter)
    if (waiter.timeoutTimer !== undefined) {
      clearTimer(waiter.timeoutTimer)
      waiter.timeoutTimer = undefined
    }

    return true
  }

  function resolveWaiter(waiter) {
    if (!removeWaiter(waiter))
      return

    waiter.resolve()
  }

  function rejectWaiter(waiter, error) {
    if (!removeWaiter(waiter))
      return

    waiter.reject(error)
  }

  function armIdleTimer(waiter) {
    clearIdleTimer(waiter)
    if (inFlight.size > 0)
      return

    waiter.idleTimer = setTimer(() => resolveWaiter(waiter), idleMs)
  }

  return {
    dispose() {
      if (disposed)
        return

      disposed = true
      inFlight.clear()
      for (const waiter of [...waiters])
        rejectWaiter(waiter, new Error('in-flight tracker остановлен'))
    },
    requestSettled(request) {
      if (!inFlight.delete(request) || inFlight.size > 0)
        return

      for (const waiter of waiters)
        armIdleTimer(waiter)
    },
    requestStarted(request) {
      if (disposed || !isSameOrigin(request))
        return

      inFlight.add(request)
      for (const waiter of waiters)
        clearIdleTimer(waiter)
    },
    get size() {
      return inFlight.size
    },
    waitForIdle() {
      if (disposed)
        return Promise.reject(new Error('in-flight tracker остановлен'))

      return new Promise((resolveIdle, rejectIdle) => {
        const waiter = {
          idleTimer: undefined,
          reject: rejectIdle,
          resolve: resolveIdle,
          timeoutTimer: undefined,
        }
        waiters.add(waiter)
        waiter.timeoutTimer = setTimer(() => {
          rejectWaiter(
            waiter,
            new Error(`не дождался завершения same-origin requests за ${timeoutMs} ms`),
          )
        }, timeoutMs)
        armIdleTimer(waiter)
      })
    },
  }
}

function withoutQueryOrHash(value) {
  const queryIndex = value.indexOf('?')
  const hashIndex = value.indexOf('#')
  const indexes = [queryIndex, hashIndex].filter(index => index >= 0)

  return indexes.length === 0 ? value : value.slice(0, Math.min(...indexes))
}

function decodePathname(pathname) {
  if (typeof pathname !== 'string')
    return null

  let decoded = withoutQueryOrHash(pathname)
  if (!decoded.startsWith('/'))
    return null

  try {
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
      const next = decodeURIComponent(decoded)
      if (next === decoded)
        break

      decoded = next
    }
  }
  catch {
    return null
  }

  decoded = decoded.replaceAll('\\', '/')
  if (decoded.includes('\0'))
    return null

  const segments = decoded.split('/')
  if (segments.includes('..'))
    return null

  return decoded
}

function isContained(root, candidate) {
  const relativePath = relative(root, candidate)

  return relativePath === ''
    || (!isAbsolute(relativePath)
      && relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`))
}

function isSafeFile(root, candidate) {
  if (!isContained(root, candidate))
    return false

  const relativePath = relative(root, candidate)
  let current = root

  try {
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = join(current, segment)
      const stat = lstatSync(current)
      if (stat.isSymbolicLink())
        return false
    }

    const stat = lstatSync(candidate)
    if (!stat.isFile())
      return false

    return isContained(realpathSync(root), realpathSync(candidate))
  }
  catch {
    return false
  }
}

function isSpaRoute(pathname) {
  if (STATIC_PREFIXES.some(prefix => pathname.startsWith(prefix)))
    return false

  const lastSegment = pathname.split('/').filter(Boolean).at(-1) ?? ''
  return extname(lastSegment) === ''
}

/**
 * Безопасно сопоставляет URL path с обычным файлом внутри готового dist.
 *
 * @param {string} distDir
 * @param {string} pathname
 * @returns {{ path: string, relativePath: string } | null}
 */
export function resolveDistRequest(distDir, pathname) {
  const decodedPathname = decodePathname(pathname)
  if (decodedPathname === null)
    return null

  const root = resolve(distDir)
  try {
    const rootStat = lstatSync(root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
      return null
  }
  catch {
    return null
  }

  const requestRelativePath = decodedPathname.replace(/^\/+/, '')
  const requestedPath = resolve(root, requestRelativePath)

  if (isSafeFile(root, requestedPath)) {
    return {
      path: requestedPath,
      relativePath: relative(root, requestedPath).split(sep).join('/'),
    }
  }

  try {
    if (lstatSync(requestedPath).isDirectory() && requestedPath !== root)
      return null
  }
  catch {
    // Отсутствующий route ниже может получить SPA fallback.
  }

  if (!isSpaRoute(decodedPathname))
    return null

  const indexPath = join(root, 'index.html')
  if (!isSafeFile(root, indexPath))
    return null

  return {
    path: indexPath,
    relativePath: 'index.html',
  }
}

function contentTypeFor(path) {
  return CONTENT_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream'
}

function sendStatus(response, status, message, headers = {}, omitBody = false) {
  const body = `${message}\n`
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(omitBody ? undefined : body)
}

export function readStaticFile(path, readFile = readFileSync) {
  try {
    return readFile(path)
  }
  catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')
      return null

    throw error
  }
}

async function handleRequest(distDir, request, response, readFile) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendStatus(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD' })
    return
  }

  const requestUrl = request.url ?? ''
  if (!requestUrl.startsWith('/')) {
    sendStatus(response, 400, 'Bad Request', {}, request.method === 'HEAD')
    return
  }

  const resolved = resolveDistRequest(distDir, requestUrl)
  if (resolved === null) {
    sendStatus(response, 404, 'Not Found', {}, request.method === 'HEAD')
    return
  }

  const body = readStaticFile(resolved.path, readFile)
  if (body === null) {
    sendStatus(response, 404, 'Not Found', {}, request.method === 'HEAD')
    return
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': body.byteLength,
    'content-type': contentTypeFor(resolved.path),
    'x-content-type-options': 'nosniff',
  })

  if (request.method === 'HEAD')
    response.end()
  else
    response.end(body)
}

/**
 * Поднимает локальный static server на loopback и случайном свободном порту.
 *
 * @param {string} distDir
 * @param {{ readFile?: (path: string) => Buffer }} options
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function createStaticDistServer(distDir, { readFile = readFileSync } = {}) {
  const root = resolve(distDir)
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error(`dist должен быть обычной директорией: ${root}`)

  const server = createServer((request, response) => {
    handleRequest(root, request, response, readFile).catch(() => {
      if (!response.headersSent)
        sendStatus(response, 500, 'Internal Server Error', {}, request.method === 'HEAD')
      else
        response.destroy()
    })
  })

  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening)
      rejectListen(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolveListen()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('static server не сообщил TCP port')
  }

  let closePromise

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      closePromise ??= new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING')
            rejectClose(error)
          else
            resolveClose()
        })
        server.closeAllConnections?.()
      })

      return closePromise
    },
  }
}
