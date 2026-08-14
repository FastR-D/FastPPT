/** Typed declarations for packages that ship no TypeScript types. */

declare module 'subset-font' {
  export interface SubsetFontOptions {
    targetFormat?: 'sfnt' | 'woff' | 'woff2'
    variationAxes?: Record<
      string,
      | number
      | {
          min: number
          max: number
          default: number
        }
    >
    preflight?: boolean
    hinting?: boolean
    layoutFeatures?: string[]
    nameID?: string[]
  }
  export default function subsetFont(
    input: Uint8Array | ArrayBuffer | Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Uint8Array>
}

declare module 'ttf2eot' {
  export default function ttf2eot(input: Uint8Array | Buffer): Uint8Array
}
