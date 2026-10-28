/** Portable creative-motion renderer. OOXML formulas are parsed as arithmetic,
 * never evaluated as JavaScript. Native PPTX retains the original timing tree. */
export function motionFormula(source, variables = {}) {
  const text = String(source).trim(), tokens = text.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|#?[A-Za-z_][\w.]*|\$|[()+\-*/^,]/gi) ?? []
  if (tokens.join('').toLowerCase() !== text.replace(/\s/g, '').toLowerCase() || tokens.length > 512) throw new Error('Unsupported motion formula')
  let index = 0, depth = 0, randomIndex = 0
  const functions = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max, atan: Math.atan, acos: Math.acos, asin: Math.asin, exp: Math.exp, ln: Math.log, floor: Math.floor, ceil: Math.ceil, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, rad: value => value*Math.PI/180, rand: (...args) => { const raw=Math.sin((Number(variables.seed)||1)*12.9898+(++randomIndex)*78.233)*43758.5453, u=raw-Math.floor(raw); return args.length>1?args[0]+u*(args[1]-args[0]):u*(args[0]??1) } }
  // PowerPoint formulas also permit implicit products, such as 4pi and 0.1cos(...).
  for(let i=1;i<tokens.length;i++){
    const previous=tokens[i-1],current=tokens[i],left=previous===')'||previous==='$'||/^(?:[\d.]|#?[A-Za-z_])/.test(previous),right=current==='('||current==='$'||/^(?:[\d.]|#?[A-Za-z_])/.test(current)
    if(left&&right&&!(current==='('&&Object.hasOwn(functions,previous.toLowerCase()))){tokens.splice(i,0,'*');i++}
  }
  function atom() {
    if (++depth > 48) throw new Error('Motion formula is too deep')
    const token = tokens[index++]; let result
    if (token === '+' || token === '-') result = (token === '-' ? -1 : 1) * atom()
    else if (token === '(') { result = expression(0); if (tokens[index++] !== ')') throw new Error('Unbalanced motion formula') }
    else if (token && /^(?:\d|\.)/.test(token)) result = Number(token)
    else if (token && Object.hasOwn(functions, token.toLowerCase()) && tokens[index] === '(') {
      index++; const values = tokens[index]===')'?[]:[expression(0)]
      while (tokens[index] === ',') { index++; values.push(expression(0)) }
      if (tokens[index++] !== ')') throw new Error('Unbalanced motion function')
      result = functions[token.toLowerCase()](...values)
    } else if (token?.toLowerCase() === 'pi') result = Math.PI
    else { const name = token?.replace(/^#/, ''); if (!Object.hasOwn(variables, name)) throw new Error(`Unknown motion variable: ${name}`); result = variables[name] }
    depth--; return result
  }
  function expression(minimum) {
    let result = atom()
    const priorities = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
    while ((priorities[tokens[index]] ?? -1) >= minimum) {
      const op = tokens[index++], priority = priorities[op], right = expression(op === '^' ? priority : priority + 1)
      result = op === '+' ? result + right : op === '-' ? result - right : op === '*' ? result * right : op === '/' ? result / right : result ** right
    }
    return result
  }
  const result = expression(0)
  if (index !== tokens.length || !Number.isFinite(result) || Math.abs(result) > 1e8) throw new Error('Invalid motion formula result')
  return result
}
const clamp = value => Math.min(1, Math.max(0, value))
function cycleProgress(cycle, repeat = 1, autoReverse = false) {
  const span=autoReverse?2:1,limit=Math.max(.001,repeat)*span,bounded=Math.max(0,Math.min(cycle,limit))
  let t=bounded%span
  if(bounded>=limit&&t===0)t=span
  return autoReverse&&t>1?2-t:t
}
function ease(t, a = 0, d = 0) {
  a = clamp(a); d = clamp(d); if (a + d > 1) { const sum = a+d; a /= sum; d /= sum }
  const velocity = 1 / (1 - (a+d)/2)
  return a && t < a ? velocity*t*t/(2*a) : d && t > 1-d ? 1-velocity*(1-t)*(1-t)/(2*d) : velocity*(t-a/2)
}
function interpolate(behavior, t, env, baseline) {
  const frames = behavior.frames ?? []
  const numeric = value => value === undefined || value === null || value === '' ? baseline : motionFormula(value, env)
  if (frames.length > 1) {
    let n = 0; while (n < frames.length-2 && t > frames[n+1].at) n++
    const left = frames[n], right = frames[n+1], u = clamp((t-left.at) / Math.max(.00001, right.at-left.at))
    const a = numeric(left.value), b = numeric(right.value), value = a+(b-a)*u
    return left.formula ? motionFormula(left.formula, { ...env, $: value }) : value
  }
  const from = numeric(behavior.from), to = behavior.to !== null && behavior.to !== undefined && behavior.to !== '' ? numeric(behavior.to) : behavior.by !== null && behavior.by !== undefined ? from + numeric(behavior.by) : baseline
  return from + (to-from)*t
}
function clip(filter, t) {
  const amount = (1-t)*100
  if (filter?.startsWith('wipe')) return filter.includes('left') ? `inset(0 ${amount}% 0 0)` : filter.includes('right') ? `inset(0 0 0 ${amount}%)` : filter.includes('down') ? `inset(${amount}% 0 0 0)` : `inset(0 0 ${amount}% 0)`
  if (filter?.startsWith('barn')) return filter.includes('Horizontal') ? `inset(${amount/2}% 0)` : `inset(0 ${amount/2}%)`
  if (filter?.startsWith('circle')) return `circle(${t*72}% at 50% 50%)`
  if (filter?.startsWith('wheel')) {
    const points=['50% 50%'];for(let i=0;i<=32;i++){const angle=-Math.PI/2+2*Math.PI*t*i/32;points.push(`${50+72*Math.cos(angle)}% ${50+72*Math.sin(angle)}%`)}return `polygon(${points.join(',')})`
  }
  if (filter?.startsWith('strips') || filter?.startsWith('randombar')) return `inset(0 ${amount}% 0 0)`
  return undefined
}
function pathPosition(path, t) {
  const parts = String(path ?? '').match(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? []
  let i=0, point=[0,0], segments=[]
  while(i<parts.length){const op=parts[i++];if(op==='M')point=[Number(parts[i++]),Number(parts[i++])];else if(op==='L'){const end=[Number(parts[i++]),Number(parts[i++])];segments.push([point,end]);point=end}else if(op==='C'){const p1=[Number(parts[i++]),Number(parts[i++])],p2=[Number(parts[i++]),Number(parts[i++])],p3=[Number(parts[i++]),Number(parts[i++])];let old=point;for(let n=1;n<=24;n++){const u=n/24,v=1-u,next=[0,1].map(k=>v*v*v*point[k]+3*v*v*u*p1[k]+3*v*u*u*p2[k]+u*u*u*p3[k]);segments.push([old,next]);old=next}point=p3}else if(op!=='Z')throw new Error('Unsupported motion path')}
  if(!segments.length)return[0,0]
  const lengths=segments.map(([a,b])=>Math.hypot(b[0]-a[0],b[1]-a[1]));let distance=t*lengths.reduce((a,b)=>a+b,0)
  for(let n=0;n<segments.length;n++){if(distance<=lengths[n]||n===segments.length-1){const[a,b]=segments[n],u=lengths[n]?clamp(distance/lengths[n]):0;return[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]}distance-=lengths[n]}
  return point
}
export function nativeMotionFrame(effect, metrics, progress) {
  const seed=[...effect.id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,1),env={seed,'style.fontSize':1,'style.opacity':1,'style.rotation':metrics.rotation??0,'transform.rotation_z':metrics.rotation??0,ppt_x:metrics.x,ppt_y:metrics.y,ppt_w:metrics.width,ppt_h:metrics.height,ppt_r:metrics.rotation??0,$:progress}, frame={opacity:1}, values={...env};let sx=1,sy=1,rotation=0,dx=0,dy=0
  let elapsed=clamp(progress)*(effect.params?.sourceDurationMs??effect.durationMs??400)
  const root=effect.params?.rootTiming
  if(root)elapsed=ease(cycleProgress(elapsed/Math.max(1,root.baseDurationMs),root.repeat,root.autoReverse),root.accel,root.decel)*root.baseDurationMs
  for(const b of effect.params?.behaviors??[]){
    const cycle=(elapsed-(b.delayMs??0))/Math.max(1,b.durationMs??400), t=ease(cycleProgress(cycle,b.repeat,b.autoReverse),b.accel,b.decel)
    if(b.type==='anim'&&['ppt_x','ppt_y','ppt_w','ppt_h','ppt_r','style.rotation','transform.rotation_z','style.opacity','style.fontSize'].includes(b.attribute)){const attr=['style.rotation','transform.rotation_z'].includes(b.attribute)?'ppt_r':b.attribute,base=attr==='style.opacity'||attr==='style.fontSize'?1:env[attr];const value=interpolate(b,t,env,base);if(attr==='style.opacity')frame.opacity=clamp(value);else if(attr==='style.fontSize')frame.fontSize=`${(metrics.fontSize??24)*value}px`;else values[attr]=value}
    else if(b.type==='animScale'){const a=b.from??{x:1,y:1},z=b.to??(b.by?{x:1+b.by.x,y:1+b.by.y}:{x:1,y:1});sx*=a.x+(z.x-a.x)*t;sy*=a.y+(z.y-a.y)*t}
    else if(b.type==='animRot')rotation+=((Number(b.from)||0)+(b.to!==null&&b.to!==undefined?(Number(b.to)-(Number(b.from)||0))*t:(Number(b.by)||0)*t))/60000
    else if(b.type==='animMotion'){const p=pathPosition(b.path,t);dx+=p[0];dy+=p[1]}
    else if(b.type==='animEffect'){const u=b.transition==='out'?1-t:t;const c=clip(b.filter,u);if(c)frame.clipPath=c;else frame.opacity*=u}
    else if(b.type==='animClr'){const from=typeof b.from==='string'&&/^[a-f\d]{6}$/i.test(b.from)?b.from:'2563eb',to=typeof b.to==='string'&&/^[a-f\d]{6}$/i.test(b.to)?b.to:from;frame.backgroundColor='#'+[0,2,4].map(i=>Math.round(parseInt(from.slice(i,i+2),16)+(parseInt(to.slice(i,i+2),16)-parseInt(from.slice(i,i+2),16))*t).toString(16).padStart(2,'0')).join('')}
  }
  dx+=values.ppt_x-env.ppt_x;dy+=values.ppt_y-env.ppt_y;sx*=values.ppt_w/Math.max(.00001,env.ppt_w);sy*=values.ppt_h/Math.max(.00001,env.ppt_h);rotation+=values.ppt_r-env.ppt_r
  frame.transform=`translate(${dx*metrics.canvasWidth}px, ${dy*metrics.canvasHeight}px) scale(${sx}, ${sy}) rotate(${rotation}deg)`
  return frame
}
const active=new Map()
export function resetNativeMotion(root) {
  for(const[element,state]of active){if(root&&!root.contains(element))continue;state.animation.cancel();element.style.visibility=state.visibility;active.delete(element)}
}
export function applyNativeMotion(element,effect,elapsedMs) {
  let state=active.get(element)
  if(state?.id!==effect.id){
    if(state){state.animation.cancel();element.style.visibility=state.visibility}
    const canvas=element.closest('.slidev-layout, [data-motion-canvas], main')??element.parentElement,rect=element.getBoundingClientRect(),box=canvas.getBoundingClientRect(),scale=box.width/(canvas.offsetWidth||box.width),style=getComputedStyle(element),metrics={x:(rect.left-box.left+rect.width/2)/box.width,y:(rect.top-box.top+rect.height/2)/box.height,width:rect.width/box.width,height:rect.height/box.height,canvasWidth:box.width/scale,canvasHeight:box.height/scale,fontSize:parseFloat(style.fontSize)}
    const base=style.transform,frames=Array.from({length:61},(_,i)=>({...nativeMotionFrame(effect,metrics,i/60),offset:i/60})).map(f=>({...f,transform:(base==='none'?'':base+' ')+f.transform})),animation=element.animate(frames,{duration:effect.durationMs,fill:'both'});animation.pause();state={id:effect.id,animation,visibility:element.style.visibility};active.set(element,state)
  }
  element.style.visibility=elapsedMs<0&&effect.params?.class==='entr'?'hidden':state.visibility
  state.animation.currentTime=Math.max(0,Math.min(effect.durationMs,elapsedMs))
}
export function orderedNativeEffects(groups) {return groups.flatMap(g=>g.effects).map((effect,index)=>({effect,index})).sort((a,b)=>(a.effect.params?.sourceOrder??a.index)-(b.effect.params?.sourceOrder??b.index)).map(row=>row.effect)}
