import { describe, expect, it } from 'vitest'
import {
  CreationWizardSchema,
  SessionDeckProfileSchema,
} from '@fastppt/protocol'
import {
  applyWizardProfile,
  readWizardChoice,
  wizardRoute,
} from '../../src/workspace/creation-wizard.js'

const timestamp = '2026-09-28T00:00:00.000Z'
const wizard = CreationWizardSchema.parse({
  id: 'draft',
  version: 1,
  updatedAt: timestamp,
  decisions: [
    {
      version: 1,
      stepId: 'task',
      question: '任务',
      options: [],
      selected: JSON.stringify({
        choice: '基于现有 deck',
        note: '保留原始内容',
      }),
      actor: 'user',
      locked: true,
      timestamp,
    },
    {
      version: 1,
      stepId: 'delivery',
      question: '交付',
      options: [],
      selected: JSON.stringify({
        choice: '页面对象 + 动画',
        note: '保留这一步',
      }),
      actor: 'user',
      timestamp,
    },
  ],
})
const profile = SessionDeckProfileSchema.parse({
  version: 1,
  artifactRoute: 'edit-slidev',
  audience: '读者',
  communicationIntent: 'briefing',
  narrativeMode: 'briefing',
  language: 'zh-CN',
  theme: { mode: 'registered', themeId: 'test' },
  preservation: {},
  reviewPolicy: 'standard',
})

describe('creation wizard handoff', () => {
  it('restores choice and notes separately, including legacy drafts', () => {
    expect(readWizardChoice(wizard.decisions[0])).toEqual({
      choice: '基于现有 deck',
      note: '保留原始内容',
    })
    expect(
      readWizardChoice({
        ...wizard.decisions[0]!,
        selected: '基于现有 deck；保留原始内容',
      }),
    ).toEqual({ choice: '基于现有 deck', note: '保留原始内容' })
    expect(readWizardChoice(undefined)).toEqual({ choice: '', note: '' })
  })
  it('carries decisions and delivery options through protocol parsing into the session', () => {
    expect(wizardRoute(wizard)).toBe('edit-slidev')
    const saved = SessionDeckProfileSchema.parse(
      applyWizardProfile(profile, wizard),
    )
    expect(saved.creationDecisions).toEqual(wizard.decisions)
    expect(saved.deliveryOptions).toEqual({
      master: false,
      notes: false,
      animations: true,
    })
    expect(wizard.decisions[1]?.selected).toContain('保留这一步')
  })
  it('refuses a route change that conflicts with a locked user choice', () => {
    expect(() =>
      applyWizardProfile({ ...profile, artifactRoute: 'generate' }, wizard),
    ).toThrow('已锁定')
  })
})
