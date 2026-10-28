export function sourceBulletContext(paragraph: HTMLElement): {
  marker: HTMLElement; anchor: HTMLElement; label: HTMLElement; baseline: HTMLElement
  rect: DOMRect; scale: number; units: number; indent: number; advance: number; prefix: number; visible: boolean
}
export function syncSourceBulletGeometry(paragraph: HTMLElement, positionOnly?: boolean): void
