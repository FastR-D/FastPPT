/** Script routing for explicit DrawingML Latin, East Asian and complex faces. */
export function fontScript(character: string, preceding: 'latin' | 'ea' | 'cs' = 'latin'): 'latin' | 'ea' | 'cs' {
  if (/\p{Script=Inherited}/u.test(character)) return preceding
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u.test(character)) return 'ea'
  const point = character.codePointAt(0) ?? 0
  if ((point >= 0x3000 && point <= 0x303f) || (point >= 0xff00 && point <= 0xffef)) return 'ea'
  if (/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u.test(character)) return 'cs'
  return 'latin'
}
