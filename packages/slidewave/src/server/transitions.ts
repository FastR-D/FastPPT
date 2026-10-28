export type NativeSlideTransition = 'none' | 'fade' | 'push' | 'wipe' | 'morph' | {
  kind: 'none' | 'fade' | 'push' | 'wipe' | 'morph'
  durationMs?: number | undefined
  direction?: string | undefined
}
export function transitionXml(input: NativeSlideTransition): string | undefined {
  const transition = typeof input === 'string' ? { kind: input } : input
  if (!['none', 'fade', 'push', 'wipe', 'morph'].includes(transition.kind)) throw new Error('Unsupported slide transition.')
  if (transition.durationMs !== undefined && (!Number.isFinite(transition.durationMs) || transition.durationMs <= 0 || transition.durationMs > 4294967295)) throw new Error('Invalid slide transition duration.')
  const directions: Record<string, string> = { left: 'l', right: 'r', up: 'u', down: 'd', l: 'l', r: 'r', u: 'u', d: 'd' }
  const direction = transition.direction === undefined ? 'l' : directions[transition.direction]
  if (!direction) throw new Error('Invalid slide transition direction.')
  if (transition.kind === 'none') return undefined
  const effect = transition.kind === 'push' || transition.kind === 'wipe' ? `<p:${transition.kind} dir="${direction}"/>` : '<p:fade/>'
  if (transition.durationMs === undefined) return `<p:transition spd="med">${effect}</p:transition>`
  const duration = Math.max(1, Math.round(transition.durationMs))
  const speed = duration < 500 ? 'fast' : duration > 1000 ? 'slow' : 'med'
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><mc:Choice Requires="p14"><p:transition spd="${speed}" p14:dur="${duration}">${effect}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${speed}">${effect}</p:transition></mc:Fallback></mc:AlternateContent>`
}
