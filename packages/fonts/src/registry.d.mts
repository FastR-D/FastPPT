export interface FontFile {
  /** Path to the font binary, relative to the package root. */
  file: string
  /** SPDX / short license identifier. */
  license: string
  /** True when the file is a variable font covering a weight axis. */
  variable?: boolean
  subset?: boolean
  /** Static font weight (when not variable). */
  weight?: number
  /** Font style. */
  style?: 'normal' | 'italic'
  faces?: Partial<
    Record<
      'regular' | 'bold' | 'italic' | 'boldItalic',
      Omit<FontFile, 'faces' | 'license'>
    >
  >
}

export declare const FONT_FILES: Record<string, FontFile>
export declare const OPTIONAL_FONT_FILES: Record<string, FontFile>

/** Resolve a family's bundled font path, or undefined when not in the catalog. */
export declare function resolveFontPath(family: string): string | undefined

export interface ResolvedFontFile extends FontFile {
  path: string
  faces?: Partial<
    Record<
      'regular' | 'bold' | 'italic' | 'boldItalic',
      { path: string; variable?: boolean; subset?: boolean }
    >
  >
}

/** Resolve a family to its descriptor (path + metadata), or undefined. */
export declare function resolveFontDescriptor(
  family: string,
): ResolvedFontFile | undefined
