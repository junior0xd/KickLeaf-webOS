'use strict';

const { writeFile } = require('node:fs/promises');
const path = require('node:path');

async function graphs(folder, analysis, elapsed, screenshots = []) {
  const { plotted, rates, incidents } = analysis;
  const panels = [
    ['Buffer à frente', 's', plotted.buffer_s], ['Cadência rAF', 'FPS', plotted.raf_fps],
    ['Fila do serviço de chat', 'itens', plotted.fifo_items],
    ['Fila da interface do chat', 'itens', plotted.ui_fifo_items],
    ['Confirmações entre leituras', '/s', rates.map(r => ({ ms: r.end_ms, value: r.values.confirmed }))],
    ['Heap JavaScript', 'MiB', plotted.heap_js_mib], ['RSS do serviço', 'MiB', plotted.rss_node_mib],
    ['Elementos no DOM', 'elementos', plotted.dom_elements],
    ['Tempo de resposta do Inspector', 'ms', plotted.inspector_ms]
  ];
  const plotData = JSON.stringify({
    elapsed, panels,
    screenshots: screenshots.filter(event => /^screenshots\/\d+-\d+\.jpg$/.test(event.file) &&
      Number.isFinite(event.elapsed_ms) && event.elapsed_ms >= 0)
      .map(event => ({ file: event.file, ms: event.elapsed_ms, triggers: event.triggers })),
    incidents: incidents.map(({ kind, timestamp_ms }) => ({ kind, timestamp_ms }))
  }).replace(/</g, '\\u003c');
  await writeFile(path.join(folder, 'graficos.html'), `<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>KickTV · Telemetria</title>
<style>
body{font:16px system-ui;max-width:1050px;margin:2rem auto;padding:0 1rem;color:#182523;background:#f3f6f4}
h1{margin-bottom:.4rem} section{background:#fff;border:1px solid #ccd8d4;margin:.6rem 0;padding:.65rem 1rem}
h2{font-size:1rem;margin:.2rem 0} svg{width:100%;height:96px;display:block}
input{width:100%}small{color:#4a625b}#cursor{font-variant-numeric:tabular-nums}
#captures{margin-top:1.25rem}#capture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.8rem}
#capture-grid figure{margin:0;min-width:0}#capture-grid img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#182523}
#capture-grid figcaption{display:grid;gap:.2rem}#capture-grid button{justify-self:start}
</style>
<h1>Telemetria KickTV</h1><p>As séries compartilham o tempo decorrido. Lacunas representam leituras ausentes.</p>
<label for="time">Posição <output id="cursor"></output></label><input id="time" type="range" min="0" step="1" value="0">
<p id="nearby"></p><a id="capture-link" href="#captures" hidden>Ir para as capturas</a><main id="charts"></main>
<section id="captures" aria-labelledby="capture-title" hidden><h2 id="capture-title">Capturas</h2><div id="capture-grid"></div></section>
<script type="application/json" id="data">${plotData}</script>
<script>
const {elapsed,panels,incidents,screenshots}=JSON.parse(document.getElementById('data').textContent);
const slider=document.getElementById('time'), fragment=document.getElementById('charts');
const duration=screenshots.reduce((max, shot)=>Math.max(max,shot.ms),Math.max(1,elapsed||0)), ns='http://www.w3.org/2000/svg';
slider.max=duration;
const x=ms=>Math.min(1000,Math.max(0,ms/duration*1000));
function element(tag,attrs){const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el}
const views=panels.map(([label,unit,points])=>{
 const section=document.createElement('section'), title=document.createElement('h2'), legend=document.createElement('small');
 title.textContent=label;section.append(title,legend);fragment.append(section);
 const values=points.filter(p=>Number.isFinite(p.value));
 if(!values.length){legend.textContent='Indisponível';return null}
 const max=values.reduce((n,p)=>Math.max(n,p.value),0)||1;
 const svg=element('svg',{viewBox:'0 0 1000 96',preserveAspectRatio:'none',role:'img','aria-label':label});
 let d='',connected=false;
 for(const p of points){if(!Number.isFinite(p.value)){connected=false;continue}
  d+=(connected?'L':'M')+x(p.ms)+' '+(90-84*p.value/max)+' ';connected=true;
 }
 svg.append(element('line',{x1:0,x2:1000,y1:90,y2:90,stroke:'#d7e2dd'}),
   element('path',{d,fill:'none',stroke:'#087969','stroke-width':2}));
 const cursor=element('line',{y1:0,y2:96,stroke:'#a24629','stroke-width':2});svg.append(cursor);section.append(svg);
 svg.addEventListener('click',event=>{slider.value=Math.round((event.clientX-svg.getBoundingClientRect().left)/svg.clientWidth*duration);update()});
 return {cursor,legend,unit,max,points};
}).filter(Boolean);
function update(){
 const time=Number(slider.value), position=x(time);
 document.getElementById('cursor').textContent=(time/1000).toFixed(1)+' s';
 for(const view of views){
  view.cursor.setAttribute('x1',position);view.cursor.setAttribute('x2',position);
  const sample=view.points.reduce((best,p)=>!best||Math.abs(p.ms-time)<Math.abs(best.ms-time)?p:best,null);
  view.legend.textContent='Escala máximo '+view.max.toFixed(2)+' '+view.unit+
   (Number.isFinite(sample?.value)?' · amostra em '+(sample.ms/1000).toFixed(1)+' s: '+sample.value.toFixed(2)+' '+view.unit:' · amostra indisponível');
 }
 document.getElementById('nearby').textContent=incidents.filter(i=>Math.abs(i.timestamp_ms-time)<=2000).map(i=>i.kind).join(' · ');
}
if(screenshots.length){
 document.getElementById('capture-link').hidden=false;
 document.getElementById('captures').hidden=false;
 const grid=document.getElementById('capture-grid');
 for(const shot of screenshots){
  const figure=document.createElement('figure'), link=document.createElement('a'), img=document.createElement('img');
  const caption=document.createElement('figcaption'), trigger=document.createElement('small'), jump=document.createElement('button');
  const timestamp=(shot.ms/1000).toFixed(1)+' s';
  link.href=shot.file;link.target='_blank';link.rel='noopener';
  img.src=shot.file;img.loading='lazy';img.alt='Abrir captura em '+timestamp;
  link.append(img);
  trigger.textContent=Array.isArray(shot.triggers)?shot.triggers.join(' · '):'';
  jump.type='button';jump.textContent='Ver nos gráficos · '+timestamp;
  jump.addEventListener('click',()=>{slider.value=Math.round(shot.ms);update();slider.focus();});
  caption.append(jump,trigger);figure.append(link,caption);grid.append(figure);
 }
}
slider.addEventListener('input',update);update();
</script></html>`);
}

module.exports = { graphs };
