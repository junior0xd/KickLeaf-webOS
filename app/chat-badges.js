(function(){'use strict';
 var catalog=Object.freeze({"moderator":"ModeratorBadge","subscriber":"SubscriberBadge","vip":"VIPBadge","og":"OGBadge","verified":"VerifiedBadge","bot":"BotBadge","sub_gifter":"SubGifterBadge","broadcaster":"HostBadge","founder":"FounderBadge","staff":"StaffBadge","sidekick":"SidekickBadge","chat_identity":"IdentityBadge","trainwreckstv":"TrainwreckstvBadge"});
 var giftThresholds=[1,5,10,25,50,100,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000,2000,3000,4000,5000];
 function giftIcon(count){var n=Number.isSafeInteger(count)&&count>0?count:1;for(var i=giftThresholds.length-1;i>=0;i--)if(n>=giftThresholds[i])return "Gift"+giftThresholds[i];return "Gift1";}
 var cache=new Map(),pending=[],controllers=new Set(),active=0,generation=0,bytes=0;
 var counters={messages:0,with_badges:0,legacy:0,v2_items:0,v2_selected:0,rendered:0,legacy_rendered:0,v2_slots:0,image_slots_loaded:0,local_v2_rendered:0,over_four:0,truncated_legacy:0,truncated_v2:0,invalid_contract:0,unknown_unavailable:0,unknown_overflow:0,invalid_url:0,requests:0,cache_hits:0,failures:0,budget_rejected:0,aborted:0,active_peak:0,load_ms_total:0,load_ms_max:0,bytes:0};
 var distribution=Object.create(null),legacyDistribution=Object.create(null),v2Distribution=Object.create(null),selectedDistribution=Object.create(null),known=Object.create(null),unknown=Object.create(null);
 function inc(map,key){map[key]=(map[key]||0)+1;}
 function validURL(s){
  if(typeof s!=='string'||s.length>1024||!/^[\x21-\x7e]+$/.test(s)||/[\\?#]/.test(s))return false;
  try{var u=new URL(s);return u.protocol==='https:'&&['files.kick.com','ext.cdn.kick.com'].indexOf(u.hostname)!==-1&&!u.port&&!u.username&&!u.password&&!s.split('/')[2].includes('@');}catch(_){return false;}
 }
 function unknownType(m,item){
  var earlier=m.badgeSet.legacy.items.filter(function(x){return x.index<item.index&&x.index<8;}).length;
  var raw=item.index<8&&Array.isArray(m.badges)&&m.badges[earlier];
  var key=raw&&raw.type;
  if(typeof key==='string'&&/^[a-zA-Z0-9_-]{1,32}$/.test(key)){if(Object.prototype.hasOwnProperty.call(unknown,key)||Object.keys(unknown).length<16)inc(unknown,key);else counters.unknown_overflow++;}
  else counters.unknown_unavailable++;
 }
 function select(m){
  counters.messages++;var b=m.badgeSet,out=[];
  if(!b)return out;
  if(b.version!==1||!b.legacy||!b.v2||!Array.isArray(b.legacy.items)||!Array.isArray(b.v2.items)){counters.invalid_contract++;return out;}
  if(b.legacy.truncated)counters.truncated_legacy++;if(b.v2.truncated)counters.truncated_v2++;
  var legacy=b.legacy.items.slice(0,8),v2=b.v2.items.slice(0,8),count=0;
  counters.legacy+=legacy.length;counters.v2_items+=v2.length;inc(legacyDistribution,legacy.length);inc(v2Distribution,v2.length);
  legacy.forEach(function(x){if(!x||!x.fields)return;
   if(x.fields.type==='known'&&typeof x.type==='string'&&Object.prototype.hasOwnProperty.call(catalog,x.type)){inc(known,x.type);out.push({kind:'legacy',icon:x.type==='sub_gifter'?giftIcon(x.fields.count==='valid'?x.count:1):catalog[x.type],label:'KickLeaf: '+x.type});}
   else if(x.fields.type==='unknown'){unknownType(m,x);out.push({kind:'legacy',icon:'question',label:'KickLeaf: distintivo desconhecido'});}
  });
  v2.forEach(function(x){if(x&&x.selected===true){count++;var level=x.metadata&&x.metadata.level;if(x.name==='level'&&x.fields&&x.fields.level==='valid'&&Number.isSafeInteger(level)&&level>=1&&level<=99)out.push({kind:'v2-local',icon:'Level'+level,label:'Nível '+level});else out.push({kind:'v2',url:x.image_url,label:'Distintivo selecionado'});}});
  counters.v2_selected+=count;inc(selectedDistribution,count);inc(distribution,out.length);if(out.length)counters.with_badges++;if(out.length>4)counters.over_four++;return out;
 }
 // Stable SHA-256/16 URL identifier; same UTF-8 hash as the host's historical collector.
 function urlID(value){
  if(typeof value!=='string'||value.length>1024)return null;
  var raw=new TextEncoder().encode(value),n=raw.length,data=new Uint8Array(((n+9+63)>>6)<<6);data.set(raw);data[n]=128;var view=new DataView(data.buffer);view.setUint32(data.length-4,n*8);
  var k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Int32Array(64);function r(x,n){return (x>>>n)|(x<<(32-n));}
  for(var offset=0;offset<data.length;offset+=64){for(var i=0;i<64;i++){if(i<16)w[i]=view.getInt32(offset+i*4);else{var x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))|0;}}
   var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],j=h[7];
   for(i=0;i<64;i++){var t1=(j+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;j=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
   [a,b,c,d,e,f,g,j].forEach(function(v,i){h[i]=(h[i]+v)|0;});
  }return h.slice(0,2).map(function(x){return (x>>>0).toString(16).padStart(8,'0');}).join('');
 }
 var diagnosticSequence=0,diagnosticCounts=Object.create(null),diagnosticEvents=[],outcomes=Object.create(null),objectURLs=new Set(),timerCount=0,slots=new Set();
 function timer(fn,ms){timerCount++;var live=true,t=setTimeout(function(){if(live){live=false;timerCount--;fn();}},ms);return function(){if(live){live=false;timerCount--;clearTimeout(t);}};}
 function report(task,code,expected){
  inc(diagnosticCounts,code);var event={sequence:++diagnosticSequence,at:Date.now(),url_id:task.id,original_url:task.safeOriginal||null,transport_url:task.safeTransport||null,transport_policy:task.transport?(task.limit===65536?'cdn_72':'original'):null,limit_bytes:task.limit||null,declared_mime:task.mime||null,identified_format:task.format||null,code:code,stage:task.stage,duration_ms:Math.max(0,performance.now()-task.started),bytes_known:task.total||0,http_status:task.status===undefined?null:task.status,request_state:task.requestState||'not_started',expected:!!expected,decoded_width:task.width||null,decoded_height:task.height||null};
  diagnosticEvents.push(event);if(diagnosticEvents.length>256)diagnosticEvents.shift();return event;
 }
 function setOutcome(task,code,expected){var cached=cache.get(task.url);if(cached)cached.settled=true;if(!Object.prototype.hasOwnProperty.call(outcomes,task.id)&&Object.keys(outcomes).length>=64)delete outcomes[Object.keys(outcomes)[0]];outcomes[task.id]=report(task,code,expected);}
 function revoke(url){if(url&&objectURLs.delete(url))URL.revokeObjectURL(url);}
 function pump(){while(active<2&&pending.length){var task=pending.shift();if(task.generation!==generation){report(task,'cleanup_cancelled',true);task.resolve(null);continue;}active++;counters.active_peak=Math.max(counters.active_peak,active);load(task).finally(function(){active--;pump();});}}
 async function load(task){
  var controller=new AbortController(),objectURL=null,reader=null,cancelTimer=null,response=null;controllers.add(controller);task.controller=controller;task.stage='fetch';task.requestState='pending';counters.requests++;
  cancelTimer=timer(function(){task.timeout=true;controller.abort();},8000);
  function fail(code){var e=Error(code);e.diagnosticCode=code;throw e;}
  try{
   // Manual exposes an opaque redirect for diagnosis; it never follows the redirect.
   response=await fetch(task.transport,{mode:'cors',credentials:'omit',redirect:'manual',referrerPolicy:'no-referrer',signal:controller.signal});task.status=response.status;task.requestState='headers_received';
   if(response.type==='opaqueredirect'||response.redirected||[301,302,303,307,308].indexOf(response.status)!==-1)fail('redirect_rejected');
   if(!response.ok)fail('http_rejected');
   task.stage='mime';var mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'].indexOf(mime)===-1)fail('mime_rejected');
   task.mime=mime;task.stage='body';if(!response.body||!response.body.getReader)fail('body_reader_unavailable');reader=response.body.getReader();task.requestState='reading';var chunks=[];
   for(;;){var part=await reader.read();if(part.done)break;task.total+=part.value.byteLength;if(task.total>task.limit)fail('body_too_large');if(bytes+task.total>2097152)fail('session_body_budget');chunks.push(part.value);}
   task.requestState='body_complete';cancelTimer();cancelTimer=null;
   if(task.generation!==generation)fail('cleanup_cancelled');
   task.stage='blob';var blob=new Blob(chunks,{type:mime});if(!blob.size||blob.size!==task.total)fail('blob_invalid');
   task.stage='format';var sig=new Uint8Array(await blob.slice(0,32).arrayBuffer());
   function ascii(start,end){return String.fromCharCode.apply(null,Array.from(sig.slice(start,end)));}
   task.format=sig.length>=8&&Array.from(sig.slice(0,8)).join(',')==='137,80,78,71,13,10,26,10'?'png':sig[0]===255&&sig[1]===216&&sig[2]===255?'jpeg':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'webp':/^GIF8[79]a$/.test(ascii(0,6))?'gif':null;
   if(mime==='image/svg+xml'){var svg=await blob.text();if(/<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon\w+\s*=|(?:href|url)\s*[=(]/i.test(svg))fail('svg_policy_rejected');if(/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(svg))task.format='svg';}
   if(!task.format||mime!==({'png':'image/png','jpeg':'image/jpeg','webp':'image/webp','gif':'image/gif','svg':'image/svg+xml'})[task.format])fail('content_format_rejected');
   bytes+=task.total;counters.bytes+=task.total;objectURL=URL.createObjectURL(blob);objectURLs.add(objectURL);
   task.stage='decode';await new Promise(function(resolve,reject){var image=new Image(),settled=false;
    function finish(code){if(settled)return;settled=true;stopTimer();controller.signal.removeEventListener('abort',onAbort);image.onload=null;image.onerror=null;if(code){image.src='';var e=Error(code);e.diagnosticCode=code;reject(e);}else resolve();}
    function onAbort(){finish(task.generation!==generation?'cleanup_cancelled':'network_cancelled');}
    var stopTimer=timer(function(){finish('decode_timeout');},2000);controller.signal.addEventListener('abort',onAbort);
    image.onload=function(){task.width=image.naturalWidth;task.height=image.naturalHeight;finish(task.width>0&&task.height>0&&task.width<=512&&task.height<=512?null:'dimensions_invalid');};image.onerror=function(){finish('decode_failed');};image.src=objectURL;
   });
   if(task.generation!==generation)fail('cleanup_cancelled');
   task.stage='cache';var entry=cache.get(task.url);if(!entry)fail('cleanup_cancelled');entry.objectURL=objectURL;var elapsed=performance.now()-task.started;counters.load_ms_total+=elapsed;counters.load_ms_max=Math.max(counters.load_ms_max,elapsed);
   task.requestState='usable';setOutcome(task,'image_usable',false);task.resolve(objectURL);objectURL=null;
  }catch(error){
   var code=task.generation!==generation?'cleanup_cancelled':task.timeout?'fetch_timeout':error.diagnosticCode||(controller.signal.aborted||error.name==='AbortError'?'network_cancelled':task.stage==='body'?'body_read_failed':task.stage==='blob'?'blob_invalid':'network_or_cors_failed');
   var expected=code==='cleanup_cancelled';if(expected)counters.aborted++;else counters.failures++;setOutcome(task,code,expected);task.resolve(null);
  }finally{
   // Stop unread responses on every policy/error path, not just on the byte limit.
   if(reader){try{await reader.cancel();}catch(_){}try{reader.releaseLock();}catch(_){}}
   else if(response&&response.body){try{await response.body.cancel();}catch(_){}}
   controller.abort();if(cancelTimer)cancelTimer();revoke(objectURL);controllers.delete(controller);
  }
 }
 function imageURL(url){
  var base={id:urlID(url),stage:'validation',started:performance.now(),total:0};
  if(!validURL(url)){counters.invalid_url++;report(base,'url_rejected',false);return Promise.resolve(null);}
  base.transport=CdnBadgeURL.resolve(url);base.limit=base.transport===url?131072:65536;var parsed=new URL(url);base.safeOriginal=parsed.origin+(base.limit===65536?'/chat/badges/<'+base.id+'>.png':'/<'+base.id+'>');base.safeTransport=base.safeOriginal+(base.limit===65536?'?width=72,format=webp,quality=50':'');
  if(cache.has(url)){counters.cache_hits++;if(!cache.get(url).settled)counters.promise_deduplicated=(counters.promise_deduplicated||0)+1;return cache.get(url).promise;}
  if(cache.size>=64||bytes>=2097152){counters.budget_rejected++;report(base,cache.size>=64?'cache_capacity':'session_body_budget',false);return Promise.resolve(null);}
  var resolve,promise=new Promise(function(r){resolve=r;});cache.set(url,{promise:promise,objectURL:null});pending.push(Object.assign(base,{url:url,resolve:resolve,generation:generation,stage:'queue'}));pump();return promise;
 }
 function fallback(img){img.onload=null;img.onerror=null;img.className='chat-badge chat-badge-local chat-badge-fallback';img.src='badge-icons/question.svg';}
 const cssIcons = new Set();
 const remoteClasses = new Map();
 let cssRules, remoteStyle;
 let effectiveLocal = 0, effectiveRemote = 0;
 function createStyle() {
  const style = document.createElement('style');
  document.head.appendChild(style);
  return style;
 }
 function mountCssTile(parent, item, icon) {
  const className = 'chat-badge-icon-' + icon;
  if (!cssRules) cssRules = createStyle().sheet;
  if (!cssIcons.has(icon)) {
   cssRules.insertRule('.' + className + '{background-image:url("badge-icons/' + icon + '.svg")}', cssRules.cssRules.length);
   cssIcons.add(icon);
  }
  const badge = document.createElement('span');
  badge.className = 'chat-badge chat-badge-local chat-badge-css ' + className + (icon === 'question' ? ' chat-badge-fallback' : '');
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', item.label);
  badge.title = item.label;
  parent.appendChild(badge);
  return badge;
 }
 function mountLocalCss(parent, item) {
  mountCssTile(parent, item, item.icon || 'question');
  counters.rendered++;
  if (item.kind === 'legacy') counters.legacy_rendered++;
  else counters.local_v2_rendered++;
 }
 function mountRemoteCss(parent, item) {
  const badge = mountCssTile(parent, item, 'question');
  counters.rendered++;
  counters.v2_slots++;
  const ticket = generation;
  imageURL(item.url).then(url => {
   if (!url || ticket !== generation || !badge.isConnected) return;
   let className = remoteClasses.get(url);
   if (!className) {
    if (!remoteStyle) remoteStyle = createStyle();
    const sheet = remoteStyle.sheet;
    className = 'chat-badge-remote-' + sheet.cssRules.length;
    sheet.insertRule('.' + className + '{background-image:url("' + url + '")}', sheet.cssRules.length);
    remoteClasses.set(url, className);
   }
   badge.className = 'chat-badge chat-badge-css ' + className;
   effectiveRemote++;
  });
 }
 function mount(parent,items,mode){
  let local = 0;
  items.forEach(function(item){
   const isLocal = item.kind==='legacy'||item.kind==='v2-local';
   if(isLocal&&item.icon&&item.icon!=='question')local++;
   if(mode==='css'){
    if(isLocal)mountLocalCss(parent,item);
    else mountRemoteCss(parent,item);
    return;
   }
   var img=document.createElement('img');img.className='chat-badge chat-badge-local'+(!item.icon||item.icon==='question'?' chat-badge-fallback':'');img.width=20;img.height=20;img.alt=item.label;img.title=item.label;img.src='badge-icons/'+(item.icon||'question')+'.svg';parent.appendChild(img);counters.rendered++;
   if(item.kind==='legacy'){counters.legacy_rendered++;return;}if(item.kind==='v2-local'){counters.local_v2_rendered++;return;}counters.v2_slots++;var ticket=generation,slot={id:urlID(item.url),stage:'association',started:performance.now(),total:0,requestState:'awaiting_shared_image',settled:false,img:img,cancelTimer:null};slots.add(slot);
   function finish(code,expected){if(slot.settled)return;slot.settled=true;if(slot.cancelTimer)slot.cancelTimer();slots.delete(slot);img.onload=null;img.onerror=null;if(code)report(slot,code,expected);}
   slot.cancel=function(){finish('cleanup_cancelled',true);};
   imageURL(item.url).then(function(url){
    if(slot.settled)return;if(ticket!==generation){finish('cleanup_cancelled',true);return;}if(!img.isConnected){finish('row_removed',true);return;}
    if(!url){finish(null,false);return;}
    slot.requestState='binding';img.className='chat-badge';slot.cancelTimer=timer(function(){finish(ticket!==generation?'cleanup_cancelled':!img.isConnected?'row_removed':'association_timeout',ticket!==generation||!img.isConnected);fallback(img);},2000);
    img.onload=function(){if(!img.isConnected){finish('row_removed',true);return;}if(ticket!==generation){finish('cleanup_cancelled',true);return;}if(img.naturalWidth>0){counters.image_slots_loaded++;effectiveRemote++;finish('element_loaded',false);}else{finish('association_failed',false);fallback(img);}};
    img.onerror=function(){finish('association_failed',false);fallback(img);};img.src=url;
   });
  });
  return local;
 }
 function clear(){generation++;remoteStyle?.remove();remoteStyle=null;remoteClasses.clear();slots.forEach(function(s){s.cancel();});controllers.forEach(function(c){c.abort();});pending.splice(0).forEach(function(t){report(t,'cleanup_cancelled',true);t.resolve(null);});cache.forEach(function(e){revoke(e.objectURL);});cache.clear();bytes=0;}
 window.KickBadges={select:select,mount:mount,clear:clear,noteLocal:function(count){effectiveLocal+=count;},snapshot:function(){return {diagnostics:{sequence:diagnosticSequence,counts:Object.assign({},diagnosticCounts),events:diagnosticEvents.slice(),outcomes:Object.assign({},outcomes)},resources:{object_urls:objectURLs.size,timers:timerCount,slots:slots.size},counts:Object.assign({},counters,{effective_local:effectiveLocal,effective_remote:effectiveRemote}),distribution:Object.assign({},distribution),legacy_distribution:Object.assign({},legacyDistribution),v2_distribution:Object.assign({},v2Distribution),selected_distribution:Object.assign({},selectedDistribution),known:Object.assign({},known),unknown:Object.assign({},unknown),cache_entries:cache.size,cache_bytes:bytes,active:active,pending:pending.length,controllers:controllers.size};}};
})();
