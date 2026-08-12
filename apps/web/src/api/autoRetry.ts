const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 10_000

/**
 * True when `cause` is a network-level failure (fetch rejected — gateway not
 * running) rather than a gateway HTTP error. HTTP errors carry a `status` and
 * are surfaced to the user instead of being retried, so a 401/500 never loops.
 */
export function isConnectivityError(cause: unknown): boolean {
  return cause instanceof TypeError
}

/**
 * Exponential backoff for automatic reconnection, mirroring the SSE stream
 * retry policy (500ms × 2ⁿ, capped at 10s). Each store keeps one instance so
 * manual retries can cancel a pending automatic retry.
 */
export function createConnectivityRetry() {
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  /** Schedule `run` after the next backoff step (replaces any pending one). */
  function schedule(run: () => void): void {
    clearTimeout(timer)
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt++, RETRY_MAX_MS)
    timer = setTimeout(run, delay)
  }

  /** Reset the backoff counter after a successful attempt. */
  function reset(): void {
    attempt = 0
  }

  /** Cancel a pending retry (manual reload / unmount). */
  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return { schedule, reset, cancel }
}
