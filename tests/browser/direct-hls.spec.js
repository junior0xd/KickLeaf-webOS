const { action } = require('./helpers/controls');
const {test,expect}=require('@playwright/test');
const API='https://kick.com/api/v2/channels/';
const MASTER='https://test.playback.live-video.net/master.m3u8?token=SECRET_TEST';
const MANIFEST='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,FRAME-RATE=60,CODECS="avc1.64001f,mp4a.40.2"\n720.m3u8\n';
async function submit(page,value='yoda'){ await page.locator('#channel').fill(value); await page.locator('#watch').click(); }
async function ready(page){await submit(page);await expect(page.locator('video')).toHaveCount(1);await expect(page.locator('#notice')).toBeHidden();}
async function back(page){await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:461,cancelable:true})));}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.PalmSystem={launchParams:JSON.stringify({mode:'direct-hls'})};
    HTMLMediaElement.prototype.load=function(){};
    HTMLMediaElement.prototype.pause=function(){this.testPaused=true;this.dispatchEvent(new Event('pause'));};
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this.testPaused!==false;}});
    HTMLMediaElement.prototype.play=function(){this.testPaused=false;queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();};
  });
  await page.route(API+'**',route=>route.fulfill({json:{data:{playback_url:MASTER}},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('https://test.playback.live-video.net/**',route=>route.fulfill({body:MANIFEST,headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto('/');
  await expect(page).toHaveURL(/native-hls.html$/);
});
test('descobre sem backend/token/cookies, normaliza canal e reutiliza vídeo e controles',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r));
  await submit(page,'https://kick.com/YoDa');
  await expect(page.locator('video')).toHaveAttribute('src',MASTER);
  const discovery=requests.find(r=>r.url()===API+'yoda/livestream');
  expect(discovery).toBeTruthy();expect(discovery.headers().authorization).toBeUndefined();expect(discovery.headers().cookie).toBeUndefined();
  expect(requests.some(r=>r.url().includes('/api/streams/'))).toBe(false);
  await action(page,0);
  await expect(page.locator('#native-quality-menu button')).toHaveCount(2);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(page.locator('#native-quality')).toHaveText('Qualidade: 720p');
  expect(await page.evaluate(()=>KickNativeDiagnostics.snapshot().nominal_bitrate)).toBe(2500000);
});
test('validação de entrada precede requisição',async({page})=>{
  let calls=0;page.on('request',r=>{if(r.url().startsWith(API))calls++;});
  await submit(page,'https://evil.test/yoda');await expect(page.locator('#message')).not.toBeEmpty();expect(calls).toBe(0);
});
for(const [status,text] of [[401,'autenticação'],[403,'recusou'],[404,'não encontrado'],[429,'limitou'],[500,'HTTP 500']]){
  test('erro HTTP '+status,async({page})=>{
    await page.route(API+'**',r=>r.fulfill({status,body:'not JSON',headers:{'Access-Control-Allow-Origin':'*'}}));
    await submit(page);await expect(page.locator('#message')).toContainText(text);await expect(page.locator('video')).toHaveCount(0);
  });
}
for(const [body,text] of [['{"data":null}','offline'],['{"data":{}}','sem playback_url'],['{"data":{"playback_url":"https://evil.test/a"}}','URL HLS inválida'],['{"unexpected":true}','formato'],['invalid json','JSON inválido']]){
  test('interpreta resposta '+text,async({page})=>{
    await page.route(API+'**',r=>r.fulfill({body,headers:{'Access-Control-Allow-Origin':'*'}}));await submit(page);await expect(page.locator('#message')).toContainText(text);await expect(page.locator('video')).toHaveCount(0);
  });
}
test('rede/CORS não é confundido com offline e não registra URL assinada',async({page})=>{
  const logs=[];page.on('console',m=>logs.push(m.text()));
  await page.route(API+'**',r=>r.abort('failed'));await submit(page);
  await expect(page.locator('#message')).toContainText('rede, TLS ou CORS');
  expect(logs.join('\n')).toContain('discovery_failed');expect(logs.join('\n')).not.toContain('SECRET_TEST');
});
test('manifesto inacessível não impede Auto e é diagnosticado separadamente',async({page})=>{
  const logs=[];page.on('console',m=>logs.push(m.text()));
  await page.route('https://test.playback.live-video.net/**',r=>r.abort('failed'));await ready(page);
  await expect(page.locator('video')).toHaveAttribute('src',MASTER);
  await action(page,0);
  await expect(page.locator('#native-quality-menu')).toContainText('não foi possível ler o manifesto');
  expect(logs.join('\n')).toContain('manifest_unavailable');expect(logs.filter(s=>s.startsWith('[KickLeaf')).join('\n')).not.toContain('SECRET_TEST');
});
test('áudio externo impede variante manual, mantendo Auto',async({page})=>{
  await page.route('https://test.playback.live-video.net/**',r=>r.fulfill({body:'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,AUDIO="audio"\n1080.m3u8',headers:{'Access-Control-Allow-Origin':'*'}}));
  await ready(page);await action(page,0);
  await expect(page.locator('#native-quality-menu button').last()).toBeDisabled();
  await expect(page.locator('video')).toHaveAttribute('src',MASTER);
});
test('timeout de descoberta é limitado e Voltar cancela descoberta pendente',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
  await page.route(API+'**',()=>new Promise(()=>{}));await submit(page);
  await page.clock.fastForward(8100);await expect(page.locator('#message')).toContainText('tempo limite');
  await submit(page);await back(page);await page.clock.fastForward(15000);await expect(page.locator('#home')).toBeVisible();await expect(page.locator('video')).toHaveCount(0);await expect(page.locator('#message')).toBeEmpty();
});
test('timeout só do manifesto continua com Auto',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
  let requested=false;
  await page.route('https://test.playback.live-video.net/**',()=>{requested=true;return new Promise(()=>{});});await submit(page);
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#notice').textContent)).toContain('Consultando');
  // Let discovery reach the independent manifest request before advancing its timer.
  await expect.poll(()=>requested).toBe(true);
  await page.clock.fastForward(3100);await expect(page.locator('video')).toHaveCount(1);
});
test('troca canal/recarrega/libera vídeo, e pode retornar ao iframe sem loop',async({page})=>{
  await ready(page);await page.locator('video').evaluate(v=>window.oldVideo=v);
  await back(page);await back(page);expect(await page.evaluate(()=>!oldVideo.isConnected&&!oldVideo.hasAttribute('src')&&oldVideo.paused)).toBe(true);
  await submit(page,'minerva');await expect(page.locator('video')).toHaveCount(1);
  await action(page,1);await expect(page.locator('video')).toHaveCount(1);
  await action(page,2);
  await expect(page).toHaveURL(/index.html\?iframe&channel=minerva$/);await expect(page.locator('video')).toHaveCount(0);
});
test('falha de reprodução é separada da descoberta e mensagem técnica não vaza URL',async({page})=>{
  const logs=[];page.on('console',m=>logs.push(m.text()));await ready(page);
  await page.locator('video').evaluate(v=>{Object.defineProperty(v,'error',{value:{code:3,message:'secret https://cdn.test/?token=SECRET_TEST'}});v.dispatchEvent(new Event('error'));});
  await expect(page.locator('#message')).toContainText('decodificar');await expect(page.locator('video')).toHaveCount(0);
  expect(logs.filter(s=>s.startsWith('[KickLeaf')).join('\n')).toContain('playback');expect(logs.filter(s=>s.startsWith('[KickLeaf')).join('\n')).not.toContain('SECRET_TEST');
});
test('configuração antiga é ignorada: nenhum método do backend é chamado',async({page})=>{
  await page.evaluate(()=>{KickNativeAPI.config=()=>{throw new Error('backend config called');};KickNativeAPI.resolve=()=>{throw new Error('backend resolve called');};});
  await page.context().addCookies([{name:'secret_cookie',value:'NOT_SENT',domain:'.kick.com',path:'/'}]);
  let cookie;await page.route(API+'**',r=>{cookie=r.request().headers().cookie;return r.fulfill({json:{data:{playback_url:MASTER}},headers:{'Access-Control-Allow-Origin':'*'}});});
  await ready(page);expect(cookie).toBeUndefined();
});
for(const [body,label] of [['<html>error</html>','HTML inválido'],['#EXTM3U\n#EXTINF:4,\nsegment.ts','playlist sem variantes']]){
  test('manifesto '+label+' mantém URL principal e Auto',async({page})=>{
    await page.route('https://test.playback.live-video.net/**',r=>r.fulfill({body,headers:{'Access-Control-Allow-Origin':'*'}}));await ready(page);
    await expect(page.locator('video')).toHaveAttribute('src',MASTER);await action(page,0);
    await expect(page.locator('#native-quality-menu button')).toHaveCount(1);
  });
}
test('cancelar durante análise do manifesto não inicia vídeo tardio',async({page})=>{
  let finish,arrived=false;
  await page.route('https://test.playback.live-video.net/**',async r=>{arrived=true;await new Promise(resolve=>{finish=resolve;});await r.fulfill({body:MANIFEST,headers:{'Access-Control-Allow-Origin':'*'}}).catch(()=>{});});
  await submit(page);await expect.poll(()=>arrived).toBe(true);await back(page);finish();
  await expect(page.locator('#home')).toBeVisible();await expect(page.locator('video')).toHaveCount(0);
});
test('resposta sem permissão CORS termina na descoberta, sem tentar backend',async({page})=>{
  await page.route(API+'**',r=>r.fulfill({json:{data:{playback_url:MASTER}},headers:{'Access-Control-Allow-Origin':'https://different-origin.invalid'}}));
  await submit(page);await expect(page.locator('#message')).toContainText('CORS');await expect(page.locator('video')).toHaveCount(0);
});

// Controlled media timeline: these tests exercise the app, not a native HLS decoder.
async function timeline(page, seekable = [[80, 180]], buffered = [[95, 120]]) {
  await ready(page);
  await page.locator('video').evaluate((v, data) => {
    window.originalVideo = v;
    v.testPosition = 100; v.testSeekable = data.seekable; v.testBuffered = data.buffered;
    v.playCalls = 0; v.loadCalls = 0; v.seekCalls = [];
    Object.defineProperty(v, 'currentTime', {get(){return this.testPosition;},set(t){this.seekCalls.push(t);this.testPosition=t;}});
    for (const [key, field] of [['seekable','testSeekable'], ['buffered','testBuffered']]) {
      Object.defineProperty(v, key, {get(){const list=this[field];return {length:list.length,start:i=>list[i][0],end:i=>list[i][1]};}});
    }
    v.load = function(){this.loadCalls++;};
    const play = v.play;
    v.play = function(){this.playCalls++;return play.call(this);};
  }, {seekable, buffered});
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#native-play-pause')).toBeFocused();
}
const toggle = page => page.keyboard.press('Enter');
for (const seconds of [5,30,120,300]) {
  test('pausa por '+seconds+'s preserva posição disponível sem recriar/recarregar', async({page})=>{
    await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
    await timeline(page);
    await toggle(page);
    await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-label','Reproduzir');
    await expect(page.locator('#native-play-pause img')).toHaveAttribute('src','phosphor-play-fill.svg');
    await page.clock.fastForward(seconds*1000);
    // Native engines may move currentTime even while paused; saved position must survive.
    await page.locator('video').evaluate(v=>{v.testPosition=160;});
    await page.keyboard.press('Enter'); // reveal controls
    await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await toggle(page);
    await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-label','Pausar');
    expect(await page.locator('video').evaluate(v=>({same:v===originalVideo,time:v.currentTime,loads:v.loadCalls,plays:v.playCalls,seeks:v.seekCalls})))
      .toEqual({same:true,time:100,loads:0,plays:1,seeks:[100]});
    await expect(page.locator('#notice')).toBeHidden();
  });
}
test('ponto expirado recupera no trecho mais próximo e mantém aviso após playing',async({page})=>{
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.testSeekable=[[130,170],[180,200]];v.testBuffered=[];v.testPosition=199;});
  await toggle(page);
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(130.25);
  await expect(page.locator('#notice')).toContainText('ponto pausado não está mais disponível');
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-label','Pausar');
});
test('buffer preservado permite ponto anterior ao seekable; intervalos vazios não provam expiração',async({page})=>{
  await timeline(page,[[130,180]],[[95,110]]);await toggle(page);await toggle(page);
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(100);
  await toggle(page);await page.locator('video').evaluate(v=>{v.testSeekable=[];v.testBuffered=[];});await toggle(page);
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(100);
  await expect(page.locator('#notice')).toBeHidden();
});
test('retomada corrige salto automático do motor nativo uma vez',async({page})=>{
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.play=function(){this.testPaused=false;this.testPosition=170;this.dispatchEvent(new Event('playing'));return Promise.resolve();};});
  await toggle(page);
  expect(await page.locator('video').evaluate(v=>v.seekCalls)).toEqual([100]);
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('seeked')));
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-busy','false');
});
test('acionamentos rápidos não sobrepõem play pendente e rejeição permite tentar novamente',async({page})=>{
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.play=function(){this.playCalls++;return new Promise((resolve,reject)=>{window.rejectPlay=reject;});};});
  await toggle(page);
  await page.evaluate(()=>{for(let i=0;i<20;i++)document.getElementById('native-play-pause').click();});
  expect(await page.locator('video').evaluate(v=>v.playCalls)).toBe(1);
  await page.evaluate(()=>rejectPlay(new Error('denied')));
  await expect(page.locator('#notice')).toContainText('Não foi possível retomar');
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-busy','false');
  await page.locator('video').evaluate(v=>{v.play=HTMLMediaElement.prototype.play;});
  await toggle(page);await expect(page.locator('#notice')).toBeHidden();
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(100);
});
test('conexão temporária: waiting/playing retoma mesmo ponto; timeout é limitado',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.play=function(){this.testPaused=false;this.dispatchEvent(new Event('waiting'));return new Promise(()=>{});};});
  await toggle(page);await page.clock.fastForward(10000);
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-busy','true');
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('playing')));
  await expect(page.locator('#notice')).toBeHidden();
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(100);
  await page.keyboard.press('Enter');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
  await toggle(page);await toggle(page);
  await page.clock.fastForward(25000);
  await expect(page.locator('#notice')).toContainText('Verifique a conexão');
  expect(await page.locator('video').evaluate(v=>v.paused)).toBe(true);
  await page.clock.fastForward(300000);await expect(page.locator('video')).toHaveCount(1);
  // A late native playing event after a timed-out play must not restart audio.
  await page.locator('video').evaluate(v=>{v.testPaused=false;v.dispatchEvent(new Event('playing'));});
  expect(await page.locator('video').evaluate(v=>v.paused)).toBe(true);
});
test('ponto expira durante espera: uma recuperação, depois pausa sem loop',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.play=function(){this.testPaused=false;this.playCalls++;return new Promise(()=>{});};});
  await toggle(page);
  await page.locator('video').evaluate(v=>{v.testSeekable=[[140,180]];v.testBuffered=[];});
  await page.clock.fastForward(25000);
  expect(await page.locator('video').evaluate(v=>v.currentTime)).toBe(140.25);
  await page.clock.fastForward(25000);
  await expect(page.locator('#notice')).toContainText('Não foi possível retomar');
  expect(await page.locator('video').evaluate(v=>({paused:v.paused,plays:v.playCalls,loads:v.loadCalls}))).toEqual({paused:true,plays:1,loads:0});
});
test('teclas de mídia e eventos reais atualizam ícone sem mudar foco; repetição é ignorada',async({page})=>{
  await timeline(page);
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:19,cancelable:true})));
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-label','Reproduzir');
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:415,cancelable:true})));
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-label','Pausar');
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13,repeat:true,cancelable:true})));
  await expect(page.locator('#native-play-pause')).toBeFocused();
  expect(await page.locator('video').evaluate(v=>v.paused)).toBe(false);
  await page.locator('video').evaluate(v=>v.pause());
  await expect(page.locator('#native-play-pause')).toHaveAttribute('aria-label','Reproduzir');
});
test('motor que insiste em saltar encerra tentativa sem loop de busca',async({page})=>{
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.play=function(){this.testPaused=false;this.testPosition=170;this.dispatchEvent(new Event('playing'));return Promise.resolve();};});
  await toggle(page);
  await page.locator('video').evaluate(v=>{v.testPosition=170;v.dispatchEvent(new Event('seeked'));});
  await expect(page.locator('#notice')).toContainText('não conseguiu preservar o ponto pausado');
  expect(await page.locator('video').evaluate(v=>({paused:v.paused,seeks:v.seekCalls}))).toEqual({paused:true,seeks:[100]});
});
test('liberação durante play pendente ignora rejeição e eventos tardios',async({page})=>{
  await timeline(page);await toggle(page);
  await page.locator('video').evaluate(v=>{v.play=function(){return new Promise((resolve,reject)=>{window.rejectOldPlay=reject;});};});
  await toggle(page);await back(page);await back(page);await back(page);
  await expect(page.locator('#home')).toBeVisible();
  await page.evaluate(()=>{rejectOldPlay(new Error('late'));originalVideo.dispatchEvent(new Event('playing'));});
  await expect(page.locator('#message')).toBeEmpty();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>!originalVideo.isConnected&&!originalVideo.hasAttribute('src'))).toBe(true);
});
