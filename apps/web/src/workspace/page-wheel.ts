type WheelInput = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'>

/** Accumulate trackpad motion and limit mouse-wheel bursts to deliberate page turns. */
export function createPageWheelHandler(
  navigate: (direction: -1 | 1) => void,
  enabled: () => boolean = () => true,
  now: () => number = () => performance.now(),
): (event: WheelInput) => void {
  let accumulated = 0
  let lastEvent = -Infinity
  let lastTurn = -Infinity
  let direction = 0
  return (event) => {
    if (!enabled() || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    event.preventDefault()
    const time = now()
    const nextDirection = event.deltaY > 0 ? 1 : -1
    if (time - lastEvent > 180 || direction !== nextDirection) accumulated = 0
    lastEvent = time
    direction = nextDirection
    if (time - lastTurn < 220) return
    accumulated += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1)
    if (Math.abs(accumulated) < 48) return
    accumulated = 0
    lastTurn = time
    navigate(nextDirection)
  }
}
