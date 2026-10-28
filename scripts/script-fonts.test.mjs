import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveSourceTextStyle,
  sourceParagraphCss,
  scriptTextRuns,
} from './lib/script-fonts.mjs'

test('script routing preserves combining sequences, supplementary CJK and emoji graphemes', () => {
  const source = 'Cafe\u0301 𠀀か\u3099 عَرَبِي 👩‍💻'
  const runs = scriptTextRuns(source)
  assert.deepEqual(runs, [
    { script: 'latin', text: 'Cafe\u0301 ' },
    { script: 'ea', text: '𠀀か\u3099' },
    { script: 'latin', text: ' ' },
    { script: 'cs', text: 'عَرَبِي' },
    { script: 'latin', text: ' 👩‍💻' },
  ])
  assert.equal(runs.map((run) => run.text).join(''), source)
})

test('script routing does not trim spacing or reinterpret text as markup', () => {
  const source = '  {{title}} <script> & 中文，\n日本語\tעברית  '
  assert.equal(
    scriptTextRuns(source)
      .map((run) => run.text)
      .join(''),
    source,
  )
  assert.deepEqual(scriptTextRuns(''), [])
})

test('browser paragraph projection keeps zero overrides local to their level and scales absolute spacing', () => {
  const style = {
    fontFamily: 'Base',
    fontFamilies: { ea: 'CJK' },
    bold: true,
    fontSize: 24,
    paragraph: {
      marginLeft: 900000,
      spaceBefore: { unit: 'points', value: 6 },
    },
    levels: [
      {
        level: 2,
        textStyle: { bold: false, fontFamily: 'Uniform', fontSize: 16 },
        paragraph: {
          marginLeft: 0,
          spaceBefore: { unit: 'points', value: 0 },
          lineSpacing: { unit: 'percent', value: 150 },
        },
      },
    ],
  }
  const before = structuredClone(style)
  const first = resolveSourceTextStyle(style, 1)
  const second = resolveSourceTextStyle(style, 2)
  assert.deepEqual(resolveSourceTextStyle(style, 3), first)
  assert.equal(second.fontFamilies, undefined)
  const css = sourceParagraphCss(second, 10000000)
  assert.equal(css.fontWeight, '400')
  assert.equal(css.marginLeft, '0cqw')
  assert.equal(css.marginTop, '0cqw')
  assert.equal(css.lineHeight, '1.5')
  assert.equal(css.fontSize, '2.032cqw')
  assert.equal(sourceParagraphCss(first, 10000000).marginTop, '0.762cqw')
  assert.deepEqual(style, before)
})
