export type Hex = string

export type Layout =
  'LAYOUT_WIDE' | 'LAYOUT_16x9' | 'LAYOUT_16x10' | 'LAYOUT_4x3'

export interface Size {
  width: number
  height: number
}

export interface Shadow {
  type?: 'outer' | 'inner'
  blur?: number
  offset?: number
  angle?: number
  color?: Hex
  opacity?: number
}

export interface Fill {
  type?: 'solid' | 'gradient' | 'none'
  color?: Hex
  colors?: Hex[]
  transparency?: number
}

export interface Theme {
  primary: Hex
  primaryDark: Hex
  primaryLight: Hex
  accent: Hex
  accentBright: Hex
  background: Hex
  surface: Hex
  surfaceAlt: Hex
  text: Hex
  textDim: Hex
  textMuted: Hex
  border: string
  borderStrong: string
  success: Hex
  warning: Hex
  error: Hex
  fontDisplay: string
  fontBody: string
  fontMono: string
  gradient: Hex[]
  gradientAngle: number
  [key: string]: any
}

export interface PresOptions {
  layout?: Layout
  title?: string
  author?: string
  company?: string
  subject?: string
  theme?: Partial<Theme>
}

export interface BackgroundOptions {
  color?: Hex
  gradient?: GradientOptions
}

export interface AddSlideOptions {
  background?: BackgroundOptions
}

export interface Position {
  x: number
  y: number
  w: number
  h: number
}

export interface PrimitiveOptions extends Partial<Position> {
  [key: string]: any
}

export interface GradientOptions {
  type?: 'mesh' | 'linear' | 'radial' | 'conic'
  colors: Hex[]
  angle?: number
  base?: Hex
  blur?: number
  seed?: number
}

export interface TextOptions extends Position {
  fontFace?: string
  fontSize?: number
  color?: Hex
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'middle' | 'bottom'
  charSpacing?: number
  lineSpacingMultiple?: number
  shadow?: Shadow
  glow?: { size?: number; opacity?: number; color?: Hex }
  outline?: { size?: number; color?: Hex }
  [key: string]: any
}

export interface GradientTextOptions extends Position {
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  gradient: [Hex, Hex]
  angle?: number
  letterSpacing?: number
  lineHeight?: number
  align?: 'left' | 'center' | 'right'
}

export interface RectOptions extends Position {
  fill?: Hex | Fill
  borderColor?: Hex
  borderWidth?: number
  radius?: number
  shadow?: Shadow
  rotate?: number
}

export interface LineOptions {
  x1: number
  y1: number
  x2: number
  y2: number
  color?: Hex
  width?: number
  transparency?: number
  dash?: 'solid' | 'dash' | 'dot'
}

export interface ImageOptions extends Position {
  data?: string
  path?: string
  sizing?: { type: 'cover' | 'contain' | 'crop'; w?: number; h?: number }
  [key: string]: any
}

export interface BlobOptions extends Position {
  seed?: number
  points?: number
  irregularity?: number
  fill?: Hex
  fillGradient?: [Hex, Hex]
  gradientAngle?: number
}

export interface GradientRectOptions extends Position {
  type?: 'mesh' | 'linear' | 'radial'
  colors: Hex[]
  gradient?: GradientOptions
  angle?: number
  base?: Hex
  blur?: number
}

export interface GrainOptions extends Position {
  opacity?: number
  monochrome?: boolean
}

export interface GlassOptions extends Position {
  tint?: Hex
  tintOpacity?: number
  borderColor?: Hex
  borderOpacity?: number
  borderWidth?: number
  radius?: number
  highlight?: boolean
}

export interface NoiseGradientOptions extends Position {
  colors?: Hex[]
  angle?: number
  type?: 'linear' | 'radial'
  noiseOpacity?: number
  noiseScale?: number
  noiseOctaves?: number
  monochrome?: boolean
}

export interface IsometricGridOptions extends Position {
  cellSize?: number
  lineColor?: Hex
  lineOpacity?: number
  lineWidth?: number
  bgColor?: Hex
  axes?: Array<'h' | 'a' | 'b'>
}

export interface CodeTheme {
  bg: Hex
  text: Hex
  keyword: Hex
  string: Hex
  number: Hex
  comment: Hex
  fn: Hex
  type: Hex
  punct: Hex
}

export interface CodeBlockOptions extends Position {
  code: string
  lang?:
    | 'js'
    | 'ts'
    | 'jsx'
    | 'tsx'
    | 'py'
    | 'json'
    | 'sh'
    | 'html'
    | 'css'
    | 'md'
    | 'rust'
    | 'go'
    | 'sql'
  theme?: 'dark' | 'light' | 'mono' | CodeTheme
  fontSize?: number
  fontFamily?: string
  padding?: number
  lineNumbers?: boolean
  radius?: number
}

export interface IconOptions extends Position {
  name?: string
  size?: number
  svg?: string
  lucide?: any
  paths?: string[]
  color?: Hex
  strokeWidth?: number
  fill?: Hex | 'none'
  viewBox?: string
}

export type ChartType =
  'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter'
export type ChartPalette =
  'editorial' | 'mono' | 'sunset' | 'ocean' | 'pastel' | Hex[]

export interface ChartSeries {
  name?: string
  labels: Array<string | number>
  values: number[]
}

export interface ChartOptions extends Position {
  type?: ChartType
  data: ChartSeries | ChartSeries[]
  title?: string
  palette?: ChartPalette
  font?: string
  titleFont?: string
  titleFontSize?: number
  titleColor?: Hex
  showValues?: boolean
  showLegend?: boolean
  legendPosition?: 'b' | 'r' | 't' | 'l'
  axisColor?: Hex
  textColor?: Hex
  barGap?: number
}

export interface DotGridOptions extends Position {
  cellSize?: number
  dotRadius?: number
  color?: Hex
  opacity?: number
  bg?: Hex | null
}

export interface StripesOptions extends Position {
  angle?: number
  stripeWidth?: number
  gap?: number
  color?: Hex
  opacity?: number
  bg?: Hex | null
}

export interface WaveDividerOptions extends Position {
  amplitude?: number
  frequency?: number
  phase?: number
  strokeColor?: Hex
  strokeWidth?: number
  fillColor?: Hex | null
  fillOpacity?: number
  flip?: boolean
}

export interface ProgressRingOptions extends Position {
  value: number
  thickness?: number
  trackColor?: Hex
  trackOpacity?: number
  progressColor?: Hex
  progressGradient?: Hex[]
  label?: string | null
  labelColor?: Hex
  labelFontFamily?: string
  labelFontSize?: number
  labelFontWeight?: number
  sublabel?: string | null
  sublabelColor?: Hex
  startAngle?: number
  rounded?: boolean
}

export interface SparklineOptions extends Position {
  values: number[]
  strokeColor?: Hex
  strokeWidth?: number
  fillColor?: Hex | null
  fillOpacity?: number
  showDots?: boolean
  showLast?: boolean
  dotColor?: Hex
  dotRadius?: number
  smooth?: boolean
  padding?: number
  min?: number
  max?: number
}

export interface BadgeOptions extends Partial<Position> {
  text: string
  x: number
  y: number
  bg?: Hex
  color?: Hex
  borderColor?: Hex
  borderWidth?: number
  fontSize?: number
  fontFace?: string
  bold?: boolean
  charSpacing?: number
  radius?: number
}

export interface ProgressBarOptions {
  x: number
  y: number
  w: number
  h?: number
  value: number
  trackColor?: Hex
  fillColor?: Hex
  radius?: number | null
  label?: boolean
  labelColor?: Hex
  labelFontSize?: number
}

export interface TimelineStep {
  label: string
  sublabel?: string
  color?: Hex
}

export interface TimelineOptions {
  x: number
  y: number
  w: number
  steps: TimelineStep[]
  lineColor?: Hex
  lineWidth?: number
  dotSize?: number
  accentColor?: Hex
  labelColor?: Hex
  sublabelColor?: Hex
  fontFace?: string
  fontSize?: number
  sublabelFontSize?: number
}

export interface ConnectorOptions {
  x1: number
  y1: number
  x2: number
  y2: number
  color?: Hex
  width?: number
  headSize?: number
}

export type HorizontalAlign = 'left' | 'center' | 'right' | 'justify'

export interface StatCardOptions extends Partial<Position> {
  value?: string | number
  label?: string
  unit?: string
  delta?: number | null
  sparkline?: number[] | null
  bg?: Hex
  color?: Hex
  accentColor?: Hex
  deltaUpColor?: Hex
  deltaDownColor?: Hex
  fontFace?: string
  radius?: number
  border?: boolean
  borderColor?: Hex
  align?: HorizontalAlign
}

export interface KpiGridItem {
  value?: string | number
  label?: string
  unit?: string
  delta?: number | null
  sparkline?: number[] | null
}

export type KpiGridOptions = Omit<
  StatCardOptions,
  'value' | 'label' | 'unit' | 'delta' | 'sparkline'
> & {
  items?: KpiGridItem[]
  gap?: number
}

export interface CalloutOptions extends Partial<Position> {
  title?: string
  body?: string
  variant?: 'info' | 'success' | 'warning' | 'danger'
  color?: Hex
  bg?: Hex
  fontFace?: string
  radius?: number
}

export interface FeatureCardOptions extends Partial<Position> {
  icon?: string | null
  iconColor?: Hex
  iconSize?: number
  title?: string
  body?: string
  bg?: Hex
  color?: Hex
  fontFace?: string
  radius?: number
  border?: boolean
  borderColor?: Hex
}

export interface StepFlowStep {
  title: string
  body?: string
}

export interface StepFlowOptions extends Partial<Position> {
  steps?: StepFlowStep[]
  color?: Hex
  inactiveColor?: Hex
  fontFace?: string
  numberSize?: number
}

export type ComparisonValue = boolean | string | number | null | undefined

export interface ComparisonRow {
  label: string
  values: ComparisonValue[]
}

export interface ComparisonTableOptions extends Partial<Position> {
  columns?: string[]
  rows?: ComparisonRow[]
  highlightCol?: number
  accentColor?: Hex
  fontFace?: string
  checkColor?: Hex
  crossColor?: Hex
}

export interface LogoCloudOptions extends Partial<Position> {
  logos?: string[]
  cols?: number | null
  gap?: number
}

export interface TeamCardOptions extends Partial<Position> {
  name?: string
  role?: string
  bio?: string
  image?: string | null
  initials?: string
  bg?: Hex
  accentColor?: Hex
  fontFace?: string
  radius?: number
  border?: boolean
  borderColor?: Hex
  avatarSize?: number
}
