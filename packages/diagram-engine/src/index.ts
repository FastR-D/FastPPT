import { layoutDiagram } from '@fastppt/slidewave/diagram-layout'
export { layoutDiagram } from '@fastppt/slidewave/diagram-layout'
import { z } from 'zod'
import { digest } from '@fastppt/presentation-ir'
export const DiagramKindSchema = z.enum([
  'flowchart',
  'gantt',
  'timeline',
  'matrix',
  'org-chart',
])
export const DiagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(300),
  x: z.number().optional(),
  y: z.number().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
})
export const DiagramDocumentV1Schema = z.object({
  version: z.literal(1),
  kind: DiagramKindSchema,
  nodes: z.array(DiagramNodeSchema).max(500),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .default([]),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        start: z.iso.datetime(),
        end: z.iso.datetime(),
        dependsOn: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  style: z
    .object({
      width: z.number().positive().default(1200),
      height: z.number().positive().default(700),
      direction: z.enum(['lr', 'tb']).default('lr'),
      fontFamily: z.string().default('Arial'),
    })
    .default({
      width: 1200,
      height: 700,
      direction: 'lr',
      fontFamily: 'Arial',
    }),
  sourcePrompt: z.string().optional(),
  acceptedRevision: z.number().int().nonnegative().default(0),
  digest: z.string().optional(),
})
export type DiagramDocumentV1 = z.infer<typeof DiagramDocumentV1Schema>
export function validateDiagram(input: unknown) {
  const d = DiagramDocumentV1Schema.safeParse(input)
  if (!d.success)
    return { ok: false, issues: d.error.issues.map((i) => i.message) }
  const ids = new Set(d.data.nodes.map((n) => n.id))
  const issues: string[] = []
  for (const e of d.data.edges)
    if (!ids.has(e.from) || !ids.has(e.to))
      issues.push(`Unknown edge endpoint: ${e.from}->${e.to}`)
  const positions = d.data.nodes.map((n, i) => ({
    n,
    x:
      n.x ??
      (d.data.style.direction === 'lr'
        ? 80 + (i % 5) * 220
        : 80 + Math.floor(i / 3) * 350),
    y:
      n.y ??
      (d.data.style.direction === 'lr'
        ? 80 + Math.floor(i / 5) * 130
        : 80 + (i % 3) * 150),
  }))
  const luminance = (hex: string) => {
    const c = hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((v) => Number.parseInt(v, 16) / 255) ?? [0, 0, 0]
    const lin = c.map((v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    )
    return (
      0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0)
    )
  }
  for (const { n, x, y } of positions) {
    if (
      x < 0 ||
      y < 0 ||
      x + 160 > d.data.style.width ||
      y + 60 > d.data.style.height
    )
      issues.push(`Node exceeds diagram bounds: ${n.id}`)
    if (n.label.length > 80) issues.push(`Node label may overflow: ${n.id}`)
    if (
      n.color &&
      (Math.max(luminance(n.color), luminance('#334155')) + 0.05) /
        (Math.min(luminance(n.color), luminance('#334155')) + 0.05) <
        3
    )
      issues.push(`Node text contrast is low: ${n.id}`)
  }
  const graph = new Map<string, string[]>()
  for (const e of d.data.edges)
    if (ids.has(e.from) && ids.has(e.to))
      graph.set(e.from, [...(graph.get(e.from) ?? []), e.to])
  const visiting = new Set<string>(),
    visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      issues.push(`Cyclic dependency detected at: ${id}`)
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const next of graph.get(id) ?? []) visit(next)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
  const taskIds = new Set(d.data.tasks.map((task) => task.id))
  for (const task of d.data.tasks) {
    if (Date.parse(task.end) < Date.parse(task.start))
      issues.push(`Task ends before it starts: ${task.id}`)
    for (const dependency of task.dependsOn)
      if (!taskIds.has(dependency))
        issues.push(`Unknown task dependency: ${task.id}->${dependency}`)
  }
  const taskVisiting = new Set<string>(),
    taskVisited = new Set<string>()
  const visitTask = (id: string): void => {
    if (taskVisiting.has(id)) {
      issues.push(`Cyclic task dependency detected at: ${id}`)
      return
    }
    if (taskVisited.has(id)) return
    taskVisiting.add(id)
    for (const next of d.data.tasks.find((task) => task.id === id)?.dependsOn ??
      [])
      visitTask(next)
    taskVisiting.delete(id)
    taskVisited.add(id)
  }
  for (const id of taskIds) visitTask(id)
  return { ok: issues.length === 0, issues }
}
export function renderDiagram(input: unknown): string {
  const d = DiagramDocumentV1Schema.parse(input)
  const body = layoutDiagram(d)
    .map((p) => {
      if (p.kind === 'text')
        return `<text data-id="${esc(p.id)}" x="${p.x + (p.align === 'center' ? p.width / 2 : 0)}" y="${p.y + p.height / 2}" dominant-baseline="middle" text-anchor="${p.align === 'center' ? 'middle' : 'start'}" font-family="${esc(d.style.fontFamily)}" font-size="${p.fontSize}" fill="#334155">${esc(p.text)}</text>`
      if (p.kind === 'line')
        return `<path data-id="${esc(p.id)}" d="M${p.x1} ${p.y1} L${p.x2} ${p.y2}" stroke="#64748b" fill="none"${p.arrow ? ' marker-end="url(#arrow)"' : ''}/>`
      if (p.kind === 'ellipse')
        return `<ellipse data-id="${esc(p.id)}" cx="${p.x + p.width / 2}" cy="${p.y + p.height / 2}" rx="${p.width / 2}" ry="${p.height / 2}" fill="${p.fill}" stroke="${p.stroke}"/>`
      return `<rect data-id="${esc(p.id)}" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="6" fill="${p.fill}" stroke="${p.stroke}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.style.width}" height="${d.style.height}" viewBox="0 0 ${d.style.width} ${d.style.height}" role="img" aria-label="${d.kind}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker></defs>${body}</svg>`
}
function esc(v: string) {
  return v.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
}
export function diagramDigest(input: unknown) {
  return digest(DiagramDocumentV1Schema.parse(input))
}
