export interface NativeMotionEffect { id: string; target: string; durationMs: number; params?: Record<string, unknown> }
export function motionFormula(source: string | number, variables?: Record<string, number>): number
export function nativeMotionFrame(effect: NativeMotionEffect, metrics: { x:number; y:number; width:number; height:number; canvasWidth:number; canvasHeight:number; rotation?:number }, progress:number): Record<string,string|number>
export function applyNativeMotion(element: HTMLElement, effect: NativeMotionEffect, elapsedMs:number): void
export function resetNativeMotion(root?: Element): void
export function orderedNativeEffects<T extends {params?: Record<string,unknown>}>(groups: readonly {effects: T[]}[]): T[]
