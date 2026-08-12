/**
 * Pitch Deck Machine v0.6 — brand themes and complete slide builders.
 *
 * AVAILABLE BRAND THEMES:
 *   'startup-dark'  — modern dark violet for B2C/SaaS
 *   'corporate'     — clean institutional navy
 *   'luxury'        — premium black and gold for finance/fashion
 *   'tech-dark'     — deep black with green/cyan for deep tech
 *   'light-minimal' — minimalist white and gray
 *
 * Exported functions:
 *   getBrandTheme(name)
 *   buildPitchDeck(pres, opts)  → generates 12 complete slides
 */

export const BRAND_THEMES = {
  'startup-dark': {
    bg: '#0B0B0F',
    surface: '#18181F',
    primary: '#7C3AED',
    accent: '#EC4899',
    text: '#FAFAFA',
    textDim: '#A1A1AA',
    fontDisplay: 'Fraunces, Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    auroraColors: ['#7C3AED', '#EC4899', '#06B6D4'],
    chartPalette: ['#7C3AED', '#EC4899', '#06B6D4', '#F59E0B', '#10B981'],
  },
  corporate: {
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    primary: '#1E3A8A',
    accent: '#3B82F6',
    text: '#0F172A',
    textDim: '#64748B',
    fontDisplay: 'Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    auroraColors: ['#1E3A8A', '#3B82F6', '#06B6D4'],
    chartPalette: ['#1E3A8A', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE'],
  },
  luxury: {
    bg: '#0A0A0A',
    surface: '#141414',
    primary: '#D4AF37',
    accent: '#F5E6A3',
    text: '#F5F5F0',
    textDim: '#888880',
    fontDisplay: 'Didact Gothic, Georgia, serif',
    fontBody: 'Cormorant Garamond, Georgia, serif',
    auroraColors: ['#D4AF37', '#8B6914', '#F5E6A3'],
    chartPalette: ['#D4AF37', '#F5E6A3', '#8B6914', '#C9A227', '#E8D48B'],
  },
  'tech-dark': {
    bg: '#030712',
    surface: '#0F172A',
    primary: '#00FF88',
    accent: '#00D4FF',
    text: '#F0FFF4',
    textDim: '#6EE7B7',
    fontDisplay: 'JetBrains Mono, monospace',
    fontBody: 'Inter, system-ui, sans-serif',
    auroraColors: ['#00FF88', '#00D4FF', '#7C3AED'],
    chartPalette: ['#00FF88', '#00D4FF', '#7C3AED', '#F59E0B', '#EF4444'],
  },
  'light-minimal': {
    bg: '#FAFAFA',
    surface: '#FFFFFF',
    primary: '#111111',
    accent: '#6366F1',
    text: '#111111',
    textDim: '#6B7280',
    fontDisplay: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    auroraColors: ['#6366F1', '#EC4899', '#F59E0B'],
    chartPalette: ['#111111', '#6366F1', '#EC4899', '#10B981', '#F59E0B'],
  },
}

export function getBrandTheme(name = 'startup-dark') {
  return BRAND_THEMES[name] ?? BRAND_THEMES['startup-dark']
}

/**
 * buildPitchDeck — generates a complete investor deck in one call.
 *
 * @param {Pres}   pres   — Slidewave Pres instance
 * @param {Object} opts   — deck configuration
 * @param {string} opts.company        company name
 * @param {string} opts.tagline        one-line tagline
 * @param {string} opts.problem        problem description
 * @param {string} opts.solution       solution description
 * @param {string} opts.theme          Brand theme name
 * @param {Array}  opts.traction       [{label, value, delta}]
 * @param {Array}  opts.team           [{name, role, initials}]
 * @param {string} opts.ask            funding request, for example '$3M Seed'
 * @param {Array}  opts.useOfFunds     [{label, value}] for a waterfall or pie chart
 * @param {Array}  opts.competitors    comparison columns
 * @param {Array}  opts.timeline       [{title, date, done}]
 * @param {Array}  opts.features       [{icon, title, body}]
 * @param {string} opts.market         market size, for example '$48B TAM'
 * @param {string} opts.contactEmail
 *
 * @returns {Promise<void>}
 */
export async function buildPitchDeck(pres, opts: any = {}) {
  const {
    company = 'COMPANY',
    tagline = 'The future of X.',
    problem = 'Teams waste 4 hours/day on manual processes that should be automated.',
    solution = 'An AI-native platform that automates workflows end-to-end in minutes.',
    theme: themeName = 'startup-dark',
    traction = [
      { label: 'ARR', value: '$840K', delta: 312 },
      { label: 'Customers', value: '420', delta: 180 },
      { label: 'NPS', value: '74', delta: 8 },
      { label: 'Churn', value: '1.4%', delta: -60 },
    ],
    team = [
      { name: 'Alex Rivera', role: 'CEO & Co-Founder', initials: 'AR' },
      { name: 'Jordan Kim', role: 'CTO & Co-Founder', initials: 'JK' },
      { name: 'Sam Chen', role: 'Head of Growth', initials: 'SC' },
    ],
    ask = '$3M Seed',
    useOfFunds = [
      { label: 'Engineering', value: 45 },
      { label: 'Sales & Marketing', value: 30 },
      { label: 'Operations', value: 15 },
      { label: 'G&A', value: 10 },
    ],
    competitors = null,
    timeline = [
      { title: 'MVP', date: 'Q1 2024' },
      { title: 'Beta', date: 'Q2 2024' },
      { title: 'Launch', date: 'Q3 2024' },
      { title: 'Series A', date: 'Q1 2025' },
    ],
    features = [
      {
        icon: 'Zap',
        title: 'Instant Setup',
        body: 'Deploy in 5 minutes, no code required.',
      },
      {
        icon: 'Shield',
        title: 'Enterprise-grade',
        body: 'SOC2 Type II, GDPR, SSO.',
      },
      {
        icon: 'TrendingUp',
        title: '10× Faster',
        body: 'Benchmarked vs. manual workflows.',
      },
    ],
    market = '$48B TAM',
    contactEmail = 'hello@company.com',
  } = opts

  const t = getBrandTheme(themeName)
  const W = 13.333,
    H = 7.5
  const isDark = ['startup-dark', 'tech-dark', 'luxury'].includes(themeName)

  // Slide factory helpers.
  const slide = () => pres.addSlide()

  /* ── SLIDE 1 : COVER ─────────────────────────────────────────── */
  const s1 = slide()
  await s1.addAuroraGradient({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    blobs: [
      { x: 0.15, y: 0.25, r: 0.55, color: t.auroraColors[0] },
      { x: 0.8, y: 0.2, r: 0.45, color: t.auroraColors[1] },
      { x: 0.6, y: 0.8, r: 0.5, color: t.auroraColors[2] },
    ],
    blur: 130,
  })
  await s1.addCinematicBars({
    x: 0,
    y: 0,
    w: W,
    h: H,
    barRatio: 0.1,
    vignette: true,
  })
  s1.addText(company.toUpperCase(), {
    x: 0.9,
    y: 1.6,
    w: W - 1.8,
    h: 1,
    fontFace: t.fontDisplay,
    fontSize: 16,
    bold: true,
    color: t.primary,
    charSpacing: 6,
    align: 'center',
  })
  s1.addText(tagline, {
    x: 0.9,
    y: 2.6,
    w: W - 1.8,
    h: 2.2,
    fontFace: t.fontDisplay,
    fontSize: 72,
    bold: true,
    color: t.text,
    align: 'center',
    lineSpacingMultiple: 1.05,
  })
  s1.addText('Investor Deck · 2026', {
    x: 0.9,
    y: 6.0,
    w: W - 1.8,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    color: t.textDim,
    align: 'center',
  })

  /* ── SLIDE 2 : PROBLEM ────────────────────────────────────────── */
  const s2 = slide()
  s2.addRect({ x: 0, y: 0, w: W, h: H, fill: t.bg })
  s2.addRect({ x: 0, y: 0, w: 0.06, h: H, fill: t.primary })
  s2.addText('THE PROBLEM', {
    x: 0.5,
    y: 0.5,
    w: 5,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  s2.addText(problem, {
    x: 0.5,
    y: 1.2,
    w: 7,
    h: 2.8,
    fontFace: t.fontDisplay,
    fontSize: 42,
    bold: true,
    color: t.text,
    lineSpacingMultiple: 1.1,
  })
  // Stat box
  s2.addRect({ x: 0.5, y: 4.2, w: 3.8, h: 1.8, fill: t.surface, radius: 0.12 })
  s2.addText('4h/day', {
    x: 0.7,
    y: 4.4,
    w: 3.4,
    h: 0.8,
    fontFace: t.fontDisplay,
    fontSize: 52,
    bold: true,
    color: t.accent,
  })
  s2.addText('wasted on manual work per employee', {
    x: 0.7,
    y: 5.2,
    w: 3.4,
    h: 0.6,
    fontFace: t.fontBody,
    fontSize: 12,
    color: t.textDim,
  })
  s2.addRect({ x: 4.6, y: 4.2, w: 3.8, h: 1.8, fill: t.surface, radius: 0.12 })
  s2.addText('$450B', {
    x: 4.8,
    y: 4.4,
    w: 3.4,
    h: 0.8,
    fontFace: t.fontDisplay,
    fontSize: 52,
    bold: true,
    color: t.accent,
  })
  s2.addText('annual productivity loss in the US alone', {
    x: 4.8,
    y: 5.2,
    w: 3.4,
    h: 0.6,
    fontFace: t.fontBody,
    fontSize: 12,
    color: t.textDim,
  })
  // Right-side decorative glitch visual.
  await s2.addLiquidGradient({
    x: 8.5,
    y: 0,
    w: 4.833,
    h: H,
    bg: t.surface,
    stops: [
      {
        color: t.auroraColors[0],
        x: 0.4,
        y: 0.3,
        rx: 0.8,
        ry: 0.7,
        rotate: 15,
        opacity: 0.2,
      },
      {
        color: t.auroraColors[1],
        x: 0.6,
        y: 0.7,
        rx: 0.7,
        ry: 0.8,
        rotate: -20,
        opacity: 0.15,
      },
    ],
    blur: 60,
  })

  /* ── SLIDE 3 : SOLUTION ───────────────────────────────────────── */
  const s3 = slide()
  s3.addRect({ x: 0, y: 0, w: W, h: H, fill: t.bg })
  s3.addText('THE SOLUTION', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  s3.addText(solution, {
    x: 0.5,
    y: 1.2,
    w: 6.5,
    h: 2.5,
    fontFace: t.fontDisplay,
    fontSize: 36,
    bold: true,
    color: t.text,
    lineSpacingMultiple: 1.15,
  })
  // Features row
  const feat3 = features.slice(0, 3)
  feat3.forEach((f, i) => {
    s3.addFeatureCard({
      x: 0.5 + i * 4.1,
      y: 4.0,
      w: 3.8,
      h: 2.8,
      icon: f.icon,
      title: f.title,
      body: f.body,
      bg: t.surface,
      iconColor: t.primary,
      titleColor: t.text,
      bodyColor: t.textDim,
    })
  })
  // Decorative mockup with a liquid gradient and glass card.
  await s3.addLiquidGradient({
    x: 7.3,
    y: 0.8,
    w: 5.5,
    h: 4.5,
    bg: t.surface,
    blur: 70,
    stops: [
      {
        color: t.auroraColors[0],
        x: 0.35,
        y: 0.3,
        rx: 0.7,
        ry: 0.6,
        rotate: 10,
        opacity: 0.25,
      },
      {
        color: t.auroraColors[2],
        x: 0.65,
        y: 0.65,
        rx: 0.65,
        ry: 0.7,
        rotate: -15,
        opacity: 0.2,
      },
    ],
  })
  await s3.addGlassCard({
    x: 7.5,
    y: 1.0,
    w: 5.1,
    h: 4.1,
    tint: '#ffffff',
    tintOpacity: 0.06,
    radius: 18,
    highlight: true,
  })

  /* ── SLIDE 4 : PRODUCT FEATURES ──────────────────────────────── */
  const s4 = slide()
  await s4.addGradientMesh({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    colors: [
      [t.auroraColors[0], t.auroraColors[1]],
      [t.auroraColors[2], t.auroraColors[0]],
    ],
    blur: 110,
    opacity: 0.18,
  })
  s4.addRect({ x: 0, y: 0, w: W, h: H, fill: t.bg + 'CC' })
  s4.addText('HOW IT WORKS', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
    align: 'center',
  })
  s4.addStepFlow({
    x: 0.8,
    y: 1.3,
    w: W - 1.6,
    h: 2.2,
    steps: [
      { title: 'Connect', sub: 'Plug in your data sources in 1 click' },
      { title: 'Configure', sub: 'Set rules with natural language' },
      { title: 'Automate', sub: 'AI handles the rest 24/7' },
      { title: 'Analyze', sub: 'Real-time dashboard & alerts' },
    ],
    accentColor: t.primary,
    textColor: t.text,
    dimColor: t.textDim,
    fontFace: t.fontBody,
  })
  // Features grid 2x3
  const allFeatures =
    features.length >= 6
      ? features.slice(0, 6)
      : [
          ...features,
          {
            icon: 'BarChart2',
            title: 'Analytics',
            body: 'Live dashboards with 200+ metrics.',
          },
          {
            icon: 'Globe',
            title: 'Global',
            body: 'Available in 40+ languages.',
          },
          {
            icon: 'Cpu',
            title: 'AI-Native',
            body: 'GPT-4 powered automation engine.',
          },
        ].slice(0, 6)
  const fcols = 3,
    frows = 2
  allFeatures.forEach((f, i) => {
    const col = i % fcols,
      row = Math.floor(i / fcols)
    s4.addFeatureCard({
      x: 0.5 + col * 4.2,
      y: 3.8 + row * 1.7,
      w: 4.0,
      h: 1.5,
      icon: f.icon,
      title: f.title,
      body: f.body,
      bg: t.surface,
      iconColor: t.primary,
      titleColor: t.text,
      bodyColor: t.textDim,
      iconSize: 0.32,
      layout: 'horizontal',
    })
  })

  /* ── SLIDE 5 : MARKET OPPORTUNITY ────────────────────────────── */
  const s5 = slide()
  s5.addRect({ x: 0, y: 0, w: W, h: H, fill: t.bg })
  s5.addText('MARKET OPPORTUNITY', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  // TAM/SAM/SOM market bubble chart.
  await s5.addBubbleChart({
    x: 0.5,
    y: 1.2,
    w: 7.0,
    h: 5.5,
    bg: t.surface,
    bubbles: [
      { label: 'TAM', value: 100, x: 0.5, y: 0.5, color: t.auroraColors[0] },
      { label: 'SAM', value: 30, x: 0.35, y: 0.55, color: t.auroraColors[1] },
      { label: 'SOM', value: 8, x: 0.33, y: 0.52, color: t.auroraColors[2] },
    ],
    fontColor: t.text,
    fontFamily: t.fontBody,
  })
  // Stats
  const mktStats = [
    { label: 'TAM', value: '$48B', sub: 'Total addressable market' },
    { label: 'SAM', value: '$12B', sub: 'Serviceable market' },
    { label: 'SOM', value: '$880M', sub: '5-year target (7.3%)' },
  ]
  mktStats.forEach((m, i) => {
    s5.addRect({
      x: 7.8,
      y: 1.2 + i * 1.8,
      w: 5.0,
      h: 1.5,
      fill: t.surface,
      radius: 0.12,
    })
    s5.addText(m.label, {
      x: 8.1,
      y: 1.3 + i * 1.8,
      w: 1.5,
      h: 0.45,
      fontFace: t.fontBody,
      fontSize: 10,
      bold: true,
      color: t.primary,
      charSpacing: 3,
    })
    s5.addText(m.value, {
      x: 8.0,
      y: 1.65 + i * 1.8,
      w: 4.5,
      h: 0.7,
      fontFace: t.fontDisplay,
      fontSize: 44,
      bold: true,
      color: t.text,
    })
    s5.addText(m.sub, {
      x: 8.0,
      y: 2.32 + i * 1.8,
      w: 4.5,
      h: 0.35,
      fontFace: t.fontBody,
      fontSize: 11,
      color: t.textDim,
    })
  })

  /* ── SLIDE 6 : TRACTION ───────────────────────────────────────── */
  const s6 = slide()
  await s6.addLiquidGradient({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    blur: 100,
    stops: [
      {
        color: t.auroraColors[0],
        x: 0.1,
        y: 0.1,
        rx: 0.6,
        ry: 0.5,
        rotate: 20,
        opacity: 0.12,
      },
      {
        color: t.auroraColors[1],
        x: 0.9,
        y: 0.9,
        rx: 0.5,
        ry: 0.6,
        rotate: -20,
        opacity: 0.1,
      },
    ],
  })
  s6.addText('TRACTION', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  s6.addText('Growing fast.', {
    x: 0.5,
    y: 1.0,
    w: 12,
    h: 1.2,
    fontFace: t.fontDisplay,
    fontSize: 56,
    bold: true,
    color: t.text,
    align: 'center',
  })
  s6.addKPIGrid({
    x: 0.5,
    y: 2.5,
    w: W - 1.0,
    h: 2.2,
    gap: 0.25,
    items: traction,
    bg: t.surface,
    color: t.text,
    dimColor: t.textDim,
    accentColor: t.primary,
    fontFace: t.fontBody,
  })
  // Callout social proof
  s6.addCallout({
    x: 0.5,
    y: 5.1,
    w: W - 1.0,
    h: 1.9,
    variant: 'info',
    accentColor: t.primary,
    title: '🚀 Just closed first enterprise deal',
    body: '"Reduced our onboarding time by 87% in week one." — Head of Ops, Fortune 500',
    bg: t.surface,
    textColor: t.text,
    dimColor: t.textDim,
    fontFace: t.fontBody,
  })

  /* ── SLIDE 7 : COMPETITIVE LANDSCAPE ─────────────────────────── */
  const s7 = slide()
  s7.addRect({ x: 0, y: 0, w: W, h: H, fill: t.bg })
  s7.addText('COMPETITIVE LANDSCAPE', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  const defaultCompCols = ['Feature', company, 'Competitor A', 'Competitor B']
  const defaultCompRows = [
    { label: 'AI-native automation', values: [true, false, false] },
    { label: 'No-code setup', values: [true, true, false] },
    { label: 'Real-time analytics', values: [true, false, true] },
    { label: 'Enterprise security', values: [true, false, false] },
    { label: 'API-first', values: [true, true, true] },
    { label: 'Pricing transparency', values: [true, false, false] },
  ]
  s7.addComparisonTable({
    x: 0.5,
    y: 1.2,
    w: W - 1.0,
    h: 5.8,
    columns: competitors ?? defaultCompCols,
    rows: defaultCompRows,
    highlightCol: 1,
    accentColor: t.primary,
    bg: t.surface,
    textColor: t.text,
    dimColor: t.textDim,
    fontFace: t.fontBody,
  })

  /* ── SLIDE 8 : BUSINESS MODEL ─────────────────────────────────── */
  const s8 = slide()
  await s8.addGradientMesh({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    colors: [
      [t.auroraColors[0], t.bg],
      [t.bg, t.auroraColors[1]],
    ],
    blur: 120,
    opacity: 0.15,
  })
  s8.addText('BUSINESS MODEL', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  // Revenue streams
  const streams = [
    {
      icon: 'CreditCard',
      title: 'Subscription SaaS',
      body: 'Starter $49/mo · Pro $199/mo · Enterprise custom',
    },
    {
      icon: 'Repeat',
      title: 'Usage-based',
      body: 'Per-automation run above plan limits',
    },
    {
      icon: 'Building',
      title: 'Enterprise Contracts',
      body: 'Annual, multi-seat, dedicated support',
    },
  ]
  streams.forEach((st, i) => {
    s8.addFeatureCard({
      x: 0.5 + i * 4.2,
      y: 1.3,
      w: 4.0,
      h: 2.4,
      icon: st.icon,
      title: st.title,
      body: st.body,
      bg: t.surface,
      iconColor: t.accent,
      titleColor: t.text,
      bodyColor: t.textDim,
      fontFace: t.fontBody,
    })
  })
  // Unit economics
  s8.addText('UNIT ECONOMICS', {
    x: 0.5,
    y: 4.0,
    w: 5,
    h: 0.4,
    fontFace: t.fontBody,
    fontSize: 10,
    bold: true,
    color: t.textDim,
    charSpacing: 3,
  })
  const ueStats = [
    { label: 'LTV', value: '$8,400', delta: null },
    { label: 'CAC', value: '$420', delta: null },
    { label: 'LTV:CAC', value: '20×', delta: null },
    { label: 'Payback', value: '3 mo', delta: null },
  ]
  s8.addKPIGrid({
    x: 0.5,
    y: 4.5,
    w: W - 1.0,
    h: 2.5,
    gap: 0.2,
    items: ueStats,
    bg: t.surface,
    color: t.text,
    dimColor: t.textDim,
    accentColor: t.accent,
    fontFace: t.fontBody,
  })

  /* ── SLIDE 9 : ROADMAP ────────────────────────────────────────── */
  const s9 = slide()
  s9.addRect({ x: 0, y: 0, w: W, h: H, fill: t.bg })
  s9.addText('ROADMAP', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
  })
  // Gantt
  await s9.addGanttChart({
    x: 0.5,
    y: 1.2,
    w: W - 1.0,
    h: 4.5,
    tasks: [
      {
        label: 'Core Platform v2',
        start: 0,
        end: 0.25,
        color: t.auroraColors[0],
      },
      { label: 'Mobile App', start: 0.15, end: 0.45, color: t.auroraColors[1] },
      {
        label: 'Enterprise SSO',
        start: 0.3,
        end: 0.55,
        color: t.auroraColors[2],
      },
      {
        label: 'Marketplace Launch',
        start: 0.5,
        end: 0.7,
        color: t.auroraColors[0],
      },
      { label: 'Series A Close', start: 0.6, end: 0.75, color: t.accent },
      {
        label: 'International Exp.',
        start: 0.75,
        end: 1.0,
        color: t.auroraColors[1],
      },
    ],
    headerLabels: ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025'],
    fontFamily: t.fontBody,
    fontColor: t.text,
    trackColor: t.surface,
    bg: 'transparent',
  })
  s9.addTimeline({
    x: 0.5,
    y: 5.9,
    w: W - 1.0,
    h: 1.2,
    milestones: timeline,
    lineColor: t.primary,
    dotColor: t.accent,
    fontFace: t.fontBody,
    textColor: t.text,
    dimColor: t.textDim,
  })

  /* ── SLIDE 10 : TEAM ──────────────────────────────────────────── */
  const s10 = slide()
  await s10.addParticleField({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    count: 150,
    seed: 77,
    colors: [t.auroraColors[0], t.auroraColors[1]],
    minOpacity: 0.1,
    maxOpacity: 0.5,
    connected: true,
    connectionDist: 90,
    connectionOpacity: 0.08,
  })
  s10.addText('THE TEAM', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.primary,
    charSpacing: 4,
    align: 'center',
  })
  const teamList = team.slice(0, 4)
  const tcardW = Math.min(3.6, (W - 1.0) / teamList.length - 0.2)
  const startX = (W - teamList.length * (tcardW + 0.25) + 0.25) / 2
  teamList.forEach((member, i) => {
    s10.addTeamCard({
      x: startX + i * (tcardW + 0.25),
      y: 1.2,
      w: tcardW,
      h: 5.8,
      name: member.name,
      role: member.role,
      initials: member.initials,
      bio: member.bio || '',
      bg: t.surface,
      textColor: t.text,
      dimColor: t.textDim,
      accentColor: t.primary,
      fontFace: t.fontBody,
      fontDisplay: t.fontDisplay,
    })
  })

  /* ── SLIDE 11 : THE ASK ───────────────────────────────────────── */
  const s11 = slide()
  await s11.addAuroraGradient({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    blobs: [
      { x: 0.3, y: 0.4, r: 0.6, color: t.auroraColors[0] },
      { x: 0.75, y: 0.5, r: 0.55, color: t.auroraColors[1] },
    ],
    blur: 140,
  })
  s11.addText('THE ASK', {
    x: 0.5,
    y: 0.5,
    w: 12,
    h: 0.5,
    fontFace: t.fontBody,
    fontSize: 11,
    bold: true,
    color: t.accent,
    charSpacing: 4,
    align: 'center',
  })
  s11.addText('Raising ' + ask, {
    x: 0.5,
    y: 1.1,
    w: W - 1.0,
    h: 1.6,
    fontFace: t.fontDisplay,
    fontSize: 72,
    bold: true,
    color: t.text,
    align: 'center',
  })
  // Use of funds
  await s11.addWaterfallChart({
    x: 0.5,
    y: 2.9,
    w: 6.5,
    h: 3.8,
    items: useOfFunds.map((f) => ({ label: f.label, value: f.value })),
    upColor: t.auroraColors[0],
    downColor: t.accent,
    totalColor: t.primary,
    fontFamily: t.fontBody,
    fontColor: t.text,
    bg: t.surface,
  })
  // Milestones funded
  s11.addText('What we will achieve', {
    x: 7.3,
    y: 2.9,
    w: 5.5,
    h: 0.45,
    fontFace: t.fontBody,
    fontSize: 12,
    bold: true,
    color: t.textDim,
    charSpacing: 2,
  })
  const milestones = [
    '→ 2× engineering team (6→12)',
    '→ $3M ARR by end of year',
    '→ Launch EU + APAC markets',
    '→ Series A in 18 months',
  ]
  milestones.forEach((m, i) => {
    s11.addText(m, {
      x: 7.3,
      y: 3.5 + i * 0.7,
      w: 5.5,
      h: 0.6,
      fontFace: t.fontBody,
      fontSize: 15,
      color: t.text,
    })
  })

  /* ── SLIDE 12 : THANK YOU / CONTACT ──────────────────────────── */
  const s12 = slide()
  await s12.addAuroraGradient({
    x: 0,
    y: 0,
    w: W,
    h: H,
    bg: t.bg,
    blobs: [
      { x: 0.2, y: 0.3, r: 0.5, color: t.auroraColors[0] },
      { x: 0.8, y: 0.2, r: 0.45, color: t.auroraColors[1] },
      { x: 0.5, y: 0.8, r: 0.55, color: t.auroraColors[2] },
    ],
    blur: 140,
  })
  await s12.addCinematicBars({
    x: 0,
    y: 0,
    w: W,
    h: H,
    barRatio: 0.1,
    vignette: true,
  })
  s12.addText("Let's build the future together.", {
    x: 0.9,
    y: 2.0,
    w: W - 1.8,
    h: 2.5,
    fontFace: t.fontDisplay,
    fontSize: 62,
    bold: true,
    color: t.text,
    align: 'center',
    lineSpacingMultiple: 1.1,
  })
  s12.addText(contactEmail, {
    x: 0.9,
    y: 4.8,
    w: W - 1.8,
    h: 0.7,
    fontFace: t.fontBody,
    fontSize: 20,
    color: t.primary,
    align: 'center',
  })
  s12.addText(company.toUpperCase() + ' · CONFIDENTIAL · 2026', {
    x: 0.9,
    y: 6.6,
    w: W - 1.8,
    h: 0.4,
    fontFace: t.fontBody,
    fontSize: 10,
    color: t.textDim,
    align: 'center',
    charSpacing: 2,
  })
}
