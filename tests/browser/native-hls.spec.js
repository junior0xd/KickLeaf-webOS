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
  await expect(page.locator('video')).toHaveCSS('width','1920px');
});

test('troca qualidade real, bloqueia variante com áudio externo e libera vídeo anterior', async ({ page }) => {
  await start(page);
  await page.locator('video').evaluate(video=>{window.previousVideo=video;});
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
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
  await start(page);
  await page.keyboard.press('ArrowRight'); // qualidade
  await page.keyboard.press('ArrowRight'); // recarregar
  await page.keyboard.press('ArrowRight'); // iframe
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/index.html\?iframe&channel=yoda$/);
  await expect(page.locator('#channel')).toHaveValue('yoda');
  await page.route('https://player.kick.com/**',route=>route.fulfill({contentType:'text/html',body:'<body>iframe simulado</body>'}));
  await page.locator('#watch').click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('video')).toHaveCount(0);
});

test('URL/credenciais de mídia inválidas são rejeitadas e logs locais não contêm tokens', async ({ page }) => {
  const logs=[]; page.on('console',msg=>logs.push(msg.text()));
  const data=payload(); data.playback.url='https://user:password@cdn.test/video.m3u8';
  await page.route(BASE+'/api/streams/**',route=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.locator('#channel').fill('yoda'); await page.keyboard.press('Enter');
  await expect(page.locator('#message')).toContainText('sem credenciais');
  expect(logs.filter(s=>s.startsWith('[KickTV native]')).join('\n')).not.toMatch(/FAKE_TOKEN|password|test-token|https:\/\//);
});
