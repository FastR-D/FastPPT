/** Ambient declarations for transitive deps of @fastppt/slidewave source. */
declare module 'subset-font' {
  export default function subsetFont(
    input: Uint8Array | ArrayBuffer | Buffer,
    text: string,
    options?: { targetFormat?: 'sfnt' | 'woff' | 'woff2'; variationAxes?: Record<string, number> },
  ): Promise<Uint8Array>
}
declare module 'ttf2eot' {
  export default function ttf2eot(input: Uint8Array | Buffer): Uint8Array
}
