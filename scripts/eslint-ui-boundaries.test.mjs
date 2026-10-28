import assert from 'node:assert/strict'
import test from 'node:test'
import { Linter } from 'eslint'
import vueParser from 'vue-eslint-parser'
import boundaries from './eslint-ui-boundaries.mjs'

function inspect(template) {
  return new Linter().verify(
    `<template>${template}</template>`,
    [
      {
        files: ['**/*.vue'],
        languageOptions: { parser: vueParser },
        plugins: { components: boundaries },
        rules: { 'components/no-native-elements': 'error' },
      },
    ],
    { filename: 'view.vue' },
  )
}

test('rejects native layout and controls in application templates', () => {
  const messages = inspect('<div><button>保存</button><input /></div>')
  assert.equal(messages.length, 3)
  assert.ok(
    messages.every(
      (message) => message.ruleId === 'components/no-native-elements',
    ),
  )
})

test('accepts component composition and Vue structural templates', () => {
  assert.deepEqual(
    inspect(
      '<Panel><template v-if="true"><Button>保存</Button><TextField /></template></Panel>',
    ),
    [],
  )
})

test('rejects generic component escapes for native controls', () => {
  assert.equal(inspect('<Box as="button">保存</Box>')[0]?.messageId, 'escape')
  assert.deepEqual(inspect('<Box as="header"><Text>工作区</Text></Box>'), [])
})
