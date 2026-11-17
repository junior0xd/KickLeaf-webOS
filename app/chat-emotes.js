(function(root){'use strict';
 var CAPACITY=192,REFERENCE_BYTES=600000;
 function parse(text){var parts=[],re=/\[emote:([0-9]{1,15}):([^\]\r\n]{1,80})\]/g,m,last=0;while((m=re.exec(text))){if(m.index>last)parts.push({text:text.slice(last,m.index)});parts.push({id:m[1],name:m[2]});last=re.lastIndex;}if(last<text.length)parts.push({text:text.slice(last)});return parts;}
 function url(id){return typeof id==='string'&&/^[0-9]{1,15}$/.test(id)?'https://files.kick.com/emotes/'+id+'/fullsize':null;}
 function create(doc,env){
  env=env||root;var registry=new Map(),clock=0,observer=null;
  var counts={admissions:0,repeated_urls_logical:0,evicted:0,capacity_fallbacks:0,started:0,loaded:0,failed:0,timeouts:0,cancelled_pending:0,fallbacks:0,dom_images:0,peak_dom_images:0,load_ms_total:0,load_ms_max:0,resource_entries:0,transfer_bytes_exposed:0,encoded_bytes_exposed:0,above_reference:0,opaque_resource_entries:0};
  function resource(e){if(e.initiatorType!=='img'||!/^https:\/\/files\.kick\.com\/emotes\/[0-9]{1,15}\/fullsize$/.test(e.name))return;counts.resource_entries++;if(e.transferSize>0)counts.transfer_bytes_exposed+=e.transferSize;if(e.encodedBodySize>0){counts.encoded_bytes_exposed+=e.encodedBodySize;if(e.encodedBodySize>REFERENCE_BYTES)counts.above_reference++;}else counts.opaque_resource_entries++;}
  try{if(env.PerformanceObserver){observer=new env.PerformanceObserver(function(l){l.getEntries().forEach(resource);});observer.observe({entryTypes:['resource']});}}catch(_){observer=null;}
  function acquire(id){var e=registry.get(id),now=Date.now();if(e){counts.repeated_urls_logical++;}else{
   if(registry.size>=CAPACITY){var victim=null;registry.forEach(function(v){if(!v.refs&&(!v.failedAt||now-v.failedAt>=60000)&&(!victim||v.recent<victim.recent))victim=v;});if(!victim)return null;registry.delete(victim.id);counts.evicted++;}
   e={id:id,url:url(id),state:'pending',refs:0,recent:0,started:0,loaded:0,failedAt:null,width:null,height:null};registry.set(id,e);counts.admissions++;
  }e.refs++;e.recent=++clock;return e;}
  function mount(parent,text){var releases=[];
   parse(text).forEach(function(p){if(!p.id){parent.appendChild(doc.createTextNode(p.text));return;}
    var e=acquire(p.id),fallback='[emote:'+p.name+']';
    if(!e){counts.capacity_fallbacks++;counts.fallbacks++;parent.appendChild(doc.createTextNode(fallback));return;}
    if(e.state==='failed'||e.state==='unavailable'){counts.fallbacks++;parent.appendChild(doc.createTextNode(fallback));releases.push(function(){e.refs--;e.recent=++clock;});return;}
    var box=doc.createElement('span'),img=doc.createElement('img'),done=false,released=false,timer,start=env.performance.now();box.className='chat-emote';img.alt=fallback;img.width=28;img.height=28;box.appendChild(img);parent.appendChild(box);
    counts.started++;e.started++;e.state='loading';counts.dom_images++;counts.peak_dom_images=Math.max(counts.peak_dom_images,counts.dom_images);
    function detach(){env.clearTimeout(timer);img.onload=null;img.onerror=null;}
    function finish(ok,reason){if(done||released)return;done=true;detach();var ms=env.performance.now()-start;counts.load_ms_total+=ms;counts.load_ms_max=Math.max(counts.load_ms_max,ms);
     if(ok){counts.loaded++;e.loaded++;if(!e.failedAt)e.state='loaded';e.width=img.naturalWidth;e.height=img.naturalHeight;}
     else{counts.failed++;if(reason==='timeout')counts.timeouts++;e.state='failed';e.failedAt=Date.now();counts.fallbacks++;counts.dom_images--;box.className='chat-emote-fallback';box.textContent=fallback;img.removeAttribute('src');}
    }
    img.onload=function(){finish(img.naturalWidth>0,'decode_or_generic');};img.onerror=function(){finish(false,'generic');};timer=env.setTimeout(function(){finish(false,'timeout');},15000);img.src=e.url;
    releases.push(function(){if(released)return;released=true;detach();if(!done){counts.cancelled_pending++;if(!e.failedAt)e.state=e.loaded?'loaded':'pending';}if(img.parentNode===box){counts.dom_images--;img.removeAttribute('src');}e.refs--;e.recent=++clock;});
   });var released=false;return function(){if(released)return;released=true;releases.forEach(function(f){f();});releases=[];};
  }
  function snapshot(){var active=0,refs=0,states={},entries=[];registry.forEach(function(e){if(e.refs)active++;refs+=e.refs;states[e.state]=(states[e.state]||0)+1;entries.push({id:e.id,state:e.state,refs:e.refs,width:e.width,height:e.height});});return {capacity:CAPACITY,reference_bytes:REFERENCE_BYTES,known_ids:registry.size,active_ids:active,active_references:refs,states:states,counts:Object.assign({},counts),entries:entries,resource_observer:!!observer,format:'unavailable_from_img',transfer_note:'Positive ResourceTiming values only; zero may be opaque. Logical repetition is not an HTTP cache hit. Admissions may include re-admitted IDs.'};}
  return {mount:mount,snapshot:snapshot,destroy:function(){if(observer)observer.disconnect();observer=null;registry.forEach(function(e){if(!e.refs)registry.delete(e.id);});}};
 }
 var api={parse:parse,url:url,create:create};if(typeof module==='object'&&module.exports)module.exports=api;else root.KickEmotes=create(root.document,root);
}(typeof window==='object'?window:globalThis));
