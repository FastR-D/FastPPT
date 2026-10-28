export interface TextDecorations { underline?: boolean | undefined; strike?: boolean | undefined }
export function validateTextDecorations(value: TextDecorations): void
export function sourceTextDecorations(style: TextDecorations, overrides?: TextDecorations): TextDecorations
export function textDecorationLine(style: TextDecorations): string
export function readTextDecorationContract(element: Element, attribute: string): TextDecorations | undefined
