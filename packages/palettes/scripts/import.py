"""Import public numeric palette data; never execute downloaded source code.

Source snapshots and SHA-256 digests make each import traceable. Existing
snapshots can be rebuilt offline with --offline. Runtime search is fully local.
"""
import ast, colorsys, hashlib, json, re, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
 'brewer': ('ColorBrewer', 'https://colorbrewer2.org/export/colorbrewer.json', 'Apache-2.0'),
 'open': ('Open Color', 'https://raw.githubusercontent.com/yeun/open-color/master/open-color.json', 'MIT'),
 'radix': ('Radix Colors', 'https://raw.githubusercontent.com/radix-ui/colors/main/src/light.ts', 'MIT'),
 'radix-dark': ('Radix Colors', 'https://raw.githubusercontent.com/radix-ui/colors/main/src/dark.ts', 'MIT'),
 'cat': ('Catppuccin', 'https://raw.githubusercontent.com/catppuccin/palette/main/palette.json', 'MIT'),
 'bokeh': ('Bokeh', 'https://raw.githubusercontent.com/bokeh/bokeh/branch-3.8/src/bokeh/palettes.py', 'BSD-3-Clause'),
 'plotly': ('Plotly', 'https://raw.githubusercontent.com/plotly/plotly.py/master/_plotly_utils/colors/qualitative.py', 'MIT'),
 'plotly-sequential': ('Plotly', 'https://raw.githubusercontent.com/plotly/plotly.py/master/_plotly_utils/colors/sequential.py', 'MIT'),
 'plotly-diverging': ('Plotly', 'https://raw.githubusercontent.com/plotly/plotly.py/master/_plotly_utils/colors/diverging.py', 'MIT'),
 'plotly-cyclical': ('Plotly', 'https://raw.githubusercontent.com/plotly/plotly.py/master/_plotly_utils/colors/cyclical.py', 'MIT'),
 'vega': ('Vega / D3', 'https://raw.githubusercontent.com/vega/vega/main/packages/vega-scale/src/palettes.js', 'BSD-3-Clause'),
}
SNAPSHOTS=ROOT/'data'/'sources'; SNAPSHOTS.mkdir(parents=True,exist_ok=True)
entries=[]; provenance=[]; by_colors={}
HUES=['红色 red','橙色 orange','黄色 yellow','绿色 green','青色 cyan','蓝色 blue','紫色 purple','粉色 pink']
def hex_color(c):
 if re.fullmatch(r'#[0-9a-fA-F]{6}',c): return c.upper()
 if re.fullmatch(r'#[0-9a-fA-F]{3}',c):return '#'+''.join(x*2 for x in c[1:]).upper()
 m=re.fullmatch(r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)',c)
 if m:return '#'+''.join(f'{int(x):02X}' for x in m.groups())
 return None

def add(key,name,colors,kind='categorical',tags=(),url=None):
 colors=[hex_color(c) for c in colors if isinstance(c,str)]
 colors=[c for c in colors if c]
 if len(colors)<2:return
 count=len(colors)
 if count>12:colors=[colors[round(i*(count-1)/8)] for i in range(9)]
 source,source_url,license=SOURCES.get(key,('Color Hunt','https://colorhunt.co/','Public palette values; source attribution retained'))
 url=url or source_url
 identity=tuple(colors)
 if identity in by_colors:
  item=by_colors[identity]
  item['aliases'].append(name)
  if url not in item['sources']:item['sources'].append(url)
  return
 hue_tags=set()
 for c in colors:
  r,g,b=[int(c[i:i+2],16)/255 for i in (1,3,5)]; h,l,s=colorsys.rgb_to_hls(r,g,b)
  if s<.16:hue_tags.add('中性 灰色 neutral gray')
  else:hue_tags.add(HUES[int((h*8+.5)%8)])
  if l>.75:hue_tags.add('浅色 light')
  if l<.24:hue_tags.add('深色 dark')
  if s<.45:hue_tags.add('柔和 muted pastel 莫兰迪')
 tags=list(dict.fromkeys([*tags,*sorted(hue_tags)]))
 item={'id':re.sub(r'[^a-z0-9]+','-',key+'-'+name.lower()).strip('-')[:88]+'-'+hashlib.sha256('|'.join(colors).encode()).hexdigest()[:8], 'title':name, 'family':re.sub(r'\s*[·-]?\s*\d+ colors?$','',name), 'kind':kind, 'colors':colors,'source':source,'sourceUrl':url,'sources':[url],'license':license,'tags':tags,'aliases':[],'originalColorCount':count}
 entries.append(item);by_colors[identity]=item

def load(key):
 source,url,license=SOURCES[key]; path=SNAPSHOTS/(key+'.txt')
 if '--offline' not in sys.argv:
  request=urllib.request.Request(url,headers={'User-Agent':'FastPPT numeric palette importer'})
  path.write_bytes(urllib.request.urlopen(request,timeout=30).read(4000000))
 data=path.read_bytes()
 provenance.append({'source':source,'url':url,'file':'sources/'+path.name,'sha256':hashlib.sha256(data).hexdigest(),'license':license})
 return data.decode()

for key in SOURCES:
 text=load(key)
 if key=='brewer':
  for name,palette in json.loads(text).items():
   kind={'seq':'sequential','div':'diverging','qual':'categorical'}.get(palette.get('type'),'categorical')
   for size,colors in palette.items():
    if size.isdigit():add(key,f'{name} · {size} colors',colors,kind,['经典 数据可视化 图表 科研 academic'])
 elif key=='open':
  for name,colors in json.loads(text).items():
   if isinstance(colors,list):add(key,name,colors,'sequential',['界面 UI 现代 简洁'])
 elif key.startswith('radix'):
  for name,block in re.findall(r'export const (\w+) = \{(.*?)\}',text,re.S):
   if name.endswith('A'):continue
   add(key,name+(' Dark' if key.endswith('dark') else ' Light'),re.findall(r'"(#[a-fA-F0-9]{6})"',block),'sequential',['界面 UI '+('暗色 dark' if key.endswith('dark') else '浅色 light')])
 elif key=='cat':
  for name,flavor in json.loads(text).items():
   if not isinstance(flavor,dict) or 'colors' not in flavor:continue
   add(key,'Catppuccin '+flavor['name'],[flavor['colors'][c]['hex'] for c in ['base','text','rosewater','mauve','blue','sapphire','green','yellow','peach']],'theme',['编辑器 温柔 pastel '+('暗色 dark' if flavor['dark'] else '浅色 light')])
 elif key=='bokeh' or key.startswith('plotly'):
  for node in ast.parse(text).body:
   if not isinstance(node,ast.Assign):continue
   try:colors=ast.literal_eval(node.value)
   except (ValueError,TypeError,SyntaxError):continue
   if not isinstance(colors,(tuple,list)) or not all(isinstance(c,str) for c in colors):continue
   name=node.targets[0].id if isinstance(node.targets[0],ast.Name) else ''
   if name and not name.startswith('_'):
    kind='diverging' if 'diverging' in key else 'cyclical' if 'cyclical' in key else 'sequential' if 'sequential' in key or key=='bokeh' else 'categorical'
    if key=='bokeh':
     if name.startswith(('Accent','Dark2','Paired','Pastel','Set','Category','Colorblind')):kind='categorical'
     elif name.startswith(('BrBG','PiYG','PRGn','PuOr','RdBu','RdGy','RdYlBu','RdYlGn','Spectral','Diverging')):kind='diverging'
    add(key,name,colors,kind,['经典 图表 数据 visualization 科研'])
 elif key=='vega':
  for name,hexes in re.findall(r"^\s+(\w+): '([0-9a-f]{12,})'",text,re.M):
   add(key,name,['#'+hexes[i:i+6] for i in range(0,len(hexes),6)],'sequential',['图表 visualization 科研 热力图'])

hunt=SNAPSHOTS/'colorhunt.json'

if '--refresh-colorhunt' in sys.argv:
 import concurrent.futures, urllib.parse
 def fetch_hunt(job):
  sort,step=job
  data=urllib.parse.urlencode({'step':step,'sort':sort,'tags':'','timeframe':'4000'}).encode()
  request=urllib.request.Request('https://colorhunt.co/php/feed.php',data=data,headers={'User-Agent':'Mozilla/5.0 FastPPT numeric palette importer','Referer':'https://colorhunt.co/','Content-Type':'application/x-www-form-urlencoded'})
  rows=json.loads(urllib.request.urlopen(request,timeout=30).read(1000000))
  for row in rows:row['tags']=['流行 popular 社区设计 品牌 现代' if sort=='popular' else '新鲜 contemporary 设计']
  time.sleep(.25)
  return rows
 rows={}
 jobs=[('popular',i) for i in range(25)]+[('new',i) for i in range(10)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for result in pool.map(fetch_hunt,jobs):
   for row in result:rows.setdefault(row['code'],row)
 hunt.write_text(json.dumps(list(rows.values()),ensure_ascii=False,indent=2))

if hunt.exists():
 raw=hunt.read_bytes();(SNAPSHOTS/'colorhunt.json').write_bytes(raw)
 provenance.append({'source':'Color Hunt','url':'https://colorhunt.co/','file':'sources/colorhunt.json','sha256':hashlib.sha256(raw).hexdigest(),'license':'Public palette values; source attribution retained'})
 for entry in json.loads(raw):
  code=entry['code']
  if re.fullmatch('[a-fA-F0-9]{24}',code):add('colorhunt','Color Hunt '+code[:8],['#'+code[i:i+6] for i in range(0,24,6)],'design',entry.get('tags',[]),url='https://colorhunt.co/palette/'+code)

entries.sort(key=lambda item:item['id'])
(ROOT/'data'/'index.json').write_text(json.dumps({'version':1,'sources':provenance,'entries':entries},ensure_ascii=False,indent=2)+'\n')
print(f'Imported {len(entries)} unique palettes from {len(set(item["source"] for item in entries))} sources.')
