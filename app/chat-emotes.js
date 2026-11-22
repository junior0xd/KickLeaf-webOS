(function(root){'use strict';
 const CAPACITY=192,TIMEOUT_MS=15000;
 function parse(text){var parts=[],re=/\[emote:([0-9]{1,15}):([^\]\r\n]{1,80})\]/g,m,last=0;while((m=re.exec(text))){if(m.index>last)parts.push({text:text.slice(last,m.index)});parts.push({id:m[1],name:m[2]});last=re.lastIndex;}if(last<text.length)parts.push({text:text.slice(last)});return parts;}
 function url(id){return typeof id==='string'&&/^[0-9]{1,15}$/.test(id)?'https://files.kick.com/emotes/'+id+'/fullsize':null;}
 function createLazyCss(doc,env){
  const entries=new Map(),queued=new Set(),updates=new Set();
  const counts={lazy_css_loads:0,lazy_css_ready:0,lazy_css_failed:0,lazy_css_evicted:0,
   lazy_css_capacity_fallbacks:0,lazy_css_latency_ms_total:0,lazy_css_latency_ms_max:0,
   lazy_css_peak_dom_emotes:0};
  const maxConcurrent=2,updatesPerTask=16,retryAfterMs=60000;
  let timer=null,inFlight=0,visible=0;

  function render(tile,id){
   tile.setAttribute('role','img');
   tile.setAttribute('aria-label',tile.textContent);
   tile.textContent='';
   tile.className='chat-emote chat-emote-lazy-css chat-emote-lazy-css-'+id;
   counts.lazy_css_peak_dom_emotes=Math.max(counts.lazy_css_peak_dom_emotes,++visible);
  }
  function schedule(){
   if(timer!==null||(!updates.size&&(!queued.size||inFlight>=maxConcurrent)))return;
   timer=env.setTimeout(run,16);
  }
  function run(){
   timer=null;
   let remaining=updatesPerTask;
   for(const entry of updates){
    for(const tile of entry.waiting){
     if(!remaining)break;
     entry.waiting.delete(tile);
     render(tile,entry.id);
     remaining--;
    }
    if(!entry.waiting.size)updates.delete(entry);
    if(!remaining)break;
   }
   for(const entry of queued){
    if(inFlight>=maxConcurrent)break;
    queued.delete(entry);
    load(entry);
   }
   schedule();
  }
  function load(entry){
   inFlight++;
   counts.lazy_css_loads++;
   entry.state='loading';
   const image=doc.createElement('img');
   function finish(ok){
    detach();
    if(ok){
     entry.state='ready';
     entry.rule=doc.createElement('style');
     entry.rule.textContent='.chat-emote-lazy-css-'+entry.id+'{background-image:url("'+entry.source+'")}';
     doc.head.appendChild(entry.rule);
     counts.lazy_css_ready++;
     const latency=env.performance.now()-entry.queuedAt;
     counts.lazy_css_latency_ms_total+=latency;
     counts.lazy_css_latency_ms_max=Math.max(counts.lazy_css_latency_ms_max,latency);
     if(entry.waiting.size)updates.add(entry);
    }else{
     entry.failedAt=env.performance.now();
     entry.state='failed';
     entry.waiting.clear();
     counts.lazy_css_failed++;
    }
    schedule();
   }
   function detach(){
    env.clearTimeout(timeout);
    image.onload=null;image.onerror=null;
    image.removeAttribute('src');
    entry.cancel=null;
    inFlight--;
   }
   const timeout=env.setTimeout(()=>finish(false),TIMEOUT_MS);
   entry.cancel=detach;
   image.referrerPolicy='no-referrer';
   image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0&&
    image.naturalWidth<=1024&&image.naturalHeight<=1024);
   image.onerror=()=>finish(false);
   image.src=entry.source;
  }
  function mount(parent,id,fallback){
   let entry=entries.get(id);
   const now=env.performance.now();
   if(entry?.state==='failed'&&now-entry.failedAt>=retryAfterMs){
    entries.delete(id);
    entry=null;
   }
   if(!entry){
    if(entries.size>=CAPACITY){
     for(const [key,candidate] of entries){
      if(candidate.refs||candidate.state==='loading')continue;
      if(candidate.state==='failed'&&now-candidate.failedAt<retryAfterMs)continue;
      entries.delete(key);
      queued.delete(candidate);
      updates.delete(candidate);
      candidate.rule?.remove();
      counts.lazy_css_evicted++;
      break;
     }
    }
    if(entries.size>=CAPACITY){
     counts.lazy_css_capacity_fallbacks++;
     parent.appendChild(doc.createTextNode(fallback));
     return null;
    }
    const source=url(id);
    if(!source){parent.appendChild(doc.createTextNode(fallback));return null;}
    entry={id,source,refs:0,state:'queued',queuedAt:now,waiting:new Set()};
    queued.add(entry);
    schedule();
   }
   entries.delete(id);
   entries.set(id,entry);
   if(entry.state==='failed'){parent.appendChild(doc.createTextNode(fallback));return null;}
   const tile=doc.createElement('span');
   tile.textContent=fallback;
   if(entry.state==='ready')render(tile,id);
   else entry.waiting.add(tile);
   entry.refs++;
   parent.appendChild(tile);
   return ()=>{
    entry.refs--;
    entry.waiting.delete(tile);
    if(tile.classList.contains('chat-emote-lazy-css'))visible--;
    if(entry.state==='queued'&&!entry.refs){
     queued.delete(entry);
     entries.delete(id);
    }
   };
  }
  function destroy(){
   env.clearTimeout(timer);timer=null;
   for(const entry of entries.values()){
    entry.cancel?.();
    entry.rule?.remove();
   }
   entries.clear();queued.clear();updates.clear();
  }
  return {mount,destroy,snapshot:()=>({...counts,lazy_css_ids:entries.size,lazy_css_in_flight:inFlight,lazy_css_dom_emotes:visible})};
 }
 function create(doc,env=root){
  const images=createLazyCss(doc,env);
  function mount(parent,text){
   const releases=[];
   for(const part of parse(text)){
    if(!part.id){parent.appendChild(doc.createTextNode(part.text));continue;}
    const release=images.mount(parent,part.id,'[emote:'+part.name+']');
    if(release)releases.push(release);
   }
   return ()=>{for(const release of releases.splice(0))release();};
  }
  function snapshot(){
   const counts=images.snapshot();
   return {counts,known_ids:counts.lazy_css_ids};
  }
  return {mount,snapshot,destroy:images.destroy};
 }
 var api={parse:parse,url:url,create:create};if(typeof module==='object'&&module.exports)module.exports=api;else root.KickEmotes=create(root.document,root);
}(typeof window==='object'?window:globalThis));
