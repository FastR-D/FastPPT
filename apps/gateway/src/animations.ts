import { AnimationLibrary } from '@fastppt/animations'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
const id=z.string().regex(/^[a-f\d]{12}-\d{4}$/)
export function registerAnimationRoutes(app:FastifyInstance, library=new AnimationLibrary()):void {
  app.get('/api/v1/animations',async request=>library.search(z.object({query:z.string().max(2000).optional(),category:z.string().max(100).optional(),scope:z.enum(['object','multi-object']).optional(),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(60).default(12)}).parse(request.query)))
  app.get('/api/v1/animations/facets',async()=>({categories:[...new Set((await library.entries()).map(e=>e.category))]}))
  app.get<{Params:{id:string}}>('/api/v1/animations/:id',async(request,reply)=>{
    const value=await library.read(id.parse(request.params.id));return value??reply.code(404).send({error:{code:'ANIMATION_NOT_FOUND',message:'动画效果不存在'}})
  })
  app.get('/api/v1/animations/runtime.js',async(_request,reply)=>reply.type('text/javascript').header('Access-Control-Allow-Origin','*').header('X-Content-Type-Options','nosniff').send(await readFile(fileURLToPath(import.meta.resolve('@fastppt/slidewave/native-motion')),'utf8')))
  app.get<{Params:{id:string}}>('/api/v1/animations/preview/:id',async(request,reply)=>{
    const value=await library.read(id.parse(request.params.id));if(!value)return reply.code(404).send()
    const playback=z.object({autoplay:z.enum(['0','1']).default('0'),loop:z.enum(['0','1']).default('0')}).parse(request.query)
    const body=value.markdown.replace(/^---\n[\s\S]*?\n---\n/,'')
    // Script is fixed application code. Reference data is inert encoded JSON;
    // the renderer has no evaluation, network or parent-document access.
    const script=`import{applyNativeMotion,resetNativeMotion,orderedNativeEffects}from'/api/v1/animations/runtime.js';
const main=document.querySelector('main'),data=JSON.parse(document.querySelector('[data-fastppt-motion]').getAttribute('data-fastppt-motion')),effects=orderedNativeEffects(data.groups),autoplay=${playback.autoplay==='1'},loop=${playback.loop==='1'};
let previousStart=0,previousEnd=0,groupEnd=0,offset=0,playing=false,start=0,position=0,frame=0,userPaused=false,cycles=0;
const rows=effects.map(e=>{if(e.trigger==='on-click'){offset+=groupEnd;groupEnd=0;previousStart=previousEnd=0}const begin=(e.delayMs||0)+(e.trigger==='with-previous'?previousStart:e.trigger==='after-previous'?previousEnd:0);previousStart=begin;previousEnd=begin+e.durationMs;groupEnd=Math.max(groupEnd,previousEnd);return{effect:e,start:offset+begin,end:offset+previousEnd}}),total=Math.max(1,...rows.map(r=>r.end)),slider=document.querySelector('input'),button=document.querySelector('#play');slider.max=String(total);
function update(){button.textContent=playing?'暂停':'播放';button.setAttribute('aria-pressed',String(playing));main.dataset.motionPlaying=String(playing);main.dataset.motionCycles=String(cycles)}
function pause(){playing=false;cancelAnimationFrame(frame);update()}
function seek(ms){document.querySelector('#status').textContent='';position=ms;slider.value=String(ms);const targets=new Map();for(const r of rows)if(!targets.has(r.effect.target)||ms>=r.start)targets.set(r.effect.target,r);for(const r of targets.values()){const el=[...main.querySelectorAll('[data-fastppt-group]')].find(n=>n.dataset.fastpptGroup===r.effect.target);if(el)try{applyNativeMotion(el,r.effect,ms-r.start)}catch(e){document.querySelector('#status').textContent='浏览器暂不能完整还原：'+e.message;pause()}}}
function tick(now){if(!playing)return;const elapsed=now-start;if(elapsed>=total&&loop){cycles++;start=now;resetNativeMotion(main);seek(0);update()}else{seek(Math.min(total,elapsed));if(position>=total)pause()}if(playing)frame=requestAnimationFrame(tick)}
function play(){if(playing)return;if(position>=total)position=0;playing=true;start=performance.now()-position;update();frame=requestAnimationFrame(tick)}
button.onclick=()=>{userPaused=playing;playing?pause():play()};document.querySelector('#reset').onclick=()=>{userPaused=true;pause();resetNativeMotion(main);seek(0)};slider.oninput=()=>{userPaused=true;pause();seek(Number(slider.value))};document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(autoplay&&!userPaused)play()});window.addEventListener('pagehide',()=>{pause();resetNativeMotion(main)});await document.fonts.ready;await new Promise(requestAnimationFrame);seek(0);main.dataset.motionReady='true';update();if(autoplay&&!document.hidden)play();`
    return reply.header('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; sandbox allow-scripts").header('X-Content-Type-Options','nosniff').type('text/html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column;background:#f8fafc;font:12px system-ui}main{position:relative;flex:1;min-height:0}footer{display:flex;gap:8px;align-items:center;background:#edf1f5;padding:7px;color:#334155}button{background:white;border:1px solid #cbd5e1;border-radius:5px;padding:5px 9px}input{flex:1;min-width:20px}#status{max-width:50%;font-size:10px}</style><main data-motion-canvas>${body}</main><footer><button id="play">播放 / 暂停</button><button id="reset">重置</button><input aria-label="动画进度" type="range" min="0" value="0"><span id="status"></span></footer><script type="module">${script}</script></html>`)
  })
}
