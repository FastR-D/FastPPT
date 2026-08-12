export function cssFontFamilies(value: string): string[] {
  const families: string[] = []
  let current = ''
  let quote = ''

  for (const character of value) {
    if ((character === '"' || character === "'") && !quote) {
      quote = character
      continue
    }
    if (character === quote) {
      quote = ''
      continue
    }
    if (character === ',' && !quote) {
      pushFontFamily(families, current)
      current = ''
      continue
    }
    current += character
  }
  pushFontFamily(families, current)
  return families
}

function pushFontFamily(families: string[], value: string): void {
  const family = value.trim()
  if (family) families.push(family)
}
