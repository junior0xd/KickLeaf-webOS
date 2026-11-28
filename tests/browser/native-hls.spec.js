const { action } = require('./helpers/controls');
const { test, expect } = require('@playwright/test');
const TOKEN = 'local-test-' + 'x'.repeat(32);
const BASE = 'http://127.0.0.1:8766';
const MASTER = 'https://test.playback.live-video.net/master.m3u8?token=FAKE_TOKEN';
function payload() {
  return { channel: 'yoda', online: true, source: 'kick', playback: { type:'hls', url:MASTER, live:true,
    qualities:[{id:'variant-0',label:'720p',width:1280,height:720,bitrate:2000000,fps:60,url:MASTER.replace('master','720'),selectable:true},
      {id:'variant-1',label:'1080p',width:1920,height:1080,bitrate:5000000,fps:60,url:null,selectable:false}] } };
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({TOKEN,BASE}) => {
    window.PalmSystem = { launchParams: JSON.stringify({mode:'native-hls',backendURL:BASE,apiToken:TOKEN}) };
    // Eventos simulados: validam o código cliente, não reprodução real ou codecs.
    HTMLMediaElement.prototype.load = function () {};
    HTMLMediaElement.prototype.pause = function () { this.testPaused = true; this.dispatchEvent(new Event('pause')); };
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this.testPaused !== false;}});
    HTMLMediaElement.prototype.play = function () {
      this.testPaused = false;
      queueMicrotask(() => { this.dispatchEvent(new Event('loadedmetadata')); this.dispatchEvent(new Event('playing')); });
      return Promise.resolve();
    };
  }, {TOKEN,BASE});
  await page.route(BASE + '/api/streams/**', route => route.fulfill({json:payload(),headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto('/');
  await expect(page).toHaveURL(/native-hls.html$/);
});
async function start(page) { await page.locator('#channel').fill('yoda'); await page.keyboard.press('Enter'); await expect(page.locator('video')).toHaveCount(1); await expect(page.locator('#notice')).toBeHidden(); }
async function back(page) { await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:461,bubbles:true,cancelable:true}))); }

test('inicializa vídeo nativo com autenticação só no backend e usa Auto', async ({ page }) => {
  let authorization;
  await page.route(BASE+'/api/streams/**',route => { authorization=route.request().headers().authorization; return route.fulfill({json:payload(),headers:{'Access-Control-Allow-Origin':'*'}}); });
  await start(page);
  expect(authorization).toBe('Bearer '+TOKEN);
  await expect(page.locator('video')).toHaveAttribute('src',MASTER);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(()=>window.KickNativeDiagnostics.snapshot().quality)).toBe('auto');
  await expect(page.locator('#native-playback')).toHaveAttribute('data-view-mode','fullscreen');
  await expect(page.locator('video')).toHaveCSS('width','1920px');
});

test('troca qualidade real, bloqueia variante com áudio externo e libera vídeo anterior', async ({ page }) => {
  await start(page);
  await page.locator('video').evaluate(video=>{window.previousVideo=video;});
  await action(page,0);
  await expect(page.locator('#native-quality-menu button').last()).toBeDisabled();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#native-quality')).toHaveText('Qualidade: 720p');
  expect(await page.evaluate(()=>!window.previousVideo.isConnected && !window.previousVideo.hasAttribute('src') && window.previousVideo.paused)).toBe(true);
  expect(await page.evaluate(()=>window.KickNativeDiagnostics.snapshot().nominal_bitrate)).toBe(2000000);
  await expect(page.locator('video')).toHaveCount(1);
});

test('buffering é removido ao continuar ou pausar, sem confundir pausa com espera', async ({ page }) => {
  await start(page);
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('waiting')));
  await expect(page.locator('#notice')).toContainText('Carregando vídeo');
  await page.locator('video').evaluate(v=>v.pause());
  await expect(page.locator('#notice')).toBeHidden();
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('waiting')));
  await expect(page.locator('#notice')).toBeHidden();
  await page.locator('video').evaluate(v=>v.play());
  await expect(page.locator('#notice')).toBeHidden();
});

test('erro do vídeo libera recursos e apresenta mensagem compreensível', async ({ page }) => {
  await start(page);
  await page.locator('video').evaluate(v=>{Object.defineProperty(v,'error',{value:{code:3}}); v.dispatchEvent(new Event('error'));});
  await expect(page.locator('#message')).toContainText('decodificar');
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>window.KickNativeDiagnostics.snapshot())).toBeNull();
});

test('offline explícito é distinto de acesso negado', async ({ page }) => {
  await page.route(BASE+'/api/streams/**',route=>route.fulfill({json:{channel:'yoda',online:false,playback:null},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.locator('#channel').fill('yoda'); await page.keyboard.press('Enter');
  await expect(page.locator('#message')).toContainText('offline');
  await page.route(BASE+'/api/streams/**',route=>route.fulfill({status:403,json:{error:{code:'upstream_access_denied'},online:null},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.keyboard.press('Enter');
  await expect(page.locator('#message')).toContainText('recusou o acesso');
  await expect(page.locator('video')).toHaveCount(0);
});

test('timeout e retorno cancelam requisição; resposta tardia não abre vídeo', async ({ page }) => {
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.route(BASE+'/api/streams/**',()=>{});
  await page.locator('#channel').fill('yoda'); await page.keyboard.press('Enter');
  await page.clock.runFor(12000);
  await expect(page.locator('#message')).toContainText('cancelada ou expirada');
  await page.keyboard.press('Enter'); await back(page);
  await page.clock.runFor(60000);
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
});

test('alternância para iframe preserva modo padrão sem loop e encerra vídeo', async ({ page }) => {
  await page.route('https://player.kick.com/**',route=>route.fulfill({contentType:'text/html',body:'Embed simulado'}));
  await start(page);
  await action(page,2);
  await expect(page.locator('iframe')).toHaveAttribute('src',/player.kick.com\/yoda/);
  await expect(page.locator('video')).toHaveCount(0);
});

test('URL/credenciais de mídia inválidas são rejeitadas e logs locais não contêm tokens', async ({ page }) => {
  const logs=[]; page.on('console',msg=>logs.push(msg.text()));
  const data=payload(); data.playback.url='https://user:password@cdn.test/video.m3u8';
  await page.route(BASE+'/api/streams/**',route=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.locator('#channel').fill('yoda'); await page.keyboard.press('Enter');
  await expect(page.locator('#message')).toContainText('sem credenciais');
  expect(logs.filter(s=>s.startsWith('[KickLeaf native]')).join('\n')).not.toMatch(/FAKE_TOKEN|password|test-token|https:\/\//);
});

test('OSD usa dois segundos de apresentação, respeita o foco e persiste a preferência', async ({ page }) => {
  const requests=[];
  page.on('request', request=>{if (!request.url().startsWith('http://127.0.0.1:18765')) requests.push(request.url());});
  await page.clock.install();
  await page.clock.pauseAt(Date.now()+1000);
  await start(page);
  const osd=page.locator('#stream-info');
  const video=page.locator('video');
  const toggle=page.locator('#native-info');
  await page.evaluate(()=>document.getElementById('native-theater').click());
  const initialBounds=await video.boundingBox();
  const metadata=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kicktv-stream-info',{
    detail:{channel:'yoda',info:{title:'عنوان طويل للبث المباشر '.repeat(24),viewers:12562,category:'IRL'}}
  })));
  await expect(osd).toBeVisible();
  await expect(osd.locator('[data-info=category-line]')).toBeHidden();
  await expect(osd).toHaveCSS('pointer-events','none');
  await page.clock.runFor(1000);
  await metadata();
  await expect(osd.locator('[data-info=viewer-count]')).toHaveText('12.562');
  await page.clock.runFor(980);
  await expect(osd).toHaveAttribute('aria-hidden','false');
  await page.clock.runFor(80);
  await expect(osd).toHaveAttribute('aria-hidden','true');
  await expect(osd).toBeHidden();
  await metadata();
  await expect(osd).toBeHidden();
  expect(await video.boundingBox()).toEqual(initialBounds);

  const beforeControls=requests.length;
  await page.keyboard.press('Enter');
  await expect(osd).toBeVisible();
  const infoBounds=await osd.boundingBox();
  const barBounds=await page.locator('#native-controls').boundingBox();
  expect(infoBounds.y).toBe(initialBounds.y);
  expect(infoBounds.y+infoBounds.height).toBeLessThanOrEqual(barBounds.y);
  await expect(osd).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(osd.locator('[data-info=title]')).toHaveCSS('white-space','normal');
  const gradients=await page.evaluate(()=>['#stream-info','#native-controls'].map(selector=>
    getComputedStyle(document.querySelector(selector),'::before').backgroundImage));
  expect(gradients[0]).toMatch(/^linear-gradient\(rgba/);
  expect(gradients[1]).toContain('to top');
  const gradientStyles=await page.evaluate(()=>['#stream-info','#native-controls'].map(selector=>{
    const css=getComputedStyle(document.querySelector(selector),'::before');
    return [parseFloat(css.height),css.backgroundImage.includes('rgba(0, 0, 0, 0.6)')];
  }));
  expect(gradientStyles).toEqual([[162,true],[162,true]]);
  const title=osd.locator('[data-info=title]');
  const audience=osd.locator('[data-info=viewers]');
  await expect(title).toHaveCSS('direction','rtl');
  await expect(title).toHaveText('عنوان طويل للبث المباشر '.repeat(24).trim());
  const titleBounds=await title.boundingBox();
  const audienceBounds=await audience.boundingBox();
  expect(titleBounds.height).toBeGreaterThan(100);
  expect(titleBounds.x+titleBounds.width).toBeLessThan(audienceBounds.x);
  expect(audienceBounds.x+audienceBounds.width).toBeCloseTo(initialBounds.width*.96, 0);
  await expect(osd.locator('[data-info=category-line]')).toHaveText('em IRL');
  await expect(osd.locator('[data-info=category]')).toHaveCSS('text-decoration-line','underline');
  await expect(osd.locator('[data-info=viewer-label]')).toHaveText('espectadores');
  expect(infoBounds.x+infoBounds.width).toBeLessThanOrEqual(initialBounds.width);
  await expect(page.locator('#native-settings')).toBeFocused();
  const full=page.locator('#native-fullscreen');
  const chat=page.locator('#native-theater');
  await expect(chat.locator('img')).toHaveAttribute('src','phosphor-chat-centered-text.svg');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(full.locator('img')).toHaveAttribute('src','phosphor-corners-in.svg');
  await expect(chat.locator('img')).toHaveAttribute('src','phosphor-chat-centered-slash.svg');
  await expect(osd).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(full.locator('img')).toHaveAttribute('src','phosphor-corners-out.svg');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(toggle).toBeFocused();
  const circle=await toggle.evaluate(button=>{
    const css=getComputedStyle(button,'::before');
    return [css.width,css.height,css.borderRadius,css.backgroundColor,css.transitionDuration];
  });
  expect(circle).toEqual(['46px','46px','50%','rgba(83, 252, 24, 0.18)','0.15s']);
  await expect(osd.locator('[data-info=viewer-count]')).toBeVisible();
  await expect(toggle).toHaveCSS('box-shadow','none');
  await expect(toggle).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(toggle).toHaveCSS('outline-style','none');
  await expect(toggle.locator('img')).toHaveCSS('filter','url("#player-icon-focus")');
  await expect(chat.locator('img')).toHaveCSS('filter','none');
  await expect(toggle.locator('img')).toHaveAttribute('src','phosphor-info-fill.svg');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await expect(toggle.locator('img')).toHaveAttribute('src','phosphor-info.svg');
  expect(await osd.getAttribute('hidden')).not.toBeNull();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(osd).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(osd).toBeHidden();
  expect(requests).toHaveLength(beforeControls);

  await page.reload();
  await start(page);
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await expect(osd).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(osd).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(osd).toBeVisible();
  await back(page);
  await back(page);
  expect(await osd.getAttribute('hidden')).not.toBeNull();
  await expect(page.locator('#home')).toBeVisible();
});

test('interações na barra renovam a inatividade do OSD nos dois modos', async ({page})=>{
  await page.clock.install();
  await page.clock.pauseAt(Date.now()+1000);
  await start(page);
  const osd=page.locator('#stream-info');
  await page.keyboard.press('Enter');
  for(const mode of ['theater','fullscreen']){
    await page.locator('#native-fullscreen').click();
    await expect(page.locator('#native-playback')).toHaveAttribute('data-view-mode',mode);
    for(let i=0;i<4;i++){
      await page.clock.runFor(1500);
      await page.keyboard.press('ArrowLeft');
      await expect(osd).toHaveAttribute('aria-hidden','false');
    }
    await page.clock.runFor(2300);
    await expect(osd).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(osd).toBeVisible();
  }
  await page.locator('#native-info').click();
  await page.keyboard.press('ArrowRight');
  await expect(osd).toBeHidden();
});
