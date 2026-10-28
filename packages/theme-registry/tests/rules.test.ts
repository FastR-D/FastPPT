import { describe, expect, it } from 'vitest'

import {
  ThemeRulesDocumentSchema,
  evaluateThemeRules,
  themeRuleEvidenceRequirements,
  themeRulesDigest,
} from '../src/index.js'

describe('theme rules', () => {
  it.each([
    { kind: 'first-layout', layout: 'cover' },
    { kind: 'last-layout', layout: 'end' },
    { kind: 'required-layout', layout: 'section' },
    { kind: 'forbidden-layout', layout: 'blank' },
    { kind: 'allowed-layouts', layouts: ['cover', 'default'] },
    { kind: 'layout-position', layout: 'end', positions: ['last'] },
    { kind: 'required-placeholder', layout: 'cover', type: 'title', index: 0 },
    { kind: 'max-text-lines', layout: 'default', value: 4 },
    { kind: 'max-density', layout: 'default', value: 0.8 },
  ])(
    'keeps $kind unverified when the artifact has no layout identity',
    (rule) => {
      const document = ThemeRulesDocumentSchema.parse({
        version: 1,
        rules: [{ id: 'test.rule', severity: 'error', ...rule }],
      })
      for (const layout of [undefined, ''])
        expect(
          evaluateThemeRules({
            document,
            phase: 'readback',
            slides: [
              {
                index: 1,
                layout,
                placeholders: [],
                textLines: 1,
                density: 0.1,
              },
            ],
          }),
        ).toMatchObject([
          {
            ruleId: 'test.rule',
            code: 'THEME_RULE_EVIDENCE_MISSING',
            severity: 'error',
            status: 'unverified',
          },
        ])
    },
  )

  it('does not let an unknown intermediate layout hide an observed closing violation', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [{ id: 'last', kind: 'last-layout', layout: 'end' }],
    })
    expect(
      evaluateThemeRules({
        document,
        phase: 'readback',
        slides: [{ index: 1 }, { index: 2, layout: 'default' }],
      }),
    ).toMatchObject([
      { code: 'THEME_RULE_LAST_LAYOUT', status: 'violation', slide: 2 },
    ])
  })

  it('does not treat sample measurements as evidence for a future authored deck at catalog approval', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        { id: 'lines', kind: 'max-text-lines', value: 5, severity: 'error' },
        { id: 'density', kind: 'max-density', value: 0.7, severity: 'error' },
        {
          id: 'token.required',
          kind: 'required-token',
          token: '--brand',
          severity: 'error',
        },
        {
          id: 'token.forbidden',
          kind: 'forbidden-token',
          token: '--old',
          severity: 'error',
        },
      ],
    })
    const issues = evaluateThemeRules({
      document,
      phase: 'approval',
      slides: [
        {
          index: 1,
          layout: 'default',
          textLines: 1,
          density: 0.1,
          tokens: ['--brand'],
        },
      ],
    })
    expect(issues).toHaveLength(4)
    for (const issue of issues)
      expect(issue).toMatchObject({
        code: 'THEME_RULE_EVIDENCE_MISSING',
        severity: 'needs-human',
        status: 'unverified',
      })
  })

  it('checks layout position only when that layout is used', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'academy.end-position',
          kind: 'layout-position',
          layout: 'end',
          positions: ['last'],
          severity: 'warning',
          provenance: 'derived',
        },
      ],
    })
    expect(
      evaluateThemeRules({
        document,
        phase: 'approval',
        slides: [{ index: 1, layout: 'end' }],
      }),
    ).toEqual([])
    expect(themeRuleEvidenceRequirements(document)[0]?.approval).toBe(
      'not-applicable',
    )
    expect(
      evaluateThemeRules({
        document,
        slides: [{ index: 1, layout: 'custom' }],
      }),
    ).toEqual([])
    expect(
      evaluateThemeRules({
        document,
        phase: 'readback',
        slides: [
          { index: 1, layout: 'end' },
          { index: 2, layout: 'custom' },
        ],
      }),
    ).toMatchObject([
      { code: 'THEME_RULE_LAYOUT_POSITION', slide: 1, severity: 'warning' },
    ])
    expect(
      evaluateThemeRules({
        document,
        slides: [
          { index: 1, layout: 'custom' },
          { index: 2, layout: 'end' },
        ],
      }),
    ).toEqual([])
  })
  it('keeps generated layout proposals advisory for custom pages', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'proposal.registered-layouts',
          kind: 'allowed-layouts',
          layouts: ['cover', 'default'],
          severity: 'warning',
          provenance: 'generated',
        },
      ],
    })
    expect(document.rules[0]?.provenance).toBe('generated')
    expect(
      evaluateThemeRules({
        document,
        phase: 'export',
        slides: [{ index: 1, layout: 'custom' }],
      }),
    ).toMatchObject([
      {
        ruleId: 'proposal.registered-layouts',
        severity: 'warning',
        status: 'violation',
      },
    ])
  })
  it('blocks absent opening and closing layouts in the approval catalog', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'first',
          kind: 'first-layout',
          layout: 'cover',
          severity: 'error',
        },
        { id: 'last', kind: 'last-layout', layout: 'end', severity: 'error' },
      ],
    })
    expect(
      evaluateThemeRules({
        document,
        phase: 'approval',
        slides: [{ index: 1, layout: 'body' }],
      }),
    ).toMatchObject([
      { ruleId: 'first', severity: 'error', status: 'violation' },
      { ruleId: 'last', severity: 'error', status: 'violation' },
    ])
  })
  it('requires a master somewhere in the deck and checks placeholder contracts only on selected layouts', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'master.required',
          kind: 'required-master',
          master: 'brand',
          severity: 'error',
        },
        {
          id: 'slot.title',
          kind: 'required-placeholder',
          layout: 'cover',
          type: 'title',
          index: 0,
          severity: 'error',
        },
      ],
    })
    expect(
      evaluateThemeRules({
        document,
        slides: [
          { index: 1, layout: 'body', master: 'brand' },
          { index: 2, layout: 'body', master: 'secondary' },
        ],
      }),
    ).toEqual([])
    expect(
      evaluateThemeRules({
        document,
        slides: [
          { index: 1, layout: 'cover', master: 'brand', placeholders: [] },
        ],
      }),
    ).toMatchObject([
      {
        status: 'violation',
        code: 'THEME_RULE_PLACEHOLDER_MISSING',
        locator: { layout: 'cover', placeholderIndex: 0 },
      },
    ])
  })

  it('rejects a required placeholder whose layout is absent from the approval catalog', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'slot.title',
          kind: 'required-placeholder',
          layout: 'cover',
          type: 'title',
          index: 0,
          severity: 'error',
        },
      ],
    })
    expect(
      evaluateThemeRules({
        document,
        phase: 'approval',
        slides: [{ index: 1, layout: 'body' }],
      }),
    ).toMatchObject([
      {
        code: 'THEME_RULE_PLACEHOLDER_LAYOUT_MISSING',
        severity: 'error',
        status: 'violation',
        locator: { layout: 'cover', placeholderIndex: 0 },
      },
    ])
    expect(
      evaluateThemeRules({
        document,
        phase: 'export',
        slides: [{ index: 1, layout: 'body' }],
      }),
    ).toEqual([])
  })

  it('defers missing measurements during validation but blocks error rules at export', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'lines.max',
          kind: 'max-text-lines',
          value: 6,
          severity: 'error',
        },
        {
          id: 'token.old',
          kind: 'forbidden-token',
          token: '--old-brand',
          severity: 'warning',
        },
      ],
    })
    const slides = [{ index: 1, layout: 'body' }]
    expect(evaluateThemeRules({ document, slides })).toMatchObject([
      { status: 'unverified', severity: 'needs-human' },
      { status: 'unverified', severity: 'needs-human' },
    ])
    expect(
      evaluateThemeRules({ document, slides, phase: 'export' }),
    ).toMatchObject([
      { status: 'unverified', severity: 'error' },
      { status: 'unverified', severity: 'warning' },
    ])
    expect(
      evaluateThemeRules({
        document,
        slides: [{ ...slides[0]!, textLines: 2, tokens: [] }],
        phase: 'export',
      }),
    ).toEqual([])
  })
  it('never accepts browser metrics or CSS token names as PPTX readback evidence', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'lines.max',
          kind: 'max-text-lines',
          value: 4,
          severity: 'error',
        },
        {
          id: 'density.max',
          kind: 'max-density',
          value: 0.8,
          severity: 'error',
        },
        {
          id: 'token.required',
          kind: 'required-token',
          token: '--brand',
          severity: 'error',
        },
      ],
    })
    const slides = [
      {
        index: 1,
        layout: 'default',
        textLines: 2,
        density: 0.3,
        tokens: ['--brand'],
      },
    ]
    expect(evaluateThemeRules({ document, slides, phase: 'export' })).toEqual(
      [],
    )
    expect(
      evaluateThemeRules({ document, slides, phase: 'readback' }),
    ).toMatchObject([
      {
        ruleId: 'lines.max',
        code: 'THEME_RULE_EVIDENCE_MISSING',
        status: 'unverified',
      },
      {
        ruleId: 'density.max',
        code: 'THEME_RULE_EVIDENCE_MISSING',
        status: 'unverified',
      },
      {
        ruleId: 'token.required',
        code: 'THEME_RULE_EVIDENCE_MISSING',
        status: 'unverified',
      },
    ])
  })
  it('evaluates structural layout rules in page order', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        {
          id: 'deck.first',
          kind: 'first-layout',
          layout: 'cover',
          severity: 'error',
        },
        {
          id: 'deck.last',
          kind: 'last-layout',
          layout: 'end',
          severity: 'warning',
        },
        {
          id: 'deck.required',
          kind: 'required-layout',
          layout: 'section',
          severity: 'error',
        },
        {
          id: 'deck.forbidden',
          kind: 'forbidden-layout',
          layout: 'blank',
          severity: 'error',
        },
      ],
    })
    const issues = evaluateThemeRules({
      document,
      slides: [
        { index: 3, layout: 'blank' },
        { index: 1, layout: 'default' },
        { index: 2, layout: 'default' },
      ],
    })

    expect(issues).toEqual([
      expect.objectContaining({
        ruleId: 'deck.first',
        code: 'THEME_RULE_FIRST_LAYOUT',
        slide: 1,
      }),
      expect.objectContaining({
        ruleId: 'deck.last',
        code: 'THEME_RULE_LAST_LAYOUT',
        slide: 3,
      }),
      expect.objectContaining({
        ruleId: 'deck.required',
        code: 'THEME_RULE_REQUIRED_LAYOUT',
      }),
      expect.objectContaining({
        ruleId: 'deck.forbidden',
        code: 'THEME_RULE_FORBIDDEN_LAYOUT',
        slide: 3,
      }),
    ])
  })

  it('preserves warning severity without changing the rule result', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [{ id: 'deck.max', kind: 'max-slides', value: 1 }],
    })
    expect(
      evaluateThemeRules({
        document,
        slides: [
          { index: 1, layout: 'default' },
          { index: 2, layout: 'default' },
        ],
      }),
    ).toMatchObject([
      {
        ruleId: 'deck.max',
        severity: 'warning',
        code: 'THEME_RULE_MAX_SLIDES',
      },
    ])
  })

  it('produces a stable semantic digest independent of object key order', () => {
    const first = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [{ id: 'deck.max', kind: 'max-slides', value: 8 }],
    })
    const second = ThemeRulesDocumentSchema.parse({
      rules: [{ value: 8, kind: 'max-slides', id: 'deck.max' }],
      version: 1,
    })
    expect(themeRulesDigest(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(themeRulesDigest(first)).toBe(themeRulesDigest(second))
  })

  it('evaluates master, placeholder, token, density and fixed-object rules from evidence', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        { id: 'master.required', kind: 'required-master', master: 'brand' },
        {
          id: 'placeholder.title',
          kind: 'required-placeholder',
          layout: 'cover',
          type: 'title',
          index: 0,
        },
        { id: 'token.primary', kind: 'required-token', token: 'primary' },
        { id: 'token.bad', kind: 'forbidden-token', token: 'deprecated' },
        { id: 'density.max', kind: 'max-density', value: 0.8 },
        {
          id: 'fixed.logo',
          kind: 'fixed-object',
          name: 'logo',
          owner: 'master',
        },
      ],
    })
    const issues = evaluateThemeRules({
      document,
      slides: [
        {
          index: 1,
          layout: 'cover',
          master: 'brand',
          placeholders: [{ index: 0, type: 'title' }],
          tokens: ['primary', 'deprecated'],
          density: 0.9,
          fixedObjects: [{ name: 'logo', owner: 'master' }],
        },
      ],
    })
    expect(issues.map((entry) => entry.code)).toEqual([
      'THEME_RULE_TOKEN_FORBIDDEN',
      'THEME_RULE_DENSITY',
    ])
  })

  it('keeps missing evidence visible instead of treating it as passing', () => {
    const document = ThemeRulesDocumentSchema.parse({
      version: 1,
      rules: [
        { id: 'master.required', kind: 'required-master', master: 'brand' },
      ],
    })
    expect(
      evaluateThemeRules({ document, slides: [{ index: 1, layout: 'cover' }] }),
    ).toMatchObject([
      {
        code: 'THEME_RULE_EVIDENCE_MISSING',
        status: 'unverified',
        severity: 'needs-human',
      },
    ])
  })
})
