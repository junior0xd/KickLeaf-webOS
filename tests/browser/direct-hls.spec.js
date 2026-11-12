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
  expect(logs.join('\n')).toContain('manifest_unavailable');expect(logs.filter(s=>s.startsWith('[KickTV')).join('\n')).not.toContain('SECRET_TEST');
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
  await back(page);expect(await page.evaluate(()=>!oldVideo.isConnected&&!oldVideo.hasAttribute('src')&&oldVideo.paused)).toBe(true);
  await submit(page,'minerva');await expect(page.locator('video')).toHaveCount(1);
  await action(page,1);await expect(page.locator('video')).toHaveCount(1);
  await action(page,2);
  await expect(page).toHaveURL(/index.html\?iframe&channel=minerva$/);await expect(page.locator('video')).toHaveCount(0);
});
test('falha de reprodução é separada da descoberta e mensagem técnica não vaza URL',async({page})=>{
  const logs=[];page.on('console',m=>logs.push(m.text()));await ready(page);
  await page.locator('video').evaluate(v=>{Object.defineProperty(v,'error',{value:{code:3,message:'secret https://cdn.test/?token=SECRET_TEST'}});v.dispatchEvent(new Event('error'));});
  await expect(page.locator('#message')).toContainText('decodificar');await expect(page.locator('video')).toHaveCount(0);
  expect(logs.filter(s=>s.startsWith('[KickTV')).join('\n')).toContain('playback');expect(logs.filter(s=>s.startsWith('[KickTV')).join('\n')).not.toContain('SECRET_TEST');
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
