export type DecimalTabProfileId = 'libreoffice-7.3.7.2-linux-en-US' | 'libreoffice-7.3.7.2-linux-de-DE' | 'libreoffice-7.3.7.2-linux-fr-FR'
export interface DecimalTab { separator: '.' | ','; provenance: 'user-declared'; reason: string; targetProfile: DecimalTabProfileId }
export const decimalTabProfiles: Readonly<Record<DecimalTabProfileId, Readonly<{ locale: string; separator: '.' | ','; application: string; platform: string; evidencePath: string; evidenceSha256: string; measurementBasis: 'diagnostic-indent-removed'; compatibility: 'known-difference' }>>>
export function validateDecimalTab(value: unknown): asserts value is DecimalTab
export function validateDecimalTabDeclaration(value: unknown, sourceHash: string): asserts value is { version: 1; sourcePptxSha256: string; decimalTab: DecimalTab }
export function decimalTabCompatibility(value?: DecimalTab | null): string
export interface TextTabStop { position: number; align: 'left' | 'center' | 'right' | 'decimal' }
export interface TextTabs { defaultTabSize?: number | undefined; tabStops?: TextTabStop[] | undefined; decimalTab?: DecimalTab | null | undefined }
export function validateTextTabs(value: TextTabs): void
export function resolveTextTab(cursor: number, defaultSize: number, stops: TextTabStop[], fieldWidth: number, decimalOffset?: number): TextTabStop & { width: number }
export interface SourceTabField { marker: HTMLElement; ranges: Range[] }
export function sourceTabFields(paragraph: HTMLElement): SourceTabField[]
export function measureTabField(field: SourceTabField, scale: number): number
export function measureDecimalTabOffset(field: SourceTabField, scale: number, separator: string): number
export function sourceTabContext(paragraph: HTMLElement): { contract: TextTabs; css: CSSStyleDeclaration; rect: DOMRect; scale: number; units: number; defaultSize: number; stops: TextTabStop[] }
export function syncSourceTabs(paragraph: HTMLElement): void
