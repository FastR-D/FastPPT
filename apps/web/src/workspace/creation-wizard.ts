import type {
  ArtifactRoute,
  CreationDecisionV1,
  CreationWizard,
  SessionDeckProfile,
} from '@fastppt/protocol'

export const wizardSteps = ['task', 'content', 'visual', 'delivery'] as const
export type WizardStep = (typeof wizardSteps)[number]
export const wizardLabels: Record<WizardStep, string> = {
  task: '任务',
  content: '内容',
  visual: '视觉',
  delivery: '交付',
}
export const wizardChoices: Record<WizardStep, string[]> = {
  task: ['从零创建', '基于现有 deck', '创建主题'],
  content: ['资料优先', '事实核查优先', '允许联网研究'],
  visual: ['保留主题风格', '高密度信息图', '图片优先'],
  delivery: ['页面对象 + 母版 + 备注', '页面对象 + 动画', '仅页面对象'],
}

export function readWizardChoice(decision: CreationDecisionV1 | undefined): {
  choice: string
  note: string
} {
  const selected = decision?.selected ?? ''
  try {
    const value: unknown = JSON.parse(selected)
    if (
      value &&
      typeof value === 'object' &&
      'choice' in value &&
      'note' in value &&
      typeof value.choice === 'string' &&
      typeof value.note === 'string'
    )
      return { choice: value.choice, note: value.note }
  } catch {
    /* Legacy drafts stored a joined string. */
  }
  const choices = wizardChoices[decision?.stepId as WizardStep] ?? []
  const choice =
    choices.find(
      (option) => selected === option || selected.startsWith(`${option}；`),
    ) ?? ''
  return {
    choice,
    note: choice ? selected.slice(choice.length).replace(/^；/, '') : selected,
  }
}

export function wizardRoute(wizard: CreationWizard): ArtifactRoute {
  const choice = readWizardChoice(
    wizard.decisions.find((d) => d.stepId === 'task'),
  ).choice
  return choice === '创建主题'
    ? 'create-template'
    : choice === '基于现有 deck'
      ? 'edit-slidev'
      : 'generate'
}

export function applyWizardProfile(
  profile: SessionDeckProfile,
  wizard: CreationWizard,
): SessionDeckProfile {
  const task = wizard.decisions.find((d) => d.stepId === 'task')
  if (task?.locked && profile.artifactRoute !== wizardRoute(wizard))
    throw new Error('创作路线与已锁定的向导决策不一致。')
  const delivery = readWizardChoice(
    wizard.decisions.find((d) => d.stepId === 'delivery'),
  ).choice
  const deliveryOptions =
    delivery === '页面对象 + 母版 + 备注'
      ? { master: true, notes: true, animations: false }
      : delivery === '页面对象 + 动画'
        ? { master: false, notes: false, animations: true }
        : delivery === '仅页面对象'
          ? { master: false, notes: false, animations: false }
          : undefined
  return {
    ...profile,
    creationDecisions: wizard.decisions.map((d) => ({
      ...d,
      options: [...d.options],
    })),
    ...(deliveryOptions ? { deliveryOptions } : {}),
  }
}
