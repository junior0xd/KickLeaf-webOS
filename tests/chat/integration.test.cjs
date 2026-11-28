const {installSDK}=require('./helpers/luna.cjs');
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('@playwright/test');const fs=require('node:fs'),path=require('node:path');
const BASE=path.resolve(__dirname,'../..');let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:['--no-sandbox']});});after(async()=>browser.close());
async function setup({streamInfo = {}, width = 1920, height = 1080} = {}){
 const page=await browser.newPage({viewport:{width,height}}),outbound=[];await page.route('**/*',r=>{outbound.push(r.request().url());r.abort();});
 await page.setContent(fs.readFileSync(path.join(BASE,'app/native-hls.html'),'utf8').replace(/<script[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,''));
 for(const name of ['oled-tokens.css','style.css','chat.css','native-playback.css','discovery-home.css'])await page.addStyleTag({path:path.join(BASE,'app',name)});
 await page.addScriptTag({content:`(()=>{
  HTMLMediaElement.prototype.load=function(){this.loads=(this.loads||0)+1;};HTMLMediaElement.prototype.pause=function(){this.testPaused=true;this.dispatchEvent(new Event('pause'));};Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this.testPaused!==false;}});HTMLMediaElement.prototype.play=function(){this.testPaused=false;setTimeout(()=>this.dispatchEvent(new Event('playing')),20);return Promise.resolve();};
  window.fetch=async function(url){fixture.fetches.push(url);if(url.startsWith('https://kick.com/api/v2/channels/'))return new Response(JSON.stringify({data:{playback_url:'https://test.playback.live-video.net/master.m3u8',...${JSON.stringify(streamInfo)}}}));return new Response('#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\\n720.m3u8\\n');};
 })();`});
 await installSDK(page);
 for(const name of ['chat-ui.js','joint-telemetry.js','channel.js','native-api.js','hls-manifest.js','kick-http.js','discovery-api.js','direct-api.js','video-stats.js','video-stats-panel.js','stream-info.js','discovery-home.js','embed-player.js','native-hls.js'])await page.addScriptTag({path:path.join(BASE,'app',name)});
 return {page,outbound};
}
async function watch(page,channel='yoda'){await page.fill('#channel',channel);await page.click('#watch');await page.waitForSelector('video');await page.waitForFunction(()=>!document.getElementById('notice').hidden===false);}
async function enable(page){await page.evaluate(()=>{if(!KickChatUI.visible())document.getElementById('native-theater').click();});await page.waitForFunction(()=>KickChatUI.snapshot().state==='Connected');}
async function emit(page,n){await page.evaluate(n=>{for(let i=0;i<n;i++)fixture.emit('samples',Array.from({length:5},(_,j)=>({user:'SYNTHETIC_AUTHOR',text:'<img src=x onerror=evil()> fixture '+i+'_'+j,timestamp:'2026-11-12T00:00:00Z'})));},n);await page.waitForFunction(()=>fixture.delivery.queue.length===0&&KickChatUI.snapshot().queue===0);}
const starts=page=>page.evaluate(()=>fixture.calls.filter(c=>c.method==='start').length);
test('home has no Luna calls and a successful opening starts in fullscreen and chat starts on demand', async () => {
 const {page,outbound}=await setup();
 try {
  assert.equal(await page.evaluate(()=>fixture.calls.length),0);
  await watch(page);
  assert.equal(await page.evaluate(()=>KickJointDiagnostics.snapshot().player.view_mode),'fullscreen');
  assert.equal(await starts(page),0);
  assert.equal(await page.locator('#chat-panel').isVisible(),false);
  await enable(page);
  assert.equal(await starts(page),1);
  assert.equal(await page.locator('#stream-info').isVisible(),true);
  assert.equal(await page.locator('[data-info="name"]').textContent(),'yoda');
  for (const key of ['title','category','viewers','avatar']){
   assert.equal(await page.locator('[data-info="'+key+'"]').isVisible(),false);
  }
  assert.equal(await page.locator('#chat-panel').isVisible(),true);
  assert.equal(await page.evaluate(()=>KickJointDiagnostics.snapshot().player.view_mode),'theater');
  assert.deepEqual(outbound,[]);
 } finally { await page.close(); }
});

test('remote transitions preserve the HLS instance and only restart chat after fullscreen', async () => {
 const {page,outbound}=await setup();
 try {
  await watch(page); await enable(page);
  await page.evaluate(()=>{
   window.previous=document.querySelector('video');
   window.loads=previous.loads; window.src=previous.src; previous.currentTime=17;
   window.chatID=KickChatUI.snapshot().session_id;
  });
  await emit(page,1);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'native-settings');

  async function transition(key, id, expected) {
   if (key) await page.keyboard.press(key);
   assert.equal(await page.evaluate(()=>document.activeElement.id),id);
   await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>KickNativeDiagnostics.snapshot().view_mode),expected);
   assert.equal(await page.evaluate(()=>document.activeElement.id),id);
   assert.equal(await page.locator('#chat-panel').isVisible(),expected!=='fullscreen');
   for(const [selector,mode] of [['#native-theater','theater'],['#native-fullscreen','fullscreen']]){
    assert.equal(await page.locator(selector).getAttribute('aria-pressed'),String(expected===mode));
   }
   const bounds=await page.locator('video').boundingBox();
   assert.equal(bounds.width,expected==='fullscreen'?1920:1440);
   assert.equal(bounds.height,1080);
   assert.equal(await page.locator('video').evaluate(v=>getComputedStyle(v).objectFit),'contain');
   assert.equal(await page.evaluate(()=>previous===document.querySelector('video')&&previous.loads===loads&&previous.src===src&&previous.currentTime===17&&!previous.paused),true);
  }

  assert.equal(await page.evaluate(()=>KickChatUI.snapshot().session_id===chatID),true);
  assert.equal(await page.locator('.chat-row').count(),5);
  await transition('ArrowRight','native-fullscreen','fullscreen');
  await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');
  await transition(null,'native-fullscreen','theater');
  await enable(page);
  await page.keyboard.press('ArrowLeft'); // Configurações
  await page.keyboard.press('ArrowLeft'); // Informações
  await transition('ArrowLeft','native-theater','fullscreen');
  await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');
  await transition(null,'native-theater','theater');
  await enable(page); await emit(page,1);
  assert.equal(await starts(page),3);
  assert.equal(await page.evaluate(()=>fixture.fetches.length),2);
  assert.deepEqual(outbound,[]);
 } finally { await page.close(); }
});
test('chat metadata updates the existing OSD without resizing the video or reopening it', async () => {
 const title='<img onerror=window.injected=true> '+('Título extenso '.repeat(65));
 const {page}=await setup({
  width:1280,height:720,streamInfo:{session_title:title,viewer_count:0,categories:[{name:'Conversas'}]}
 });
 try {
  await page.clock.install();
  await page.route('https://files.kick.com/fixture/avatar.gif',r=>r.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')}));
  await watch(page); await enable(page);
  const field=key=>page.locator('[data-info="'+key+'"]');
  const osd=page.locator('#stream-info');
  await osd.waitFor({state:'visible'});
  assert.equal(await field('title').textContent(),title.trim().slice(0,1000));
  assert.equal(await field('category').textContent(),'Conversas');
  assert.equal(await field('viewer-count').textContent(),'0');
  assert.equal(await field('title').locator('img').count(),0);
  const bounds=()=>Promise.all(['video','#chat-panel'].map(selector=>page.locator(selector).boundingBox()));
  const initial=await bounds();
  const info=await osd.boundingBox();
  assert.equal(initial[0].width,initial[1].x);
  assert.ok(info.x+info.width <= initial[0].width);
  await page.evaluate(()=>fixture.emit('stream_info',{stream_info:{
   name:'Canal de teste', viewers:4321, avatar:'https://files.kick.com/fixture/avatar.gif'
  }}));
  await field('avatar').waitFor({state:'visible'});
  assert.equal(await field('name').textContent(),'Canal de teste');
  assert.equal(await field('viewer-count').textContent(),'4.321');
  await page.clock.runFor(2300);
  await osd.waitFor({state:'hidden'});
  await page.evaluate(()=>fixture.emit('stream_info',{stream_info:{viewers:4322}}));
  await page.waitForFunction(()=>document.querySelector('[data-info=viewer-count]').textContent==='4.322');
  assert.equal(await osd.isVisible(),false);
  assert.deepEqual(await bounds(),initial);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&document.documentElement.scrollHeight===innerHeight),true);
 } finally { await page.close(); }
});
test('incremental bounded DOM retains old rows, text injection is inert, hidden panel clears memory',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await emit(page,1);await page.evaluate(()=>window.first=document.querySelector('.chat-row'));await emit(page,1);assert.equal(await page.evaluate(()=>first.isConnected),true);for(let i=0;i<4;i++)await emit(page,20);assert.equal(await page.locator('.chat-row').count(),60);assert.equal(await page.locator('#chat-messages img').count(),0);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().queue_peak<=512),true);assert.equal(await page.evaluate(()=>JSON.stringify(KickJointDiagnostics.snapshot()).includes('SYNTHETIC_AUTHOR')),false);await page.evaluate(()=>{document.body.dataset.fixture='synthetic';var p=document.createElement('p');p.textContent='FIXTURES LOCAIS · SEM KICK';p.style='position:fixed;top:20px;left:20px;color:#fff';document.body.appendChild(p);});await page.screenshot({path:process.env.KICKTV_TEST_SCREENSHOT||path.join(BASE,'test-results/theater-fixture.png')});await page.evaluate(()=>KickChatUI.hide());await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');assert.equal(await page.locator('.chat-row').count(),0);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().queue),0);}finally{await page.close();}});
test('chat failure does not pause or replace video and no retry follows',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.evaluate(()=>{window.previous=document.querySelector('video');fixture.failChat();});await page.waitForFunction(()=>KickChatUI.snapshot().state==='Error');assert.equal(await page.evaluate(()=>previous===document.querySelector('video')&&!previous.paused),true);assert.equal(await starts(page),1);}finally{await page.close();}});
test('HLS waiting and quality changes never start another chat session',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.locator('video').evaluate(v=>{v.dispatchEvent(new Event('waiting'));v.dispatchEvent(new Event('playing'));});await page.evaluate(()=>document.getElementById('native-quality').click());await page.locator('#native-quality-menu button').last().click();assert.equal(await starts(page),1);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().state),'Connected');}finally{await page.close();}});
test('explicit channel change stops previous chat, one new start, same-channel reload does not renegotiate',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kicktv-channel-selected',{detail:{channel:'newchannel'}})));await page.waitForFunction(()=>fixture.calls.filter(c=>c.method==='start').length===2);assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='start').at(-1).parameters.channel),'newchannel');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kicktv-channel-selected',{detail:{channel:'newchannel'}})));assert.equal(await starts(page),2);assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='stop').length),1);}finally{await page.close();}});
test('reloading the same channel preserves its selected view and active chat', async () => {
 const {page}=await setup();
 try {
  await watch(page); await enable(page);
  await page.evaluate(()=>document.getElementById('native-reload').click());
  await page.waitForFunction(()=>KickNativeDiagnostics.snapshot()?.state==='playing');
  assert.equal(await page.evaluate(()=>KickNativeDiagnostics.snapshot().view_mode),'theater');
  assert.equal(await starts(page),1);
 } finally { await page.close(); }
});
test('cancellation before subscription ACK ignores late callbacks and sends no start',async()=>{const {page}=await setup();try{await page.evaluate(()=>{fixture.hold=true;});await watch(page);await page.evaluate(()=>document.getElementById('native-theater').click());await page.waitForFunction(()=>fixture.late);await page.evaluate(()=>{KickChatUI.hide();fixture.late();});await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');assert.equal(await starts(page),0);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().consumer),false);}finally{await page.close();}});
test('late samples after hide and pagehide cannot render or restart',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.evaluate(()=>{KickChatUI.hide();fixture.emit('samples',[{user:'late',text:'late'}]);window.dispatchEvent(new Event('pagehide'));});await page.waitForTimeout(300);assert.equal(await page.locator('.chat-row').count(),0);assert.equal(await starts(page),1);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().consumer),false);}finally{await page.close();}});
test('rapid visibility changes coalesce without duplicate chat starts', async () => {
 const {page}=await setup();
 try {
  await watch(page); await enable(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');
  await page.evaluate(()=>{
   const theater=document.getElementById('native-theater');
   const fullscreen=document.getElementById('native-fullscreen');
   for(let i=0;i<20;i++){theater.click(); fullscreen.click();}
   theater.click();
  });
  await enable(page);
  assert.equal(await starts(page),2);
 } finally { await page.close(); }
});
test('fatal HLS error closes chat without starting another session',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.locator('video').evaluate(v=>{Object.defineProperty(v,'error',{value:{code:3}});v.dispatchEvent(new Event('error'));});await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');assert.equal(await starts(page),1);assert.equal(await page.locator('video').count(),0);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().consumer),false);}finally{await page.close();}});
test('actual form channel change follows exit policy and starts chat for the new channel',async()=>{const {page}=await setup();try{await watch(page,'yoda');await enable(page);await page.keyboard.press('Escape');await page.waitForFunction(()=>!KickChatUI.visible());await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('home').hidden);await watch(page,'newchannel');await enable(page);assert.equal(await starts(page),2);assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='start').at(-1).parameters.channel),'newchannel');}finally{await page.close();}});
test('mixed text, Unicode and CSS emotes preserve FIFO, release references and keep HLS intact',async()=>{const {page}=await setup();try{
 await page.route('https://files.kick.com/emotes/**',r=>r.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')}));
 await watch(page);await enable(page);await page.evaluate(()=>{window.videoBefore=document.querySelector('video');window.loadsBefore=videoBefore.loads;fixture.emit('samples',Array.from({length:150},(_,i)=>({user:'synthetic',text:i%3===0?'plain':i%3===1?'🔥👨‍👩‍👧‍👦':'[emote:1:fixture][emote:2:fixture]'})));});
 await page.waitForFunction(()=>{
  const tiles=document.querySelectorAll('#chat-messages .chat-emote-lazy-css');
  return fixture.delivery.counts.confirmed===150&&KickEmotes.snapshot().counts.lazy_css_ready===2&&
   tiles.length===40&&document.querySelectorAll('#chat-messages img').length===0;
 });
 assert.deepEqual(await page.locator('.chat-row').evaluateAll(rows=>rows.map(r=>Number(r.dataset.deliverySeq))),Array.from({length:60},(_,i)=>91+i));
 assert.equal(await page.evaluate(()=>document.querySelector('video')===videoBefore&&videoBefore.loads===loadsBefore),true);
 assert.equal(await page.evaluate(()=>KickChatUI.snapshot().discarded),0);
 await page.evaluate(()=>KickChatUI.hide());await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');
 assert.deepEqual(await page.evaluate(()=>({ids:KickEmotes.snapshot().known_ids,images:KickEmotes.snapshot().counts.lazy_css_dom_emotes})),{ids:0,images:0});
 }finally{await page.close();}});
test('lost Luna DOM ACK recovers by retransmission with one visible copy',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.evaluate(()=>{fixture.dropACK=true;fixture.emit('samples',Array.from({length:5},()=>({user:'synthetic',text:'synthetic'})));});await page.waitForFunction(()=>KickChatUI.snapshot().presented===5);assert.equal(await page.evaluate(()=>fixture.delivery.counts.confirmed),0);await page.evaluate(()=>{fixture.dropACK=false;fixture.delivery.flight.at-=2001;fixture.delivery.lastFlush=-Infinity;fixture.delivery.flush();});await page.waitForFunction(()=>fixture.delivery.counts.confirmed===5);assert.equal(await page.locator('.chat-row').count(),5);assert.equal(await page.evaluate(()=>KickChatUI.snapshot().delivery.counts.duplicates_suppressed),5);}finally{await page.close();}});
test('local Luna recovery drains the same session without a second chat start',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.evaluate(()=>{fixture.emit('samples',Array.from({length:20},()=>({user:'synthetic',text:'pending'})));fixture.failConsumer();});await page.waitForFunction(()=>fixture.delivery.counts.confirmed===20);assert.equal(await starts(page),1);assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='events').length),2);assert.equal(await page.locator('.chat-row').count(),20);assert.equal(await page.evaluate(()=>fixture.delivery.closed),true);}finally{await page.close();}});
test('hiding during a burst drains admitted messages before closing the consumer',async()=>{const {page}=await setup();try{await watch(page);await enable(page);await page.evaluate(()=>{fixture.emit('samples',Array.from({length:100},()=>({user:'synthetic',text:'pending'})));KickChatUI.hide();});await page.waitForFunction(()=>KickChatUI.snapshot().state==='Closed');assert.deepEqual(await page.evaluate(()=>({confirmed:fixture.delivery.counts.confirmed,discarded:fixture.delivery.counts.discarded,queue:fixture.delivery.queue.length,ids:KickEmotes.snapshot().known_ids})),{confirmed:100,discarded:0,queue:0,ids:0});assert.equal(await page.locator('.chat-row').count(),0);}finally{await page.close();}});

test('chat yields between batches and drains via the timer when animation frames stall', async () => {
 const {page}=await setup();
 try {
  await watch(page);
  await enable(page);
  await page.evaluate(() => {
   window.requestAnimationFrame = () => 0;
   fixture.emit('samples', Array.from({length:160}, () => ({user:'fixture',text:'pending'})));
  });
  await page.waitForFunction(() => fixture.delivery.counts.confirmed === 160, null, {polling:20});
  const chat = await page.evaluate(() => KickChatUI.snapshot());
  assert.equal(chat.presented, 160);
  assert.equal(chat.queue, 0);
  assert.ok(chat.batches >= 3);
  assert.ok(chat.delivery.h.render_batch_items.max <= 64);
  assert.equal(chat.delivery.h.render_timer_late_ms.n, chat.batches);
  assert.equal(chat.delivery.h.render_frame_wait_ms.n, 0);
  assert.equal(chat.delivery.h.render_prepare_ms.n, chat.batches);
  assert.equal(chat.delivery.h.render_append_ms.n, chat.batches);
  assert.equal(chat.delivery.h.ui_wait_ms.n, 160);
 } finally { await page.close(); }
});

test('collector starts the live and chat and emits a batch count without message content',async()=>{
 const {installProbe,startStream,enableChat,chatBound}=require('../../scripts/collector/page.cjs');
 const {page}=await setup();
 try {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  await cdp.send('Runtime.addBinding',{name:'fixtureCollectorEvent'});
  const events=[];
  cdp.on('Runtime.bindingCalled',({name,payload})=>{
   if(name==='fixtureCollectorEvent')events.push(JSON.parse(payload));
  });
  assert.equal(await page.evaluate(`(${installProbe})('fixtureCollector','fixtureCollectorEvent')`),true);
  assert.equal(await page.evaluate(startStream,'baianotv'),true);
  await page.waitForFunction(()=>KickNativeDiagnostics.snapshot()?.state==='playing');
  assert.equal(await page.evaluate(enableChat),true);
  await page.waitForFunction(chatBound);
  await page.evaluate(()=>fixture.emit('samples',[{user:'hidden-user',text:'hidden-content'}]));
  await page.waitForFunction(()=>KickChatUI.snapshot().presented===1);
  const snapshot=await page.evaluate(()=>fixtureCollector.read(false));
  assert.equal(snapshot.channel,'baianotv');
  assert.equal(snapshot.chat.state,'Connected');
  assert.ok(snapshot.first_video_ms>=snapshot.selected_ms);
  assert.ok(snapshot.chat_ready_ms>=snapshot.selected_ms);
  assert.equal(snapshot.view_mode,'theater');
  await page.evaluate(()=>fixture.failChat());
  await page.waitForFunction(()=>KickChatUI.snapshot().state==='Error');
  await page.evaluate(()=>fixtureCollector.stop());
  const terminal=events.findLast(event=>event.kind==='chat_service_status'&&event.status==='stopped');
  assert.equal(terminal?.reason,null);
  assert.equal(terminal?.error,'socket_closed_1006');
  assert.ok(events.some(event=>event.kind==='view_mode'&&event.to==='theater'));
  assert.ok(events.some(event=>event.kind==='chat_batch'&&event.dom_inserted===1));
  assert.ok(!JSON.stringify(events).includes('hidden-'));
  assert.equal(await page.evaluate(()=>typeof window.fixtureCollector),'undefined');
  await cdp.detach();
 } finally { await page.close(); }
});

test('Inspector capture clips the chat while producing a valid JPEG',async()=>{
 const {screenshotClip}=require('../../scripts/collector/screenshots.cjs');
 const {page}=await setup();
 try{
  await watch(page,'baianotv');await enable(page);
  const clip=await page.evaluate(screenshotClip);
  const bounds=await page.locator('#chat-panel').boundingBox();
  assert.ok(clip.width<bounds.x);
  const cdp=await page.context().newCDPSession(page);
  const {data}=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:65,clip});
  const jpeg=Buffer.from(data,'base64');
  assert.equal(jpeg.readUInt16BE(0),0xffd8);
  assert.equal(jpeg.readUInt16BE(jpeg.length-2),0xffd9);
  await cdp.detach();
 }finally{await page.close();}
});
