import assert from 'node:assert/strict'
import test from 'node:test'
import { preserveTextFrameTabs } from './lib/text-frame-tabs.mjs'

test('preserves literal and encoded tabs only inside explicit text frames', () => {
  const source = '<template><p>A\tB</p><div data-fastppt-text-box><p>A\t<span>&#9;</span>&#x0009;&Tab;B</p></div><p>&#9;</p></template>'
  const result = preserveTextFrameTabs(source)
  assert.equal(result.match(/data-fastppt-source-tab/g).length, 4)
  assert.ok(result.includes('<p>A\tB</p>'))
  assert.ok(result.endsWith('<p>&#9;</p></template>'))
  assert.equal(preserveTextFrameTabs(result), result)
})

test('does not reinterpret attributes, comments, raw content, or Vue expression strings', () => {
  const source = '<template><div title="data-fastppt-text-box">A\tB</div><div data-fastppt-text-box><p title="a\tb > c">{{ "\t" }}\tB</p><!-- \t <div> --><script>"\t"</script><textarea>A\tB</textarea><pre>A\tB</pre></div></template>'
  const result = preserveTextFrameTabs(source)
  assert.equal(result.match(/data-fastppt-source-tab/g).length, 1)
  for (const value of ['title="a\tb > c"', '{{ "\t" }}', '<!-- \t <div> -->', '<script>"\t"</script>', '<textarea>A\tB</textarea>', '<pre>A\tB</pre>']) assert.ok(result.includes(value))
})


test('retains regex, template and nested expression source up to Vue delimiters', () => {
  const expressions = ["{{ /'/.test(value) }}", '{{ `prefix ${value}` }}', '{{ ({ a: { b: value } }).a.b }}']
  for (const expression of expressions) {
    const source = `<div data-fastppt-text-box>${expression}\tB</div>`
    const result = preserveTextFrameTabs(source)
    assert.ok(result.includes(expression))
    assert.equal(result.match(/data-fastppt-source-tab/g).length, 1)
  }
})
