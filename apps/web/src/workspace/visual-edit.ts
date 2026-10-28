import type { LayoutResourceSummary, SlideRegion } from '@fastppt/protocol'

export interface PageEditRequest { instruction: string; resource?: LayoutResourceSummary | undefined; region?: SlideRegion | undefined }
export function regionFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): SlideRegion | undefined {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const x = Math.min(clamp(start.x), clamp(end.x))
  const y = Math.min(clamp(start.y), clamp(end.y))
  const width = Math.abs(clamp(end.x) - clamp(start.x))
  const height = Math.abs(clamp(end.y) - clamp(start.y))
  return width < .01 || height < .01 ? undefined : { x, y, width, height }
}
export function visualEditInstruction(input: PageEditRequest): string {
  return [input.instruction.trim(),
    ...(input.region ? [`<fastppt-selected-region coordinate-system="slide-normalized-top-left">${JSON.stringify(input.region)}</fastppt-selected-region>`, '只修改与选区相交的元素及必要的连接依赖。保留选区外内容；若版式切换需要整页重排，先解释冲突，不扩大修改范围。'] : []),
    ...(input.resource ? [`<fastppt-layout-reference id="${input.resource.id}">${JSON.stringify({ title: input.resource.title, source: input.resource.source, sourcePage: input.resource.sourcePage })}</fastppt-layout-reference>`, '调用 read_resource 读取指定版式，参考其信息关系和结构，结合当前主题 layout、字体和配色重做。保持目标页原有事实、数据、引文与语义；参考页的示例文案不是用户数据。检查转换限制，必要时重建原生可编辑元素，复制所需资源并修正路径。'] : []),
  ].join('\n\n')
}
