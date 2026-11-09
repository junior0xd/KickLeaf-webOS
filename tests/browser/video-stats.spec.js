const {test,expect}=require('@playwright/test');
const API='https://kick.com/api/v2/channels/';
const MASTER='https://test.playback.live-video.net/master.m3u8?token=PRIVATE_TEST';
const MANIFEST='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6200000,RESOLUTION=1920x1080,FRAME-RATE=60,CODECS="avc1.640028,mp4a.40.2"\n1080.m3u8\n';
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    // Synthetic media instrumentation, never used by the app or a real stream.
    window.testQualityReads=0;window.testListenerAdds=0;window.testListenerRemoves=0;
    const add=HTMLMediaElement.prototype.addEventListener,remove=HTMLMediaElement.prototype.removeEventListener;
    HTMLMediaElement.prototype.addEventListener=function(...args){this.testAdds=(this.testAdds||0)+1;window.testListenerAdds++;return add.apply(this,args);};
    HTMLMediaElement.prototype.removeEventListener=function(...args){this.testRemoves=(this.testRemoves||0)+1;window.testListenerRemoves++;return remove.apply(this,args);};
    HTMLMediaElement.prototype.load=function(){};
    HTMLMediaElement.prototype.pause=function(){this.testPaused=true;this.dispatchEvent(new Event('pause'));};
    Object.defineProperties(HTMLMediaElement.prototype,{
      paused:{get(){return this.testPaused!==false;}},
      currentTime:{get(){return this.testTime??10;}},
      buffered:{get(){return {length:1,start:()=>0,end:()=>18.4};}},
      seekable:{get(){return {length:1,start:()=>0,end:()=>24};}}
    });
    Object.defineProperties(HTMLVideoElement.prototype,{videoWidth:{get(){return this.testWidth??1920;}},videoHeight:{get(){return this.testHeight??1080;}}});
    HTMLVideoElement.prototype.getVideoPlaybackQuality=function(){window.testQualityReads++;return {totalVideoFrames:this.testFrames??600,droppedVideoFrames:this.testDropped??12};};
    HTMLMediaElement.prototype.play=function(){
      this.testPaused=false;
      const announce=()=>{this.testPlayed=true;this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('playing'));};
      // Preserve native event order: assigning src queues loadstart before playing.
      if(this.testPlayed)queueMicrotask(announce);else this.onloadstart=()=>{this.onloadstart=null;announce();};
      return Promise.resolve();
    };
  });
  await page.route(API+'**',r=>r.fulfill({json:{data:{playback_url:MASTER}},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('https://test.playback.live-video.net/**',r=>r.fulfill({body:MANIFEST,headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto('/');await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
});
async function start(page,channel='yetz'){await page.locator('#channel').fill(channel);await page.locator('#watch').click();await expect(page.locator('video')).toHaveCount(1);await expect(page.locator('#notice')).toBeHidden();}
async function enable(page){await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await expect(page.locator('#video-statistics-toggle')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#video-statistics')).toBeVisible();}
const field=(page,key)=>page.locator('[data-stat="'+key+'"]');

test('controle remoto ativa/desativa sem reiniciar vídeo ou capturar foco; painel independe dos controles',async({page})=>{
  await start(page);await expect(page.locator('#video-statistics')).toBeHidden();await page.locator('video').evaluate(v=>window.testVideo=v);
  const before=await page.locator('video').boundingBox();await enable(page);
  await expect(page.locator('#video-statistics-toggle')).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('video').boundingBox()).toEqual(before);expect(await page.evaluate(()=>testVideo===document.querySelector('video'))).toBe(true);
  await page.clock.fastForward(5100);await expect(page.locator('#native-controls')).toBeHidden();await expect(page.locator('#video-statistics')).toBeVisible();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
  await expect(page.locator('#video-statistics')).toBeHidden();await expect(page.locator('#video-statistics-toggle')).toHaveAttribute('aria-pressed','false');
  const reads=await page.evaluate(()=>testQualityReads);await page.clock.fastForward(10000);expect(await page.evaluate(()=>testQualityReads)).toBe(reads);
  await expect(page.locator('video')).toHaveCount(1);
});
test('atualiza medidas reais da API, estima FPS e não inventa metadados em Auto ou latência',async({page})=>{
  await start(page);await enable(page);
  await expect(field(page,'resolution')).toHaveText('1920 × 1080');await expect(field(page,'buffer')).toHaveText('8,4 s');
  await expect(field(page,'frames')).toHaveText('12 / 600');await expect(field(page,'edge')).toHaveText('14,0 s');
  for(const key of ['fps','nominalFPS','bitrate','videoCodec','audioCodec','latency'])await expect(field(page,key)).toHaveText('N/D');
  await expect(field(page,'quality')).toHaveText('Auto (variante N/D)');
  await page.locator('video').evaluate(v=>{v.testFrames=660;v.testDropped=14;v.testTime=11;});await page.clock.fastForward(1000);
  await expect(field(page,'fps')).toHaveText('58,0 fps');await expect(field(page,'buffer')).toHaveText('7,4 s');await expect(field(page,'frames')).toHaveText('14 / 660');
  await expect(field(page,'state')).toHaveText('Reproduzindo');
});
test('qualidade manual usa declarações e troca não mistura métricas nem perde preferência visual',async({page})=>{
  await start(page);await enable(page);await page.locator('video').evaluate(v=>{window.oldStatsVideo=v;v.dispatchEvent(new Event('waiting'));});
  await page.clock.fastForward(1000);await expect(field(page,'interruptions')).toHaveText('1 / 1,0 s');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.clock.fastForward(1000);await expect(field(page,'quality')).toHaveText('1080p');await expect(field(page,'bitrate')).toHaveText('6,20 Mbps');
  await expect(field(page,'nominalFPS')).toHaveText('60,00 fps');await expect(field(page,'videoCodec')).toHaveText('avc1.640028');await expect(field(page,'audioCodec')).toHaveText('mp4a.40.2');
  await expect(field(page,'interruptions')).toHaveText('0 / 0,0 s');await expect(page.locator('#video-statistics')).toBeVisible();
  expect(await page.evaluate(()=>!oldStatsVideo.isConnected&&!oldStatsVideo.hasAttribute('src')&&oldStatsVideo.testAdds===oldStatsVideo.testRemoves)).toBe(true);
});
test('buffering mede interrupções sem repetir waiting ou incluir pausa e continua ao retomar',async({page})=>{
  await start(page);await enable(page);
  await page.locator('video').evaluate(v=>{v.dispatchEvent(new Event('waiting'));v.dispatchEvent(new Event('waiting'));});await page.clock.fastForward(2000);
  await expect(field(page,'state')).toHaveText('Buffering');await expect(field(page,'interruptions')).toHaveText('1 / 2,0 s');await expect(field(page,'fps')).toHaveText('N/D');
  await page.locator('video').evaluate(v=>v.pause());await page.clock.fastForward(3000);
  await expect(field(page,'state')).toHaveText('Pausado');await expect(field(page,'interruptions')).toHaveText('1 / 2,0 s');
  await page.locator('video').evaluate(v=>v.play());await page.clock.fastForward(1000);await expect(field(page,'state')).toHaveText('Reproduzindo');
});
test('APIs ausentes e valores inválidos exibem N/D sem lançar erros',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  await page.locator('video').evaluate(v=>{v.getVideoPlaybackQuality=undefined;v.testWidth=0;v.testHeight=NaN;Object.defineProperty(v,'buffered',{get(){throw new Error('not available');}});});
  await enable(page);await page.clock.fastForward(2000);
  for(const key of ['resolution','fps','bitrate','latency','buffer'])await expect(field(page,key)).toHaveText('N/D');await expect(field(page,'frames')).toHaveText('N/D / N/D');expect(errors).toEqual([]);
});
test('saída/troca de canal e recarga desligam polling, removem listeners e não reaproveitam valores',async({page})=>{
  await start(page);await enable(page);await page.locator('video').evaluate(v=>window.releasedStatsVideo=v);
  await page.keyboard.press('Escape');await expect(page.locator('#native-controls')).toBeHidden();await expect(page.locator('#video-statistics')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#video-statistics')).toBeHidden();
  expect(await page.evaluate(()=>releasedStatsVideo.testAdds===releasedStatsVideo.testRemoves)).toBe(true);
  const reads=await page.evaluate(()=>testQualityReads);await page.clock.fastForward(10000);expect(await page.evaluate(()=>testQualityReads)).toBe(reads);
  await start(page,'baianotv');await expect(page.locator('#video-statistics')).toBeHidden();await enable(page);await expect(field(page,'quality')).toHaveText('Auto (variante N/D)');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await expect(page.locator('#video-statistics')).toBeHidden();await expect(page.locator('video')).toHaveCount(1);
});
for(const event of ['error','ended'])test(event+' limpa painel, estado e polling',async({page})=>{
  await start(page);await enable(page);await page.locator('video').evaluate((v,event)=>{if(event==='error')Object.defineProperty(v,'error',{value:{code:3}});v.dispatchEvent(new Event(event));},event);
  await expect(page.locator('#home')).toBeVisible();await expect(page.locator('#video-statistics')).toBeHidden();
  const reads=await page.evaluate(()=>testQualityReads);await page.clock.fastForward(10000);expect(await page.evaluate(()=>testQualityReads)).toBe(reads);await expect(field(page,'resolution')).toHaveText('N/D');
});
test('pode abrir durante descoberta; não faz requisições extras nem expõe URL',async({page})=>{
  let resolve,arrived=false;await page.route(API+'**',async r=>{arrived=true;await new Promise(done=>{resolve=done;});await r.fulfill({json:{data:{playback_url:MASTER}},headers:{'Access-Control-Allow-Origin':'*'}});});
  await page.locator('#channel').fill('yetz');await page.locator('#watch').click();await expect.poll(()=>arrived).toBe(true);await enable(page);
  await expect(field(page,'state')).toHaveText('Descobrindo transmissão');await expect(field(page,'resolution')).toHaveText('N/D');resolve();await expect(page.locator('video')).toHaveCount(1);
  const requests=[];page.on('request',r=>requests.push(r.url()));await page.clock.fastForward(6000);expect(requests).toEqual([]);
  await expect(page.locator('#video-statistics')).not.toContainText(/PRIVATE_TEST|https:/);
});
test('layout cabe no vídeo Full HD, não intercepta ponteiro e registra captura com mídia simulada',async({page})=>{
  await start(page);await enable(page);await page.clock.fastForward(1000);
  const panel=page.locator('#video-statistics');await expect(panel).toHaveCSS('pointer-events','none');
  const box=await panel.boundingBox();expect(box.y+box.height).toBeLessThan(900);expect(box.x+box.width).toBeLessThan(1920);
  expect(await panel.evaluate(node=>node.scrollHeight<=node.clientHeight)).toBe(true);
  await page.keyboard.press('Escape');
  await page.screenshot({path:'.build/video-statistics-preview.png'});
});
