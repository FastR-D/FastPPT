import type { AnimationDocumentV1 } from '@fastppt/protocol'
type Effect = AnimationDocumentV1['groups'][number]['effects'][number]

export function rebindAnimationEffect(document: AnimationDocumentV1, groupId: string, effectId: string, patch: Partial<Effect> & { target: string }): AnimationDocumentV1 {
  const source = document.groups.find((group) => group.id === groupId)
  const effect = source?.effects.find((item) => item.id === effectId)
  if (!effect) throw new Error('找不到要重新绑定的效果。')
  if (!patch.target.trim()) throw new Error('请选择目标对象。')
  if (document.groups.find((group) => group.id === patch.target)?.static) throw new Error('目标对象组为静态，请先调整该组设置。')
  const groups = document.groups.map((group) => ({ ...group, effects: group.id === groupId ? group.effects.filter((item) => item.id !== effectId) : [...group.effects] }))
    .filter((group) => group.id !== groupId || group.effects.length > 0)
  const targetGroup = groups.find((group) => group.id === patch.target)
  if (targetGroup?.effects.some((item) => item.id === effectId)) throw new Error('目标组已有同名效果，无法合并。')
  const rebound = { ...effect, ...patch }
  if (targetGroup) targetGroup.effects.push(rebound)
  else groups.push({ id: patch.target, label: patch.target, static: false, effects: [rebound] })
  return { ...document, groups }
}
