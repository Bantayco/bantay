/**
 * Embedded JavaScript for the visualizer
 */

export interface ScriptData {
  cujsData: string;
  screensData: string;
  transitionsData: string;
  screenHtmlMapData: string;
  variantHtmlMapData: string;
  screenStatesData: string;
  stateHtmlMapData: string;
  stateNavMapData: string;
  hasGraphEntities: boolean;
  cujGraphsData: string;
}

/**
 * Generate the embedded JavaScript for the visualizer
 */
export function generateScripts(data: ScriptData): string {
  return `const cujs = ${data.cujsData};
const screens = ${data.screensData};
const transitions = ${data.transitionsData};
const screenHtmlMap = ${data.screenHtmlMapData};
const variantHtmlMap = ${data.variantHtmlMapData};
const screenStates = ${data.screenStatesData};
const stateHtmlMap = ${data.stateHtmlMapData};
const stateNavMap = ${data.stateNavMapData};
const hasGraphEntities = ${data.hasGraphEntities};
const cujGraphs = ${data.cujGraphsData};
const hasSeparateCujMaps = hasGraphEntities && cujGraphs.length > 0;

let currentMode='map';
let highlightedScenarioId=null;
let selectedMapCuj=null;
let activeCujSvg=null;
let highlightedStoryboardIdx=null;
let curCuj=null,curStep=0;
let walkSteps=[];
let currentScenarioIdx=0;

function getScreenName(screenId){
  const screen=screens.find(s=>s.id===screenId||s.id==='screen_'+screenId);
  return screen?screen.name:(screenId||'default');
}

const screenHtmlCache={};
function getScreenKey(screenId,scenario){
  const variants=Object.keys(scenario).filter(k=>k.startsWith('comp_')).sort().map(k=>k+'='+scenario[k]).join('|');
  return screenId+'::'+variants;
}
function getScreenHtml(screenId,scenario){
  const key=getScreenKey(screenId,scenario);
  if(!screenHtmlCache[key]){
    screenHtmlCache[key]=renderScreenForStep(screenId,scenario);
  }
  return screenHtmlCache[key];
}

function setMode(m){
  currentMode=m;
  document.getElementById('mode-map').classList.toggle('active',m==='map');
  document.getElementById('mode-walk').classList.toggle('active',m==='walk');
  document.getElementById('map-canvas').classList.toggle('hidden',m!=='map');
  document.getElementById('map-canvas').style.display=m==='map'?'flex':'none';
  document.getElementById('walk-canvas').classList.toggle('active',m==='walk');
  document.getElementById('zoom-btns').style.display=m==='map'?'flex':'none';
  document.getElementById('zoom-label').style.display=m==='map'?'inline':'none';
  if(m==='walk'){
    currentScenarioIdx=curStep;
    if(curCuj&&hasGraphEntities){
      const c=cujs[curCuj];
      const sc=c&&c.scenarios&&c.scenarios[currentScenarioIdx];
      if(sc&&sc.path){
        walkSteps=computeWalkSteps(sc.path);
        curStep=0;
      }
    }
    renderStep();
  }
  if(m==='map'){
    curStep=currentScenarioIdx;
    if(hasSeparateCujMaps&&selectedMapCuj){
      showCujMap(selectedMapCuj);
      const cuj=cujs[selectedMapCuj];
      const scenario=cuj&&cuj.scenarios&&cuj.scenarios[curStep];
      if(scenario&&scenario.path){
        highlightGraphPathInCuj(selectedMapCuj,scenario);
        const pathIds=scenario.path.split(',').map(s=>s.trim());
        drawCujArrows(selectedMapCuj,pathIds);
      }else{
        requestAnimationFrame(()=>redrawArrows());
      }
    }else if(hasSeparateCujMaps){
      const firstCujId=Object.keys(cujs)[0];
      if(firstCujId)selectCuj(firstCujId);
    }else{
      requestAnimationFrame(()=>requestAnimationFrame(drawArrows));
    }
  }
  updateSidebarHighlight();
}

function computeWalkSteps(path){
  const pathIds=path.split(',').map(s=>s.trim());
  const steps=[];
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      if(steps.length===0){
        steps.push({state:tr.from,fromState:null,transition:null,transitionAction:null});
      }
      steps.push({state:tr.to,fromState:tr.from,transition:trId,transitionAction:tr.action});
    }
  }
  return steps;
}

function computeWalkStates(path){
  return computeWalkSteps(path).map(s=>s.state);
}

function toggleDebug(){
  const app=document.querySelector('.app');
  const btn=document.getElementById('debug-toggle');
  app.classList.toggle('debug-mode');
  btn.classList.toggle('active');
}

function initSidebar(){
  const sidebar=document.getElementById('sidebar');
  const areas={};
  Object.entries(cujs).forEach(([id,c])=>{
    const area=c.area||'default';
    if(!areas[area])areas[area]=[];
    areas[area].push({id,cuj:c});
  });
  let html=hasSeparateCujMaps?'':'<div class="cuj-group"><div class="cuj-name" style="color:var(--accent);" onclick="showDefaultScreens()">All Screens</div></div>';
  Object.entries(areas).forEach(([area,cujList])=>{
    html+=\`<div class="area-label">\${area}</div>\`;
    cujList.forEach(({id,cuj})=>{
      html+=\`<div class="cuj-group" data-cuj="\${id}"><div class="cuj-name" onclick="selectCuj('\${id}')">\${cuj.name}</div>\`;
      cuj.scenarios.forEach((sc,i)=>{
        html+=\`<div class="scenario-item" data-cuj="\${id}" data-step="\${i}" data-scenario="\${sc.id}" data-screen="\${sc.screen}" onclick="selectScenario('\${id}',\${i},'\${sc.id}','\${sc.screen}')">\${sc.name}</div>\`;
      });
      html+=\`</div>\`;
    });
  });
  sidebar.innerHTML=html;
}

function showCujMap(cujId){
  if(!hasSeparateCujMaps)return;
  document.querySelectorAll('.cuj-map').forEach(el=>{el.style.display='none';});
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(mapEl){
    mapEl.style.display='block';
    activeCujSvg=document.getElementById('arrows-'+cujId);
    initCujMapDrag(cujId);
  }
}

function hideCujMaps(){
  if(!hasSeparateCujMaps)return;
  document.querySelectorAll('.cuj-map').forEach(el=>{el.style.display='none';});
  activeCujSvg=null;
}

function initCujMapDrag(cujId){
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    el.onmousedown=null;
    el.addEventListener('mousedown',e=>{
      dragNode=el;
      dragOff={x:e.clientX/zoom-(parseInt(el.style.left)||0),y:e.clientY/zoom-(parseInt(el.style.top)||0)};
      el.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

function drawCujArrows(cujId,pathIds){
  if(!hasSeparateCujMaps)return;
  const svgEl=document.getElementById('arrows-'+cujId);
  if(!svgEl)return;
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;
  const cujGraph=cujGraphs.find(g=>g.cujId===cujId);
  if(!cujGraph)return;
  const cujTransitions=transitions.filter(t=>cujGraph.transitionIds.includes(t.id));

  const obstacles=[];
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    obstacles.push({el,x:parseInt(el.style.left)||0,y:parseInt(el.style.top)||0});
  });

  const outPorts=new Map();
  const inPorts=new Map();

  let s='';
  const pathSet=pathIds?new Set(pathIds):null;
  for(const t of cujTransitions){
    const fromEl=mapEl.querySelector('#graph-node-'+t.from);
    const toEl=mapEl.querySelector('#graph-node-'+t.to);
    if(fromEl&&toEl){
      const isInPath=pathSet?pathSet.has(t.id):true;
      const color=isInPath?'var(--accent)':'var(--hint)';
      const opacity=isInPath?1:0.15;

      const outPort=outPorts.get(t.from)||0;
      const inPort=inPorts.get(t.to)||0;
      outPorts.set(t.from,(outPort+1));
      inPorts.set(t.to,(inPort+1));

      s+=drawEdgeWithPorts(fromEl,toEl,outPort,inPort,isInPath?t.action:null,color,isInPath,opacity,obstacles);
    }
  }
  svgEl.innerHTML=s;
}

function selectScenario(cujId,stepIdx,scenarioId,screenId){
  curCuj=cujId;
  curStep=stepIdx;
  currentScenarioIdx=stepIdx;
  highlightedScenarioId=scenarioId;

  if(currentMode==='map'){
    document.querySelectorAll('.screen.highlighted').forEach(el=>el.classList.remove('highlighted'));
    document.querySelectorAll('.storyboard-card.highlighted').forEach(el=>el.classList.remove('highlighted'));
    document.querySelectorAll('.graph-node.highlighted').forEach(el=>el.classList.remove('highlighted'));
    document.querySelectorAll('.graph-node.dimmed').forEach(el=>el.classList.remove('dimmed'));

    const cuj=cujs[cujId];
    const scenario=cuj&&cuj.scenarios[stepIdx];

    if(hasSeparateCujMaps&&scenario&&scenario.path){
      selectedMapCuj=cujId;
      showCujMap(cujId);
      document.getElementById('storyboard-container').classList.remove('active');
      highlightGraphPathInCuj(cujId,scenario);
      const pathIds=scenario.path.split(',').map(s=>s.trim());
      drawCujArrows(cujId,pathIds);
      requestAnimationFrame(()=>document.getElementById('zoom-fit').click());
    }else if(hasGraphEntities&&scenario&&scenario.path){
      selectedMapCuj=cujId;
      document.getElementById('default-screens').classList.remove('hidden');
      document.getElementById('storyboard-container').classList.remove('active');
      highlightGraphPath(scenario);
      drawArrowsWithPath(scenario);
    }else{
      if(selectedMapCuj&&selectedMapCuj===cujId){
        highlightStoryboardCard(stepIdx);
      }else{
        selectedMapCuj=cujId;
        renderStoryboard(cujId);
        highlightStoryboardCard(stepIdx);
      }
    }
  }else{
    currentScenarioIdx=stepIdx;
    if(hasGraphEntities){
      const cuj=cujs[cujId];
      const scenario=cuj&&cuj.scenarios[stepIdx];
      if(scenario&&scenario.path){
        walkSteps=computeWalkSteps(scenario.path);
        curStep=0;
      }
    }
    renderStep();
  }
  updateSidebarHighlight();
}

function selectCuj(cujId){
  curCuj=cujId;
  curStep=0;

  if(currentMode==='map'){
    selectedMapCuj=cujId;
    highlightedScenarioId=null;
    const cuj=cujs[cujId];
    const scenario=cuj&&cuj.scenarios[0];

    if(hasSeparateCujMaps){
      showCujMap(cujId);
      document.getElementById('storyboard-container').classList.remove('active');
      clearGraphHighlightsInCuj(cujId);
      drawCujArrows(cujId,null);
      requestAnimationFrame(()=>document.getElementById('zoom-fit').click());
    }else if(hasGraphEntities&&scenario&&scenario.path){
      document.getElementById('default-screens').classList.remove('hidden');
      document.getElementById('storyboard-container').classList.remove('active');
      highlightGraphPath(scenario);
      drawArrowsWithPath(scenario);
    }else{
      renderStoryboard(cujId);
    }
  }else{
    const cuj=cujs[cujId];
    if(cuj&&cuj.scenarios.length>0){
      const firstSc=cuj.scenarios[0];
      selectScenario(cujId,0,firstSc.id,firstSc.screen);
      return;
    }
  }
  updateSidebarHighlight();
}

function updateSidebarHighlight(){
  document.querySelectorAll('.sidebar .cuj-name.selected').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.sidebar .scenario-item.current').forEach(el=>el.classList.remove('current'));

  if(currentMode==='map'&&selectedMapCuj){
    document.querySelectorAll('.sidebar .cuj-group[data-cuj="'+selectedMapCuj+'"] .cuj-name').forEach(el=>el.classList.add('selected'));
  }

  const scenarioIdx=(currentMode==='walk'&&hasGraphEntities)?currentScenarioIdx:curStep;
  if(curCuj&&scenarioIdx!==null){
    document.querySelectorAll('.sidebar .scenario-item[data-cuj="'+curCuj+'"][data-step="'+scenarioIdx+'"]').forEach(el=>el.classList.add('current'));
  }
}

function showDefaultScreens(){
  selectedMapCuj=null;
  highlightedScenarioId=null;
  curCuj=null;
  curStep=0;
  document.getElementById('storyboard-container').classList.remove('active');
  document.getElementById('storyboard-container').innerHTML='';

  if(hasSeparateCujMaps){
    hideCujMaps();
  }else{
    document.getElementById('default-screens').classList.remove('hidden');
  }

  document.querySelectorAll('.screen.highlighted').forEach(el=>el.classList.remove('highlighted'));
  clearGraphHighlights();
  updateSidebarHighlight();
  if(!hasSeparateCujMaps)drawArrows();
}

function getStateKey(scenario){
  const variants=Object.keys(scenario).filter(k=>k.startsWith('comp_')).sort().map(k=>k+'='+scenario[k]).join('|');
  return scenario.screen+'::'+variants;
}

let stateCards=[];
let scenarioToCard={};

function renderStoryboard(cujId){
  const cuj=cujs[cujId];
  if(!cuj)return;

  if(hasGraphEntities&&cuj.scenarios[0]&&cuj.scenarios[0].path){
    renderPathStoryboard(cujId,0);
    return;
  }

  document.getElementById('default-screens').classList.add('hidden');
  const container=document.getElementById('storyboard-container');
  container.classList.add('active');
  container.innerHTML='';

  stateCards=[];
  scenarioToCard={};
  const seenKeys={};
  cuj.scenarios.forEach((sc,i)=>{
    const key=getStateKey(sc);
    if(!seenKeys[key]){
      seenKeys[key]={stateKey:key,screenId:sc.screen,scenario:sc,scenarios:[sc],cardIdx:stateCards.length};
      stateCards.push(seenKeys[key]);
    }else{
      seenKeys[key].scenarios.push(sc);
    }
    scenarioToCard[i]=seenKeys[key].cardIdx;
  });

  let xPos=80;
  stateCards.forEach((card,cardIdx)=>{
    const screenId=card.screenId;
    const el=document.createElement('div');
    el.className='storyboard-card';
    el.id='storyboard-'+cardIdx;
    el.style.left=xPos+'px';
    el.style.top='80px';
    const names=card.scenarios.map(s=>s.name).join('<br>');
    const navHtml=getNavHtml(screenId);
    el.innerHTML=\`<div class="s-tag">\${getScreenName(screenId)}</div><div class="s-body"></div>\${navHtml}<div class="storyboard-label"><span class="scenario-name">\${names}</span><span class="screen-id">\${card.screenId||'default'}</span></div>\`;
    el.querySelector('.s-body').innerHTML=getScreenHtml(screenId,card.scenario);
    container.appendChild(el);
    xPos+=300;
  });
  highlightedStoryboardIdx=null;
  drawStoryboardArrows(stateCards,highlightedStoryboardIdx);
}

function highlightStoryboardCard(scenarioIdx){
  const cardIdx=scenarioToCard[scenarioIdx];
  highlightedStoryboardIdx=cardIdx;
  document.querySelectorAll('.storyboard-card.highlighted').forEach(el=>el.classList.remove('highlighted'));
  const cardEl=document.getElementById('storyboard-'+cardIdx);
  if(cardEl){
    cardEl.classList.add('highlighted');
    panToCard(cardEl);
  }
  drawStoryboardArrows(stateCards,highlightedStoryboardIdx);
}

function panToCard(el){
  const mapCanvas=document.getElementById('map-canvas');
  const vw=mapCanvas.clientWidth;
  const vh=mapCanvas.clientHeight;
  const cardX=parseInt(el.style.left)||0;
  const cardY=parseInt(el.style.top)||0;
  const cardW=220;
  const cardH=el.offsetHeight||476;
  panX=(vw/2)-(cardX+cardW/2)*zoom;
  panY=(vh/2)-(cardY+cardH/2)*zoom;
  applyTransform();
}

function walkStep(d){
  const c=cujs[curCuj];
  const scenario=c.scenarios[currentScenarioIdx];
  const total=hasGraphEntities&&scenario&&scenario.path?walkSteps.length:c.scenarios.length;
  const n=curStep+d;
  if(n<0||n>=total)return;
  curStep=n;
  renderStep();
  updateSidebarHighlight();
}

function renderScreenForStep(screenId,scenario){
  const screenData=screens.find(s=>s.id===screenId||s.name.toLowerCase()===scenario.screen);
  if(!screenData||!screenData.components||screenData.components.length===0){
    return \`<div style="padding:20px;text-align:center;color:var(--hint);">\${scenario.name}</div>\`;
  }
  let html='';
  for(const comp of screenData.components){
    const variant=scenario[comp.id];
    const variantKey=variant?comp.id+'--'+variant:null;
    const wireframe=(variantKey&&variantHtmlMap[variantKey])||comp.wireframeHtml||\`<div class="comp-desc">\${comp.description||comp.name}</div>\`;
    const label=variant?comp.id+' · '+variant:comp.id;
    html+=\`<div class="comp-box"><div class="comp-label">\${label}</div>\${wireframe}</div>\`;
  }
  return html;
}

function getNavHtml(screenId){
  const screenData=screens.find(s=>s.id===screenId);
  if(!screenData)return '';
  if(screenData.nav==='none'){
    return '<div class="nav-footer">no nav — immersive</div>';
  }else if(screenData.nav){
    return '<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
  }
  return '';
}

function renderStep(){
  const c=cujs[curCuj],sc=c.scenarios[currentScenarioIdx];
  const w=document.getElementById('walk-screen');

  if(hasGraphEntities&&sc&&sc.path){
    const tot=walkSteps.length;
    const step=walkSteps[curStep];
    if(!step)return;
    const st=screenStates.find(s=>s.id===step.state);
    if(st){
      const bodyHtml=stateHtmlMap[step.state]||'<div style="padding:20px;text-align:center;color:var(--hint);">'+step.state+'</div>';
      const navHtml=stateNavMap[step.state]||'';
      w.innerHTML=\`<div class="ws-tag">\${getScreenName(st.screen)}</div><div class="ws-body">\${bodyHtml}</div>\${navHtml}\`;
    }else{
      w.innerHTML=\`<div class="ws-tag">\${step.state}</div><div class="ws-body"><div style="padding:20px;text-align:center;color:var(--hint);">\${step.state}</div></div>\`;
    }
    document.getElementById('walk-progress').innerHTML=walkSteps.map((_,i)=>\`<div class="walk-dot \${i<curStep?'done':''} \${i===curStep?'current':''}"></div>\`).join('');
    document.getElementById('walk-step-counter').textContent=\`Step \${curStep+1} of \${tot}\`;
    document.getElementById('walk-scenario-name').textContent=sc.name;
    document.getElementById('walk-scenario-id').textContent=sc.id;
    let transitionHtml='';
    if(step.transition){
      transitionHtml=\`<div style="margin-bottom:12px;padding:8px;background:var(--bd);border-radius:6px;font-family:monospace;font-size:10px;">
        <div style="color:var(--hint);margin-bottom:4px;">\${step.fromState}</div>
        <div style="color:var(--accent);margin-bottom:4px;">↓ \${step.transitionAction}</div>
        <div style="color:var(--fg);font-weight:600;">\${step.state}</div>
      </div>\`;
    }else{
      transitionHtml=\`<div style="margin-bottom:12px;padding:8px;background:var(--bd);border-radius:6px;font-family:monospace;font-size:10px;">
        <div style="color:var(--fg);font-weight:600;">\${step.state}</div>
        <div style="color:var(--hint);font-size:9px;margin-top:4px;">Starting state</div>
      </div>\`;
    }
    document.getElementById('walk-gherkin').innerHTML=transitionHtml;
    const iv=document.getElementById('walk-invariants');iv.innerHTML=sc.invs&&sc.invs.length?\`<div class="walk-inv-title">Protected by</div>\`+sc.invs.map(i=>\`<div class="walk-inv-item">\${i}</div>\`).join(''):'';
    document.getElementById('walk-prev').disabled=curStep===0;document.getElementById('walk-next').disabled=curStep===tot-1;
    return;
  }

  const legacySc=c.scenarios[curStep],tot=c.scenarios.length;
  const screenId=legacySc.screen;
  w.innerHTML=\`<div class="ws-tag">\${getScreenName(screenId)}</div><div class="ws-body"></div>\`;
  w.querySelector('.ws-body').innerHTML=getScreenHtml(screenId,legacySc);
  document.getElementById('walk-progress').innerHTML=c.scenarios.map((_,i)=>\`<div class="walk-dot \${i<curStep?'done':''} \${i===curStep?'current':''}"></div>\`).join('');
  document.getElementById('walk-step-counter').textContent=\`Step \${curStep+1} of \${tot}\`;
  document.getElementById('walk-scenario-name').textContent=legacySc.name;
  document.getElementById('walk-scenario-id').textContent=legacySc.id;
  document.getElementById('walk-gherkin').innerHTML=\`<div><span class="kw">Given </span>\${legacySc.given}</div><div><span class="kw">When </span>\${legacySc.when}</div><div><span class="kw">Then </span>\${legacySc.then}</div>\`;
  const iv=document.getElementById('walk-invariants');iv.innerHTML=legacySc.invs&&legacySc.invs.length?\`<div class="walk-inv-title">Protected by</div>\`+legacySc.invs.map(i=>\`<div class="walk-inv-item">\${i}</div>\`).join(''):'';
  document.getElementById('walk-prev').disabled=curStep===0;document.getElementById('walk-next').disabled=curStep===tot-1;
  document.querySelectorAll('.scenario-item').forEach(el=>{
    el.classList.toggle('current',el.dataset.cuj===curCuj&&parseInt(el.dataset.step)===curStep);
  });
}

document.addEventListener('keydown',e=>{
  if(document.getElementById('walk-canvas').classList.contains('active')){
    if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();walkStep(1);}
    if(e.key==='ArrowLeft'){e.preventDefault();walkStep(-1);}
    return;
  }
  if(currentMode==='map'&&selectedMapCuj&&stateCards.length>0){
    const len=stateCards.length;
    if(e.key==='ArrowRight'){
      e.preventDefault();
      if(highlightedStoryboardIdx===null){
        highlightedStoryboardIdx=0;
        curStep=0;
        highlightStoryboardCard(0);
        updateSidebarHighlight();
      }else if(highlightedStoryboardIdx<len-1){
        const nextCardIdx=highlightedStoryboardIdx+1;
        const firstScenarioIdx=Object.keys(scenarioToCard).find(k=>scenarioToCard[k]===nextCardIdx);
        curStep=parseInt(firstScenarioIdx)||0;
        highlightStoryboardCard(curStep);
        updateSidebarHighlight();
      }
    }
    if(e.key==='ArrowLeft'){
      e.preventDefault();
      if(highlightedStoryboardIdx!==null&&highlightedStoryboardIdx>0){
        const prevCardIdx=highlightedStoryboardIdx-1;
        const firstScenarioIdx=Object.keys(scenarioToCard).find(k=>scenarioToCard[k]===prevCardIdx);
        curStep=parseInt(firstScenarioIdx)||0;
        highlightStoryboardCard(curStep);
        updateSidebarHighlight();
      }
    }
  }
});

const mapCanvas=document.getElementById('map-canvas'),panLayer=document.getElementById('pan-layer'),svg=document.getElementById('arrows'),GRID=20;
let zoom=0.5,panX=0,panY=0,isPanning=false,panStart={x:0,y:0};
function applyTransform(){panLayer.style.transform=\`translate(\${panX}px,\${panY}px) scale(\${zoom})\`;document.getElementById('zoom-label').textContent=Math.round(zoom*100)+'%';}
document.getElementById('zoom-in').onclick=()=>{zoom=Math.min(2,zoom+0.1);applyTransform();redrawArrows();};
document.getElementById('zoom-out').onclick=()=>{zoom=Math.max(0.15,zoom-0.1);applyTransform();redrawArrows();};
document.getElementById('zoom-reset').onclick=()=>{zoom=1;panX=0;panY=0;applyTransform();redrawArrows();};
document.getElementById('zoom-fit').onclick=()=>{
  let ns;
  if(hasSeparateCujMaps&&selectedMapCuj){
    ns=document.querySelectorAll('#cuj-map-'+selectedMapCuj+' .graph-node');
  }else{
    ns=document.querySelectorAll('#pan-layer .screen,#pan-layer .graph-node');
  }
  if(ns.length===0)return;
  let x1=Infinity,y1=Infinity,x2=0,y2=0;
  ns.forEach(n=>{const l=parseInt(n.style.left),t=parseInt(n.style.top);x1=Math.min(x1,l);y1=Math.min(y1,t);x2=Math.max(x2,l+220);y2=Math.max(y2,t+n.offsetHeight);});
  const w=x2-x1+160,h=y2-y1+160,vw=mapCanvas.clientWidth,vh=mapCanvas.clientHeight;
  zoom=Math.min(vw/w,vh/h,1);panX=(vw-w*zoom)/2-x1*zoom+60;panY=(vh-h*zoom)/2-y1*zoom+60;
  applyTransform();redrawArrows();
};
mapCanvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(0.15,Math.min(2,zoom+(e.deltaY>0?-0.05:0.05)));applyTransform();redrawArrows();},{passive:false});
mapCanvas.addEventListener('mousedown',e=>{if(e.target.closest('.screen,.graph-node,.toolbar'))return;isPanning=true;panStart={x:e.clientX-panX,y:e.clientY-panY};mapCanvas.style.cursor='grabbing';e.preventDefault();});
window.addEventListener('mousemove',e=>{if(isPanning){panX=e.clientX-panStart.x;panY=e.clientY-panStart.y;applyTransform();redrawArrows();}});
window.addEventListener('mouseup',()=>{if(isPanning){isPanning=false;mapCanvas.style.cursor='default';}});

function snap(v){return Math.round(v/GRID)*GRID;}
let dragNode=null,dragOff={x:0,y:0};
document.querySelectorAll('#pan-layer .screen,#pan-layer .graph-node').forEach(el=>{el.addEventListener('mousedown',e=>{dragNode=el;dragOff={x:e.clientX/zoom-(parseInt(el.style.left)||0),y:e.clientY/zoom-(parseInt(el.style.top)||0)};el.classList.add('dragging');e.preventDefault();e.stopPropagation();});});
window.addEventListener('mousemove',e=>{if(!dragNode)return;dragNode.style.left=snap(e.clientX/zoom-dragOff.x)+'px';dragNode.style.top=snap(e.clientY/zoom-dragOff.y)+'px';redrawArrows();});
window.addEventListener('mouseup',()=>{if(dragNode){dragNode.classList.remove('dragging');dragNode=null;}});

document.addEventListener('mouseover',e=>{
  const target=e.target.closest('.edge-hover-target');
  if(target){
    const fromId=target.dataset.from;
    const toId=target.dataset.to;
    const parentMap=target.closest('.cuj-map')||document;
    const fromEl=parentMap.querySelector('[id="graph-node-'+fromId+'"]');
    const toEl=parentMap.querySelector('[id="graph-node-'+toId+'"]');
    if(fromEl)fromEl.classList.add('edge-hover');
    if(toEl)toEl.classList.add('edge-hover');
    const edgeLine=target.nextElementSibling;
    if(edgeLine&&edgeLine.classList.contains('edge-line')){
      edgeLine.classList.add('edge-hover');
    }
  }
});
document.addEventListener('mouseout',e=>{
  const target=e.target.closest('.edge-hover-target');
  if(target){
    document.querySelectorAll('.graph-node.edge-hover').forEach(el=>el.classList.remove('edge-hover'));
    document.querySelectorAll('.edge-line.edge-hover').forEach(el=>el.classList.remove('edge-hover'));
  }
});

function getAnchor(el,side){const lr=panLayer.getBoundingClientRect(),er=el.getBoundingClientRect();const cx=(er.left-lr.left)/zoom+er.width/(2*zoom),cy=(er.top-lr.top)/zoom+er.height/(2*zoom),w=er.width/zoom,h=er.height/zoom;switch(side){case'right':return{x:cx+w/2,y:cy};case'left':return{x:cx-w/2,y:cy};case'top':return{x:cx,y:cy-h/2};case'bottom':return{x:cx,y:cy+h/2};default:return{x:cx,y:cy};}}

function drawEdge(fEl,fS,tEl,tS,label,color,isHighlighted,opacity=1,obstacles=[],edgeOffset=0){
  const a=getAnchor(fEl,fS),b=getAnchor(tEl,tS);
  const mid='ah-'+Math.random().toString(36).slice(2,8);
  const strokeWidth=isHighlighted?3:1.5;
  const cssClass=isHighlighted?'class="arrow-highlighted"':'';
  const opacityAttr=opacity<1?\` opacity="\${opacity}"\`:'';

  const path=computeOrthogonalPath(a,b,fS,tS,fEl,tEl,obstacles,edgeOffset);

  let s=\`<defs><marker id="\${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`;
  s+=\`<path \${cssClass} d="\${path}" fill="none" stroke="\${color}" stroke-width="\${strokeWidth}"\${opacityAttr} marker-end="url(#\${mid})"/>\`;

  if(label){
    const points=pathToPoints(path);
    let bestSeg={x1:a.x,x2:b.x,y:a.y,len:0};
    for(let i=0;i<points.length-1;i++){
      const p1=points[i],p2=points[i+1];
      if(Math.abs(p1.y-p2.y)<1){
        const len=Math.abs(p2.x-p1.x);
        if(len>bestSeg.len){
          bestSeg={x1:Math.min(p1.x,p2.x),x2:Math.max(p1.x,p2.x),y:p1.y,len};
        }
      }
    }
    const lx=(bestSeg.x1+bestSeg.x2)/2;
    const ly=bestSeg.y-10;
    const tw=label.length*5.2+12;
    s+=\`<rect x="\${lx-tw/2}" y="\${ly-9}" width="\${tw}" height="16" rx="3" fill="var(--bg)" fill-opacity="0.92" stroke="var(--bd)" stroke-width="0.5"\${opacityAttr}/>\`;
    s+=\`<text x="\${lx}" y="\${ly+2}" text-anchor="middle" font-size="8" font-family="monospace" fill="\${color}"\${opacityAttr}>\${label}</text>\`;
  }
  return s;
}

function pathToPoints(pathD){
  const points=[];
  const cmds=pathD.match(/[ML]\\s*[\\d.,-]+/g)||[];
  for(const cmd of cmds){
    const nums=cmd.match(/[\\d.]+/g);
    if(nums&&nums.length>=2)points.push({x:parseFloat(nums[0]),y:parseFloat(nums[1])});
  }
  return points;
}

function drawEdgeWithPorts(fEl,tEl,outPort,inPort,label,color,isHighlighted,opacity,obstacles){
  const nodeW=220,nodeH=476,portSpacing=40;
  const fRect={x:parseInt(fEl.style.left)||0,y:parseInt(fEl.style.top)||0};
  const tRect={x:parseInt(tEl.style.left)||0,y:parseInt(tEl.style.top)||0};
  const fromId=fEl.id.replace('graph-node-','');
  const toId=tEl.id.replace('graph-node-','');

  const baseY=120;
  const outY=fRect.y+baseY+outPort*portSpacing;
  const inY=tRect.y+baseY+inPort*portSpacing;

  const a={x:fRect.x+nodeW,y:outY};
  const b={x:tRect.x,y:inY};

  const mid='ah-'+Math.random().toString(36).slice(2,8);
  const strokeWidth=isHighlighted?2.5:1.5;
  const edgeClasses=isHighlighted?'edge-line arrow-highlighted':'edge-line';
  const opacityAttr=opacity<1?\` opacity="\${opacity}"\`:'';

  const path=computePortPath(a,b,fRect,tRect,nodeW,nodeH,obstacles);

  let s=\`<defs><marker id="\${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`;
  s+=\`<path class="edge-hover-target" d="\${path}" fill="none" stroke="transparent" stroke-width="12" data-from="\${fromId}" data-to="\${toId}" style="cursor:pointer;pointer-events:auto;"/>\`;
  s+=\`<path class="\${edgeClasses}" d="\${path}" fill="none" stroke="\${color}" stroke-width="\${strokeWidth}"\${opacityAttr} marker-end="url(#\${mid})" style="pointer-events:none;"/>\`;

  if(label){
    const points=pathToPoints(path);
    let bestSeg={x1:a.x,x2:b.x,y:a.y,len:0};
    for(let i=0;i<points.length-1;i++){
      const p1=points[i],p2=points[i+1];
      if(Math.abs(p1.y-p2.y)<1){
        const len=Math.abs(p2.x-p1.x);
        if(len>bestSeg.len)bestSeg={x1:Math.min(p1.x,p2.x),x2:Math.max(p1.x,p2.x),y:p1.y,len};
      }
    }
    const lx=(bestSeg.x1+bestSeg.x2)/2;
    const ly=bestSeg.y-10;
    const tw=label.length*5.2+12;
    s+=\`<rect x="\${lx-tw/2}" y="\${ly-9}" width="\${tw}" height="16" rx="3" fill="var(--bg)" fill-opacity="0.92" stroke="var(--bd)" stroke-width="0.5"\${opacityAttr}/>\`;
    s+=\`<text x="\${lx}" y="\${ly+2}" text-anchor="middle" font-size="8" font-family="monospace" fill="\${color}"\${opacityAttr}>\${label}</text>\`;
  }
  return s;
}

function computePortPath(a,b,fRect,tRect,nodeW,nodeH,obstacles){
  const margin=20;
  const dx=tRect.x-fRect.x;

  if(fRect.x===tRect.x&&fRect.y===tRect.y){
    const loopH=50;
    return \`M\${a.x},\${a.y} L\${a.x+margin},\${a.y} L\${a.x+margin},\${fRect.y-loopH} L\${fRect.x-margin},\${fRect.y-loopH} L\${fRect.x-margin},\${b.y} L\${b.x},\${b.y}\`;
  }

  if(dx<=0){
    const routeY=Math.min(fRect.y,tRect.y)-40;
    return \`M\${a.x},\${a.y} L\${a.x+margin},\${a.y} L\${a.x+margin},\${routeY} L\${b.x-margin},\${routeY} L\${b.x-margin},\${b.y} L\${b.x},\${b.y}\`;
  }

  const midX=a.x+(b.x-a.x)/2;
  if(Math.abs(a.y-b.y)<10){
    return \`M\${a.x},\${a.y} L\${b.x},\${b.y}\`;
  }
  return \`M\${a.x},\${a.y} L\${midX},\${a.y} L\${midX},\${b.y} L\${b.x},\${b.y}\`;
}

function computeOrthogonalPath(a,b,fS,tS,fEl,tEl,obstacles,edgeOffset=0){
  const nodeW=220,nodeH=476,margin=25,gap=40;

  const fRect={x:parseInt(fEl.style.left)||0,y:parseInt(fEl.style.top)||0,w:nodeW,h:nodeH};
  const tRect={x:parseInt(tEl.style.left)||0,y:parseInt(tEl.style.top)||0,w:nodeW,h:nodeH};

  const dx=tRect.x-fRect.x;
  const dy=b.y-a.y;

  if(fEl===tEl){
    const loopH=gap+edgeOffset*20;
    return \`M\${a.x},\${a.y} L\${a.x+margin},\${a.y} L\${a.x+margin},\${fRect.y-loopH} L\${fRect.x-margin},\${fRect.y-loopH} L\${fRect.x-margin},\${b.y} L\${b.x},\${b.y}\`;
  }

  let row1Bottom=0, row2Top=Infinity;
  for(const o of obstacles){
    const oBottom=o.y+nodeH;
    const oTop=o.y;
    if(o.y<400){
      row1Bottom=Math.max(row1Bottom,oBottom);
    }else{
      row2Top=Math.min(row2Top,oTop);
    }
  }
  const gapY=row1Bottom+(row2Top-row1Bottom)/2;

  if(dx<=0){
    const routeY=gapY+edgeOffset*20;
    const exitX=fRect.x+nodeW+margin;
    const entryX=tRect.x-margin;
    return \`M\${a.x},\${a.y} L\${exitX},\${a.y} L\${exitX},\${routeY} L\${entryX},\${routeY} L\${entryX},\${b.y} L\${b.x},\${b.y}\`;
  }

  const midX=a.x+(b.x-a.x)/2;

  if(Math.abs(dy)<100){
    if(Math.abs(dy)<10){
      return \`M\${a.x},\${a.y} L\${b.x},\${b.y}\`;
    }else{
      return \`M\${a.x},\${a.y} L\${midX},\${a.y} L\${midX},\${b.y} L\${b.x},\${b.y}\`;
    }
  }

  const exitX=a.x+margin;
  const entryX=b.x-margin;
  return \`M\${a.x},\${a.y} L\${exitX},\${a.y} L\${exitX},\${gapY} L\${entryX},\${gapY} L\${entryX},\${b.y} L\${b.x},\${b.y}\`;
}

function drawArrows(){
  let s='';
  if(selectedMapCuj&&!hasGraphEntities){
    svg.innerHTML='';
    return;
  }
  const obstacles=[];
  const prefix=hasGraphEntities?'graph-node-':'node-';
  document.querySelectorAll('#pan-layer .graph-node, #pan-layer .screen').forEach(el=>{
    obstacles.push({el,x:parseInt(el.style.left)||0,y:parseInt(el.style.top)||0});
  });

  const outPorts=new Map();
  const inPorts=new Map();

  transitions.forEach(t=>{
    const fromEl=document.getElementById(prefix+t.from);
    const toEl=document.getElementById(prefix+t.to);
    if(fromEl&&toEl){
      const isHighlighted=t.scenarioId===highlightedScenarioId;
      const outPort=outPorts.get(t.from)||0;
      const inPort=inPorts.get(t.to)||0;
      outPorts.set(t.from,outPort+1);
      inPorts.set(t.to,inPort+1);
      s+=drawEdgeWithPorts(fromEl,toEl,outPort,inPort,t.action,'var(--accent)',isHighlighted,1,obstacles);
    }
  });
  svg.innerHTML=s;
}

function drawArrowsWithPath(scenario){
  if(!scenario||!scenario.path){drawArrows();return;}
  const pathIds=new Set(scenario.path.split(',').map(s=>s.trim()));
  const obstacles=[];
  const prefix=hasGraphEntities?'graph-node-':'node-';
  document.querySelectorAll('#pan-layer .graph-node, #pan-layer .screen').forEach(el=>{
    obstacles.push({el,x:parseInt(el.style.left)||0,y:parseInt(el.style.top)||0});
  });

  const outPorts=new Map();
  const inPorts=new Map();

  let s='';
  transitions.forEach(t=>{
    const fromEl=document.getElementById(prefix+t.from);
    const toEl=document.getElementById(prefix+t.to);
    if(fromEl&&toEl){
      const isInPath=pathIds.has(t.id);
      const color=isInPath?'var(--accent)':'var(--hint)';
      const opacity=isInPath?1:0.15;
      const outPort=outPorts.get(t.from)||0;
      const inPort=inPorts.get(t.to)||0;
      outPorts.set(t.from,outPort+1);
      inPorts.set(t.to,inPort+1);
      s+=drawEdgeWithPorts(fromEl,toEl,outPort,inPort,isInPath?t.action:null,color,isInPath,opacity,obstacles);
    }
  });
  svg.innerHTML=s;
}

function redrawArrows(){
  if(hasSeparateCujMaps&&selectedMapCuj){
    const cuj=cujs[selectedMapCuj];
    const scenario=highlightedScenarioId?cuj.scenarios.find(s=>s.id===highlightedScenarioId):null;
    const pathIds=scenario&&scenario.path?scenario.path.split(',').map(s=>s.trim()):null;
    drawCujArrows(selectedMapCuj,pathIds);
    return;
  }
  if(hasGraphEntities&&selectedMapCuj){
    const cuj=cujs[selectedMapCuj];
    const scenario=cuj&&cuj.scenarios[0];
    if(scenario&&scenario.path){
      drawArrowsWithPath(scenario);
      return;
    }
  }
  drawArrows();
}

function drawStoryboardArrows(scenarios,highlightedStoryboardIdx){
  let s='';
  for(let i=0;i<scenarios.length-1;i++){
    const fromEl=document.getElementById('storyboard-'+i);
    const toEl=document.getElementById('storyboard-'+(i+1));
    if(fromEl&&toEl){
      const isHighlighted=i+1===highlightedStoryboardIdx;
      s+=drawEdge(fromEl,'right',toEl,'left',null,'var(--accent)',isHighlighted);
    }
  }
  svg.innerHTML=s;
}

let sidebarWidth=220;
function initResize(){
  const handle=document.getElementById('resize-handle');
  const sidebar=document.getElementById('sidebar');
  let isResizing=false;
  handle.addEventListener('mousedown',e=>{isResizing=true;e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(!isResizing)return;
    const newWidth=Math.max(150,Math.min(400,e.clientX));
    sidebar.style.width=newWidth+'px';
    sidebarWidth=newWidth;
  });
  window.addEventListener('mouseup',()=>{isResizing=false;});
}

let walkPanelWidth=300;
function initWalkResize(){
  const leftHandle=document.getElementById('walk-resize-left');
  const rightHandle=document.getElementById('walk-resize-right');
  const panel=document.querySelector('.walk-panel');
  let resizingLeft=false,resizingRight=false;
  if(leftHandle)leftHandle.addEventListener('mousedown',e=>{resizingLeft=true;e.preventDefault();});
  if(rightHandle)rightHandle.addEventListener('mousedown',e=>{resizingRight=true;e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(resizingRight){
      const viewWidth=window.innerWidth;
      const newWidth=Math.max(200,Math.min(450,viewWidth-e.clientX));
      panel.style.width=newWidth+'px';
      walkPanelWidth=newWidth;
    }
  });
  window.addEventListener('mouseup',()=>{resizingLeft=false;resizingRight=false;});
}

document.getElementById('sidebar').addEventListener('wheel',e=>{e.stopPropagation();},{passive:true});

function renderPathStoryboard(cujId,scenarioIdx){
  const cuj=cujs[cujId];
  if(!cuj)return;
  const scenario=cuj.scenarios[scenarioIdx];
  if(!scenario||!scenario.path)return;

  document.getElementById('default-screens').classList.add('hidden');
  const container=document.getElementById('storyboard-container');
  container.classList.add('active');
  container.innerHTML='';

  const pathIds=scenario.path.split(',').map(s=>s.trim());

  const visitedStates=[];
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      if(visitedStates.length===0||visitedStates[visitedStates.length-1]!==tr.from){
        visitedStates.push(tr.from);
      }
      visitedStates.push(tr.to);
    }
  }

  const uniqueStates=[];
  for(const stId of visitedStates){
    if(uniqueStates.length===0||uniqueStates[uniqueStates.length-1]!==stId){
      uniqueStates.push(stId);
    }
  }

  let xPos=80;
  stateCards=[];
  scenarioToCard={};
  uniqueStates.forEach((stId,cardIdx)=>{
    const st=screenStates.find(s=>s.id===stId);
    if(!st)return;

    const el=document.createElement('div');
    el.className='storyboard-card';
    el.id='storyboard-'+cardIdx;
    el.style.left=xPos+'px';
    el.style.top='80px';

    const stScenario={name:stId,screen:st.screen,...st.componentStates};
    const navHtml=getNavHtml(st.screen);
    el.innerHTML=\`<div class="s-tag">\${getScreenName(st.screen)}</div><div class="s-body"></div>\${navHtml}<div class="storyboard-label"><span class="scenario-name">\${stId}</span><span class="screen-id">\${st.screen}</span></div>\`;
    el.querySelector('.s-body').innerHTML=getScreenHtml(st.screen,stScenario);
    container.appendChild(el);
    stateCards.push({stateKey:stId,screenId:st.screen,scenario:stScenario,scenarios:[stScenario],cardIdx});
    xPos+=300;
  });

  scenarioToCard[scenarioIdx]=0;
  highlightedStoryboardIdx=null;
  drawStoryboardArrows(stateCards,highlightedStoryboardIdx);
}

function highlightGraphPath(scenario){
  if(!hasGraphEntities||!scenario||!scenario.path)return;

  const pathIds=scenario.path.split(',').map(s=>s.trim());
  const pathStates=new Set();
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      pathStates.add(tr.from);
      pathStates.add(tr.to);
    }
  }

  document.querySelectorAll('.graph-node').forEach(el=>{
    const nodeId=el.id.replace('graph-node-','');
    if(pathStates.has(nodeId)){
      el.classList.remove('dimmed');
      el.classList.add('highlighted');
    }else{
      el.classList.add('dimmed');
      el.classList.remove('highlighted');
    }
  });
}

function clearGraphHighlights(){
  document.querySelectorAll('.graph-node').forEach(el=>{
    el.classList.remove('dimmed');
    el.classList.remove('highlighted');
  });
}

function highlightGraphPathInCuj(cujId,scenario){
  if(!hasSeparateCujMaps||!scenario||!scenario.path)return;
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;

  const pathIds=scenario.path.split(',').map(s=>s.trim());
  const pathStates=new Set();
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      pathStates.add(tr.from);
      pathStates.add(tr.to);
    }
  }

  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    const nodeId=el.id.replace('graph-node-','');
    if(pathStates.has(nodeId)){
      el.classList.remove('dimmed');
      el.classList.add('highlighted');
    }else{
      el.classList.add('dimmed');
      el.classList.remove('highlighted');
    }
  });
}

function clearGraphHighlightsInCuj(cujId){
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    el.classList.remove('dimmed');
    el.classList.remove('highlighted');
  });
}

applyTransform();
initSidebar();
initResize();
initWalkResize();

if(hasSeparateCujMaps){
  const firstCujId=Object.keys(cujs)[0];
  if(firstCujId){
    selectCuj(firstCujId);
  }
}else{
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('zoom-fit').click()));
}
window.addEventListener('resize',()=>document.getElementById('zoom-fit').click());`;
}
