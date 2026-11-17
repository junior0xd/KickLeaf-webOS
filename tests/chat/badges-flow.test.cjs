const {installSDK}=require('./helpers/luna.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {Session}=require('../../service/session'),{Protocol}=require('../../service/protocol'),{chromium}=require('@playwright/test');
const BASE=path.resolve(__dirname,'../..'),APP='com.kicktv.alpha';
const identity={color:'#FFAA99',badges:[{type:'moderator',text:'Moderator',unknown:'SYNTHETIC_DISCARD'}],badges_v2:[{name:'level',badge_type:'global',selected:false,sort_order:8,image_url:'https://synthetic.invalid/badge.png',metadata:{level:12,unknown:'SYNTHETIC_DISCARD'}}]};
function publication(id='synthetic-1'){return {event:'App\\Events\\ChatMessageEvent',data:{id,content:'Texto literal <img src=x onerror="window.INJECTED=true">\nSegunda linha.',sender:{username:'SYNTHETIC_AUTHOR',identity},created_at:'2026-01-01T12:00:00Z'}};}
function serviceFixture(initialSubscription=true){
 let sdk,session;const wire=[];
 class FakeService{
  constructor(id){assert.equal(id,APP+'.service');this.methods=new Map();sdk=this;}
  register(name,handler){const e=new EventEmitter();e.handler=handler;this.methods.set(name,e);return e;}
 }
 class LocalSession extends Session{
  start(){this.attempted=true;this.wanted=true;this.state.status='reading';this.timers.delivery=setInterval(()=>this.flushSamples(),100);session=this;return {returnValue:true,snapshot:this.snapshot()};}
 }
 const context={process:{env:{},version:'v16.20.2'},require(name){if(name==='webos-service')return FakeService;if(name==='ws')return function(){throw Error('network_forbidden');};if(name==='ws/package.json')return {version:'8.22.2'};if(name==='./session')return {Session:LocalSession};return name.startsWith('./')?require(path.join(BASE,'service',name)):require(name);}};
 vm.runInNewContext(fs.readFileSync(path.join(BASE,'service/service.js'),'utf8'),context,{filename:'experimental-service.js'});
 function message(payload={},respond=r=>wire.push(JSON.parse(JSON.stringify(r)))){return {sender:APP,payload,isSubscription:true,uniqueToken:'synthetic-consumer',respond};}
 if(initialSubscription)sdk.methods.get('events').emit('request',message({context:'synthetic-context'}));
 return {wire,sdk,get session(){return session;},async start(){sdk.methods.get('start').handler(message({channel:'synthetic_channel',requestId:'synthetic-session'}));for(let i=0;i<10&&!session;i++)await new Promise(r=>setImmediate(r));assert(session);sdk.methods.get('attach').handler(message({requestId:'synthetic-session',context:'synthetic-context',credit:{items:512,bytes:1048576}}));},push(raw){const protocol=new Protocol({send(){throw Error('network_forbidden');},metrics:session.metrics,notify(){},onPublication:v=>session.publication(v),onDisconnect(){throw Error('unexpected_disconnect');}});protocol.subscribed='chatrooms.1.v2';protocol.receive(Buffer.from(JSON.stringify({push:{channel:'chatrooms.1.v2',pub:{data:raw}}})));protocol.close();session.flushSamples();},status(){let response;sdk.methods.get('status').handler(message({},r=>{response=r;}));return JSON.parse(JSON.stringify(response));},async close(){if(session.delivery.consumer&&session.queue.length){session.delivery.flight=null;session.delivery.lastFlush=-Infinity;session.flushSamples();session.ack({identity:session.delivery.identity,ticket:session.delivery.consumer.ticket,seq:session.queue.at(-1).seq,credit:{items:512,bytes:1048576}});}await session.stop('synthetic_finished');sdk.methods.get('events').emit('cancel',{uniqueToken:'synthetic-consumer'});}};
}
test('real protocol → normalizer → Session → Controller → service → Consumers → Luna JSON keeps badgeSet; diagnostics do not retain it',async()=>{
 const t=serviceFixture();await t.start();try{
  t.push(publication());const packet=t.wire.find(r=>r.event?.kind==='delivery');assert(packet);assert.equal(packet.event.session_id,'synthetic-session');
  const sample=JSON.parse(packet.event.delivery.items[0].payload);assert.equal(sample.badgeSet.version,1);assert.equal(sample.badgeSet.legacy.items[0].type,'moderator');assert.equal(sample.badgeSet.v2.items[0].selected,false);assert.equal(sample.badgeSet.v2.items[0].image_url,identity.badges_v2[0].image_url);assert.equal(sample.text,publication().data.content);assert.equal(sample.color,identity.color);assert.equal(sample.timestamp,publication().data.created_at);assert.equal(JSON.stringify(sample).includes('SYNTHETIC_DISCARD'),false);
  t.push(publication());assert.equal(t.session.state.duplicates,1);assert.equal(t.wire.filter(r=>r.event?.kind==='delivery').length,1);
  for(let i=0;i<250;i++)t.push(publication('synthetic-'+(i+2)));assert.equal(t.session.queue.length,251);assert.equal(t.session.ids.size,200);
  const diagnostics=JSON.stringify(t.status());assert(!diagnostics.includes('badge.png'));assert(!diagnostics.includes('SYNTHETIC_AUTHOR'));
 }finally{await t.close();}assert.equal(t.session.queue.length,0);assert.deepEqual(t.session.timers,{});
});
test('webOS consumer accepts actual Luna sample and renders exactly the same DOM and pixels as the old contract, without remote images',async()=>{
 const t=serviceFixture();await t.start();t.push(publication());const sample=JSON.parse(t.wire.find(r=>r.event?.kind==='delivery').event.delivery.items[0].payload);await t.close();
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 async function render(sample){const page=await browser.newPage({viewport:{width:1920,height:1080}}),outbound=[];
  await page.route('**/*',r=>{outbound.push(r.request().url());r.abort();});
  await page.setContent(fs.readFileSync(path.join(BASE,'app/native-hls.html'),'utf8').replace(/<script[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,''));
  for(const name of ['style.css','chat.css'])await page.addStyleTag({path:path.join(BASE,'app',name)});
  await installSDK(page);
  await page.addScriptTag({path:path.join(BASE,'app/chat-ui.js')});
  await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('kicktv-channel-selected',{detail:{channel:'synthetic_channel'}}));KickChatUI.toggle();});
  await page.waitForFunction(()=>fixture.delivery?.consumer);
  await page.evaluate(sample=>fixture.emit('samples',[sample]),sample);
  await page.waitForFunction(()=>document.querySelectorAll('.chat-row').length===1);
  const result=await page.evaluate(()=>({html:document.getElementById('chat-messages').innerHTML,name:getComputedStyle(document.querySelector('.chat-row strong')).fontSize,body:getComputedStyle(document.querySelector('.chat-row')).fontSize,time:document.querySelectorAll('.chat-row time').length,stats:KickChatUI.snapshot(),images:document.querySelectorAll('#chat-messages img').length,injected:!!window.INJECTED,focus:document.activeElement.id}));
  const pixels=await page.screenshot();await page.evaluate(()=>KickChatUI.hide());await page.waitForFunction(()=>KickChatUI.snapshot().queue===0);await page.close();return {result,pixels,outbound};
 }
 try{const old={...sample};delete old.badgeSet;const a=await render(old),b=await render(sample);assert.equal(a.result.html,b.result.html);assert.deepEqual(a.pixels,b.pixels);assert.equal(b.result.name,'18px');assert.equal(b.result.body,'18px');assert.equal(b.result.time,0);assert.equal(b.result.images,0);assert.equal(b.result.injected,false);assert.equal(a.result.focus,b.result.focus);assert(!JSON.stringify(b.result.stats).includes('badge.png'));assert(!JSON.stringify(b.result.stats).includes('badgeSet'));assert.deepEqual(a.outbound,[]);assert.deepEqual(b.outbound,[]);
 }finally{await browser.close();}
});
test('production Luna delivery routes reject another caller, stale session, extra keys and invalid ACK',async()=>{const t=serviceFixture();await t.start();try{
 function call(method,payload,sender=APP){let response;t.sdk.methods.get(method).handler({sender,payload,respond:r=>{response=r;}});return response;}
 assert.equal(call('ack',{},'other.app').errorText,'caller_not_allowed');
 assert.equal(call('ack',{requestId:'old'}).errorText,'stale_session');
 assert.equal(call('attach',{requestId:'synthetic-session',unexpected:true}).errorText,'parameters_not_allowed');
 t.push(publication());const before=t.session.queue.length;
 assert.equal(call('ack',{requestId:'synthetic-session',identity:t.session.delivery.identity,ticket:1,seq:99,credit:{items:512,bytes:1048576}}).accepted,false);
 assert.equal(t.session.queue.length,before);
 }finally{await t.close();}});
test('delayed cancellation of an old Luna handle cannot cancel its same-context replacement',async()=>{const t=serviceFixture();await t.start();try{
 t.push(publication());let subscribed;
 t.sdk.methods.get('events').emit('request',{sender:APP,payload:{context:'synthetic-context',requestId:'synthetic-session'},isSubscription:true,uniqueToken:'replacement',respond:r=>{if(r.subscribed)subscribed=r;}});
 assert.equal(subscribed.returnValue,true);assert.equal(t.session.wanted,false);
 const bound=t.session.attach({context:'synthetic-context',credit:{items:512,bytes:1048576},watermark:0,pending:[1]});assert.equal(bound.ticket,2);
 t.sdk.methods.get('events').emit('cancel',{uniqueToken:'synthetic-consumer'});
 assert.equal(t.status().capabilities.consumers,1);assert.equal(t.session.delivery.consumer.ticket,2);
 t.session.delivery.lastFlush=-Infinity;t.session.flushSamples();t.session.ack({identity:bound.identity,ticket:bound.ticket,seq:1,credit:{items:512,bytes:1048576}});
 await t.session.stopping;assert.equal(t.session.delivery.counts.confirmed,1);assert.equal(t.session.delivery.counts.discarded,0);
 }finally{await t.close();}});
test('real production service routes and browser exchange DOM ACKs through a synthetic Luna bus',async()=>{
 const t=serviceFixture(false),browser=await chromium.launch({headless:true,args:['--no-sandbox']});let timer;
 try{const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  await page.setContent(fs.readFileSync(path.join(BASE,'app/native-hls.html'),'utf8').replace(/<script[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,''));
  await page.exposeFunction('localBus',(method,payload,token)=>new Promise(resolve=>{
   if(method==='cancel'){t.sdk.methods.get('events').emit('cancel',{uniqueToken:token});resolve(null);return;}
   const m={sender:APP,payload,isSubscription:method==='events',uniqueToken:token,respond:r=>{
    const copy=JSON.parse(JSON.stringify(r));if(method==='events'){void page.evaluate(({token,r})=>window.callbacks[token]?.onSuccess(r),{token,r:copy}).catch(()=>{});resolve(null);}else resolve(copy);
   }};
   if(method==='events')t.sdk.methods.get(method).emit('request',m);else t.sdk.methods.get(method).handler(m);
  }));
  await page.addScriptTag({content:`window.callbacks={};let next=0;window.webOS={service:{request(uri,o){const token='local-'+(++next);callbacks[token]=o;localBus(o.method,o.parameters,token).then(r=>{if(r&&callbacks[token])o.onSuccess(r);}).catch(()=>{if(callbacks[token]&&o.onFailure)o.onFailure({returnValue:false});});return {cancel(){delete callbacks[token];if(o.method==='events')void localBus('cancel',{},token);}};}}};`});
  for(const name of ['fifo-common.js','fifo-ui.js','fifo-dom.js','chat-emotes.js','chat-ui.js'])await page.addScriptTag({path:path.join(BASE,'app',name)});
  await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('kicktv-channel-selected',{detail:{channel:'synthetic_channel'}}));KickChatUI.toggle();});
  await page.waitForFunction(()=>KickChatUI.snapshot().state==='Connected'&&KickChatUI.snapshot().delivery?.ticket);
  for(let i=0;i<150;i++){const raw=publication('source-'+i);raw.data.content=i%2?'Unicode 🔥':'plain';t.push(raw);}
  await page.waitForFunction(()=>KickChatUI.snapshot().presented===150);
  assert.equal(t.session.delivery.counts.confirmed,150);assert.equal(t.session.delivery.counts.discarded,0);assert.equal(t.session.queue.length,0);
  assert.deepEqual(await page.locator('.chat-row').evaluateAll(rows=>rows.map(r=>Number(r.dataset.deliverySeq))),Array.from({length:60},(_,i)=>91+i));
  await page.evaluate(()=>KickChatUI.hide());await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');
  assert.equal(t.session.stopped,true);assert.equal(t.session.delivery.counts.confirmed,150);assert.equal(t.session.transport,undefined);assert.deepEqual(t.session.timers,{});
 }finally{clearInterval(timer);if(t.session&&!t.session.stopped)await t.session.stop('test_cleanup',true);await browser.close();}
});
