import type { AnimationDocumentV1 } from '@fastppt/protocol'
/** Instantiate object motion; demo shapes and page composition are never copied. */
export function bindCreativeAnimation(source:AnimationDocumentV1,slideId:string,bindings:Record<string,string>,available:readonly string[]):AnimationDocumentV1 {
  const targets=[...new Set(source.groups.flatMap(g=>g.effects.map(e=>e.target)))]
  for(const target of targets){const bound=bindings[target];if(!bound||!available.includes(bound))throw new Error(`请为 ${target} 选择当前页中的对象。`)}
  if(new Set(targets.map(target=>bindings[target])).size<targets.length)throw new Error('组合效果的各对象需要分别绑定，避免相互覆盖。')
  const groups=source.groups.map(group=>({...group,id:bindings[group.id]??group.id,label:bindings[group.id]??group.label,effects:group.effects.map((effect,index)=>({...effect,id:`creative-${source.slideId}-${effect.id}-${index}`,target:bindings[effect.target]!,params:{...effect.params,creativeReference:source.slideId}}))}))
  return {...source,slideId,source:'user',groups,digest:undefined}
}
