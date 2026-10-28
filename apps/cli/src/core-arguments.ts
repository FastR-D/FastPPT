import { resolve } from 'node:path'

export const CORE_COMMANDS = [
  'tools',
  'theme',
  'deck',
  'assets',
  'icons',
  'skills',
  'preview',
  'session',
] as const

export const TOOL_COMMANDS: Record<string, string> = {
  'theme list': 'list_themes',
  'theme manifest': 'get_theme_manifest',
  'theme rules': 'get_theme_rules',
  'theme skill': 'get_theme_skill',
  'theme import': 'import_theme_from_pptx',
  'theme create': 'create_theme',
  'theme design': 'design_theme_system',
  'theme layouts': 'design_theme_layouts',
  'theme samples': 'create_theme_design_samples',
  'theme review': 'review_theme_design_samples',
  'deck read': 'read_slides',
  'deck write': 'write_slides',
  'deck format': 'format_slides',
  'deck validate': 'validate_slides',
  'deck inspect': 'inspect_slide',
  'deck overflow': 'inspect_overflow',
  'deck quality': 'inspect_quality',
  'deck report': 'get_quality_report',
  'deck export': 'export_editable_pptx',
  'assets list': 'list_assets',
  'assets svg': 'inspect_svg_asset',
  'icons list': 'list_icon_collections',
  'icons search': 'search_icons',
  'preview status': 'get_preview_status',
}
const OTHER_COMMANDS = new Set([
  'tools list',
  'tools call',
  'theme rescan',
  'skills install',
  'skills status',
  'deck list',
  'deck create',
  'deck generate',
  'preview start',
  'preview stop',
  'preview restart',
  'session status',
])

export interface CoreArguments {
  command: string
  tool?: string
  workspaceRoot: string
  input?: string
  inputFile?: string
  contentFile?: string
  parameters: Record<string, unknown>
  json: boolean
  help: boolean
  timeoutMs: number
}

export function isCoreCommand(argv: readonly string[]): boolean {
  return CORE_COMMANDS.some((name) => name === argv[0])
}

export function parseCoreArguments(
  argv: readonly string[],
  cwd: string,
): CoreArguments {
  const command = `${argv[0]} ${argv[1] ?? ''}`.trim()
  const result: CoreArguments = {
    command,
    workspaceRoot: cwd,
    parameters: {},
    json: false,
    help: argv.includes('--help') || argv.includes('-h'),
    timeoutMs: 900_000,
  }
  if (result.help) return result
  if (!(command in TOOL_COMMANDS) && !OTHER_COMMANDS.has(command))
    throw new Error(`Unknown core command: ${command}`)
  let index = 2
  if (command === 'tools call') {
    const tool = argv[index++]
    if (!tool || tool.startsWith('-'))
      throw new Error('tools call requires a tool name.')
    result.tool = tool
  }
  const fields: Record<string, string> = {
    '--path': 'path',
    '--theme': 'themeId',
    '--harness': 'harness',
    '--output-name': 'outputName',
    '--revision': 'expectedRevision',
    '--file': 'filePath',
    '--name': 'name',
    '--query': 'query',
    '--session': 'sessionId',
    '--prompt': 'prompt',
  }
  for (; index < argv.length; index++) {
    const raw = argv[index]!
    const separator = raw.indexOf('=')
    const option = separator < 0 ? raw : raw.slice(0, separator)
    if (option === '--json') {
      result.json = true
      continue
    }
    if (option === '--dry-run') {
      result.parameters.dryRun = true
      continue
    }
    if (
      ![
        '--dir',
        '--workspace',
        '--input',
        '--input-file',
        '--content-file',
        '--slide',
        '--timeout',
        ...Object.keys(fields),
      ].includes(option)
    )
      throw new Error(`Unknown option: ${option}`)
    const value = separator < 0 ? argv[++index] : raw.slice(separator + 1)
    if (!value || (separator < 0 && value.startsWith('--')))
      throw new Error(`${option} requires a value.`)
    if (option === '--dir' || option === '--workspace')
      result.workspaceRoot = resolve(cwd, value)
    else if (option === '--input') result.input = value
    else if (option === '--input-file') result.inputFile = resolve(cwd, value)
    else if (option === '--content-file')
      result.contentFile = resolve(cwd, value)
    else if (option === '--slide' || option === '--timeout') {
      const number = Number(value)
      if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        (option === '--timeout' && number > 900_000)
      )
        throw new Error(
          `${option} requires a positive integer${option === '--timeout' ? ' up to 900000' : ''}.`,
        )
      if (option === '--timeout') result.timeoutMs = number
      else result.parameters.slide = number
    } else result.parameters[fields[option]!] = value
  }
  if (result.input && result.inputFile)
    throw new Error('Use either --input or --input-file.')
  return result
}

export const CORE_HELP = `Core commands:
  tools list / tools call <name>   discover schemas / invoke any core tool
  theme list|manifest|rules|skill  inspect registered themes and Skills
  theme create|import|design|layouts  create / extract PPTX / compile / add layouts
  theme samples|review|rescan     create / inspect samples / reload Gateway themes
  deck list|create|generate       list / create / dispatch AI generation
  deck read|write|format|validate edit and validate Slidev Markdown
  deck inspect|overflow|quality|report  inspect structure and rendered quality
  deck export                    export editable PPTX and return its local path
  preview start|stop|restart|status  control a managed preview
  assets list|svg / icons list|search  discover and inspect visual resources
  skills install|status          reconcile / inspect managed Skills
  session status                 inspect a generation session and latest run

Options:
  --dir <path>                   workspace (alias: --workspace)
  --input <json>                 parameters as a JSON object
  --input-file <path>            read JSON parameters from a local file
  --content-file <path>          read Markdown for deck write
  --path <relative-path>         deck or asset path
  --theme <id> --harness <name>   theme / codex or claude
  --file <relative.pptx>         source for theme import
  --slide <number> --revision <revision> --output-name <name.pptx>
  --name <name> --query <text> --prompt <text> --session <id>
  --dry-run --json --timeout <ms> (max/default: 900000)

Local file/theme tools work without a running Gateway. AI generation, preview,
rendered inspections and export require a Gateway; capture requires an active
FastPPT browser. Generation returns a session/run receipt, not a completed deck.
JSON input uses the schemas returned by tools list; named options override it.
`
