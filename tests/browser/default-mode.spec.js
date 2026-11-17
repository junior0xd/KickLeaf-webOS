const { test, expect } = require('@playwright/test');
const { openSettings } = require('./helpers/controls');

test('abertura sem parâmetros descobre na Kick e inicia vídeo Direct HLS', async ({page}) => {
  const master='https://test.playback.live-video.net/master.m3u8';
  const logs=[];
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
  await expect(page.locator('#official-home')).toHaveCount(0);
  await page.locator('#channel').focus();
  await page.keyboard.press('ArrowDown');await expect(page.locator('#watch')).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(page.locator('#channel')).toBeFocused();
  await page.evaluate(()=>{
    KickNativeAPI.config=()=>{throw new Error('Unexpected backend configuration');};
    KickNativeAPI.resolve=()=>{throw new Error('Unexpected backend request');};
  });
  await page.locator('#channel').fill('yetz');await page.locator('#watch').click();
  await expect(page.locator('video')).toHaveAttribute('src',master);
  await expect(page.locator('#notice')).toBeHidden();
  expect(logs.some(line=>line.includes('mode_selected')&&line.includes('direct-hls'))).toBe(true);
  await page.keyboard.press('Enter');await openSettings(page);
  await page.locator('#official-player').click();
  await expect(page).toHaveURL(/index.html\?iframe&channel=yetz$/);
  await expect(page.locator('#channel')).toHaveValue('yetz');
});

test('parâmetros vazios usam Direct HLS e modo iframe explícito continua disponível', async ({page}) => {
  await page.addInitScript(()=>{window.PalmSystem={launchParams:sessionStorage.getItem('testLaunchParams')||'{}'};});
  await page.goto('/');await expect(page).toHaveURL(/native-hls.html$/);
  await page.evaluate(()=>sessionStorage.setItem('testLaunchParams','{"mode":"iframe"}'));
  await page.goto('/');await expect(page.locator('#channel-form')).toBeVisible();
  await expect(page).not.toHaveURL(/native-hls.html$/);
});
