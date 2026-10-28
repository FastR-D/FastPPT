export type WorkspaceMode =
  | 'chat'
  | 'files'
  | 'resources'
  | 'palettes'
  | 'themes'
  | 'import'
  | 'notes'
  | 'animations'
  | 'diagrams'

export const workspaceViews = [
  { id: 'chat', label: '对话', icon: 'chat', shortcut: 'Alt+1' },
  { id: 'files', label: '编辑', icon: 'files', shortcut: 'Alt+2' },
  { id: 'resources', label: '版式', icon: 'grid', shortcut: 'Alt+3' },
  { id: 'palettes', label: '画盘', icon: 'palette', shortcut: 'Alt+4' },
  { id: 'animations', label: '动画', icon: 'motion', shortcut: 'Alt+5' },
  { id: 'notes', label: '备注', icon: 'notes', shortcut: 'Alt+6' },
  { id: 'themes', label: '主题', icon: 'theme', shortcut: 'Alt+7' },
] as const

export function primaryView(mode: WorkspaceMode): WorkspaceMode {
  return mode === 'import' ? 'themes' : mode
}

export const workspaceModeLabels: Record<WorkspaceMode, string> = {
  chat: '对话',
  files: '编辑',
  resources: '版式库',
  palettes: '画盘',
  themes: '主题库',
  import: '导入主题',
  notes: '讲稿备注',
  animations: '动画时间线',
  diagrams: '图表编辑',
}

export const workspaceCommands = [
  { id: 'palettes', label: '打开画盘', group: '资源', keywords: 'palette colors 配色 颜色', requiresPreview: false },
  {
    id: 'wizard',
    label: '新建演示文稿',
    group: '工作区',
    keywords: 'create new 新建 向导',
    requiresPreview: false,
  },
  {
    id: 'chat',
    label: '打开对话',
    group: '工作区',
    keywords: 'chat agent',
    requiresPreview: false,
  },
  {
    id: 'files',
    label: '打开编辑器',
    group: '工作区',
    keywords: 'files markdown 文件',
    requiresPreview: false,
  },
  {
    id: 'resources',
    label: '打开版式库',
    group: '资源',
    keywords: 'layout 布局',
    requiresPreview: false,
  },
  {
    id: 'themes',
    label: '打开主题库',
    group: '资源',
    keywords: 'theme',
    requiresPreview: false,
  },
  {
    id: 'import',
    label: '导入主题',
    group: '资源',
    keywords: 'import pptx',
    requiresPreview: false,
  },
  {
    id: 'notes',
    label: '打开备注',
    group: '编辑',
    keywords: 'notes 讲稿',
    requiresPreview: false,
  },
  {
    id: 'animations',
    label: '打开动画',
    group: '编辑',
    keywords: 'animation motion',
    requiresPreview: false,
  },
  {
    id: 'diagrams',
    label: '打开图表',
    group: '编辑',
    keywords: 'diagram chart',
    requiresPreview: false,
  },
  {
    id: 'start',
    label: '启动预览',
    group: '预览',
    keywords: 'preview start',
    requiresPreview: false,
  },
  {
    id: 'restart',
    label: '重启预览',
    group: '预览',
    keywords: 'preview restart',
    requiresPreview: true,
  },
  {
    id: 'quality',
    label: '检查当前页质量',
    group: '预览',
    keywords: 'quality check',
    requiresPreview: true,
  },
  {
    id: 'export',
    label: '导出 PPTX',
    group: '交付',
    keywords: 'export powerpoint',
    requiresPreview: true,
  },
] as const

export type WorkspaceCommand = (typeof workspaceCommands)[number]['id']
