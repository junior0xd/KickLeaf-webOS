const { test, expect } = require('@playwright/test');
const { openSettings } = require('./helpers/controls');

test('abertura sem parâmetros descobre na Kick e inicia vídeo Direct HLS', async ({page}) => {
  const master='https://test.playback.live-video.net/master.m3u8';
  const logs=[];
  const listing=[];
  page.on('request',r=>{if(r.url().startsWith('https://web.kick.com/api/v1/livestreams')) listing.push(r.url());});
  await page.route('https://player.kick.com/**',route=>route.fulfill({contentType:'text/html',body:'Embed simulado'}));
  page.on('console',message=>logs.push(message.text()));
  await page.addInitScript(()=>{
    HTMLMediaElement.prototype.load=function(){};
    HTMLMediaElement.prototype.pause=function(){};
    HTMLMediaElement.prototype.play=function(){queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();};
  });
  await page.route('https://kick.com/api/v2/channels/yetz/livestream',route=>route.fulfill({json:{data:{playback_url:master}},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route(master,route=>route.fulfill({body:'#EXTM3U\n#EXTINF:4,\nsegment.ts',headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto('/');
  await expect(page).toHaveURL(/native-hls.html$/);
  await expect(page.locator('#home-start')).toBeFocused();
  await expect(page.locator('#home')).toHaveClass(/discovery-home/);
  await expect(page.locator('#browse')).toBeHidden();
  await page.locator('#channel').focus();
  await page.keyboard.press('ArrowDown');await expect(page.locator('#watch')).toBeFocused();
  await page.keyboard.press('ArrowUp');await expect(page.locator('#channel')).toBeFocused();
  await page.evaluate(()=>{
    KickNativeAPI.config=()=>{throw new Error('Unexpected backend configuration');};
    KickNativeAPI.resolve=()=>{throw new Error('Unexpected backend request');};
  });
  await page.locator('#channel').fill('https://kick.com/yetz');await page.locator('#watch').click();
  await expect(page.locator('video')).toHaveAttribute('src',master);
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#native-playback')).toHaveAttribute('data-view-mode','fullscreen');
  await expect(page.locator('#chat-panel')).toBeHidden();
  expect(listing).toEqual([]);
  expect(logs.some(line=>line.includes('mode_selected')&&line.includes('direct-hls'))).toBe(true);
  await page.keyboard.press('Enter');await openSettings(page);
  await page.locator('#official-player').click();
  await expect(page.locator('iframe')).toHaveAttribute('src',/player.kick.com\/yetz/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#watch')).toBeFocused();
  await expect(page.locator('.recent-card')).toHaveAttribute('data-slug','yetz');
});

test('parâmetros vazios usam Direct HLS e modo iframe explícito continua disponível', async ({page}) => {
  await page.addInitScript(()=>{window.PalmSystem={launchParams:sessionStorage.getItem('testLaunchParams')||'{}'};});
  await page.goto('/');await expect(page).toHaveURL(/native-hls.html$/);
  await page.evaluate(()=>sessionStorage.setItem('testLaunchParams','{"mode":"iframe"}'));
  await page.goto('/');await expect(page.locator('#native-form')).toBeVisible();
  await expect(page).toHaveURL(/native-hls.html$/);
});

test('a página que o webOS abre mostra o cabeçalho OLED antes do JavaScript', async ({page}) => {
  const {main}=require('../../app/appinfo.json');
  let release;
  const hold=new Promise(resolve=>{release=resolve;});
  await page.route('**/native-hls.js', async route=>{
    await hold;
    await route.continue();
  });
  try {
    await page.goto('/'+main,{waitUntil:'commit'});
    await expect(page.locator('#home')).toHaveCSS('display','block');
    await expect(page.locator('#home-nav')).toBeVisible();
    await expect(page.locator('#home-brand')).toHaveJSProperty('complete',true);
    expect(await page.locator('#home-brand').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#channel')).toBeVisible();
    expect(await page.evaluate(()=>typeof window.KickHomeDiagnostics)).toBe('undefined');
  } finally {
    release();
  }
  await expect(page.locator('#home-start')).toBeFocused();
});
