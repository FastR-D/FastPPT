/** Geometry in source canvas units, shared by SVG and native PPTX renderers. */
export interface DiagramLayoutInput {
  kind?: 'flowchart' | 'org-chart' | 'gantt' | 'timeline' | 'matrix'
  style: {
    width: number
    height: number
    direction: 'lr' | 'tb'
    fontFamily: string
  }
  nodes: Array<{
    id: string
    label: string
    x?: number | undefined
    y?: number | undefined
    color?: string | undefined
  }>
  edges: Array<{ from: string; to: string; label?: string | undefined }>
  tasks?: Array<{
    id: string
    label: string
    start: string
    end: string
    dependsOn?: string[]
  }>
}
export type DiagramPrimitive =
  | {
      kind: 'rect' | 'ellipse'
      id: string
      x: number
      y: number
      width: number
      height: number
      fill: string
      stroke: string
    }
  | {
      kind: 'text'
      id: string
      x: number
      y: number
      width: number
      height: number
      text: string
      align: 'left' | 'center'
      fontSize: number
    }
  | {
      kind: 'line'
      id: string
      x1: number
      y1: number
      x2: number
      y2: number
      arrow: boolean
    }

export function layoutDiagram(d: DiagramLayoutInput): DiagramPrimitive[] {
  const out: DiagramPrimitive[] = []
  const { width, height, direction } = d.style
  const text = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    align: 'left' | 'center' = 'center',
  ) => {
    out.push({
      kind: 'text',
      id,
      text: label,
      x,
      y,
      width: w,
      height: h,
      align,
      fontSize: 14,
    })
  }
  if (d.kind === 'gantt' || d.kind === 'timeline') {
    const tasks = d.tasks ?? []
    if (!tasks.length) return out
    const dates = tasks.flatMap((t) => [Date.parse(t.start), Date.parse(t.end)])
    if (dates.some((date) => !Number.isFinite(date)))
      throw new Error('Invalid diagram task date')
    const start = Math.min(...dates),
      span = Math.max(1, Math.max(...dates) - start)
    const left = width * (d.kind === 'gantt' ? 0.25 : 0.1),
      right = width * 0.9
    const position = (date: string) =>
      left + ((Date.parse(date) - start) / span) * (right - left)
    if (d.kind === 'timeline') {
      const y = height / 2
      out.push({
        kind: 'line',
        id: 'axis',
        x1: left,
        y1: y,
        x2: right,
        y2: y,
        arrow: false,
      })
      tasks.forEach((task, i) => {
        const x = position(task.start),
          labelY = y + (i % 2 ? 25 : -55)
        out.push({
          kind: 'ellipse',
          id: task.id,
          x: x - 7,
          y: y - 7,
          width: 14,
          height: 14,
          fill: '#2563eb',
          stroke: '#1d4ed8',
        })
        text(
          `${task.id}-label`,
          task.label,
          x - width * 0.08,
          labelY,
          width * 0.16,
          30,
        )
      })
    } else {
      const row = Math.min(55, (height * 0.8) / tasks.length)
      tasks.forEach((task, i) => {
        if (Date.parse(task.end) < Date.parse(task.start))
          throw new Error(`Task ends before it starts: ${task.id}`)
        const y = height * 0.1 + i * row
        text(
          `${task.id}-label`,
          task.label,
          width * 0.04,
          y,
          width * 0.19,
          row,
          'left',
        )
        const x = position(task.start),
          barWidth = Math.max(2, position(task.end) - x)
        out.push({
          kind: 'rect',
          id: task.id,
          x,
          y: y + row * 0.15,
          width: barWidth,
          height: row * 0.7,
          fill: '#2563eb',
          stroke: '#1d4ed8',
        })
      })
    }
    return out
  }
  const nodes = d.nodes.map((node, i) => ({
    ...node,
    x:
      node.x ??
      (direction === 'lr' ? 80 + (i % 5) * 220 : 80 + Math.floor(i / 3) * 350),
    y:
      node.y ??
      (direction === 'lr' ? 80 + Math.floor(i / 5) * 130 : 80 + (i % 3) * 150),
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  d.edges.forEach((edge, i) => {
    const a = byId.get(edge.from),
      b = byId.get(edge.to)
    if (!a || !b) return
    const x1 = a.x + (direction === 'lr' ? 160 : 80),
      y1 = a.y + (direction === 'lr' ? 30 : 60)
    const x2 = b.x + (direction === 'lr' ? 0 : 80),
      y2 = b.y + (direction === 'lr' ? 30 : 0)
    out.push({ kind: 'line', id: `edge-${i}`, x1, y1, x2, y2, arrow: true })
    if (edge.label)
      text(
        `edge-${i}-label`,
        edge.label,
        (x1 + x2) / 2 - 60,
        (y1 + y2) / 2 - 24,
        120,
        24,
      )
  })
  nodes.forEach((n) => {
    out.push({
      kind: 'rect',
      id: n.id,
      x: n.x,
      y: n.y,
      width: 160,
      height: 60,
      fill: n.color ?? '#e2e8f0',
      stroke: '#334155',
    })
    text(`${n.id}-label`, n.label, n.x, n.y + 18, 160, 24)
  })
  return out
}
