/** DrawingML rPr@spc (ST_TextPoint) uses signed hundredths of a point. */
export const textLetterSpacingCompatibility = 'Character spacing is preserved in native text. LibreOffice 7.3.7.2 can add spacing at Latin/CJK boundaries even with the requested installed fonts; verify mixed-script spacing and wrapping in the target application.'

export function validateTextLetterSpacing(value) {
  if (value.letterSpacing !== undefined && (!Number.isFinite(value.letterSpacing) || Math.abs(value.letterSpacing) > 4000))
    throw new Error('Invalid text letterSpacing; expected finite points between -4000 and 4000.')
}

export function parseSourceLetterSpacing(value) {
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) return undefined
  const letterSpacing = Number(value) / 100
  try { validateTextLetterSpacing({ letterSpacing }) } catch { return undefined }
  return letterSpacing
}
