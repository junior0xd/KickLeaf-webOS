/* Diagnóstico manual opcional. Navega somente no app e no embed oficial.
 * Não extrai URLs HLS, tokens, cookies nem inspeciona endpoints privados.
 * A automação pode observar frames; o app NÃO possui esse acesso cross-origin.
 */
const { chromium } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { normalizeChannel } = require('../app/channel');

(async () => {
  const channel = normalizeChannel(process.argv[2] || 'xqc');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const statuses = {};
    page.on('response', response => {
      const host = new URL(response.url()).hostname;
      if (host !== 'player.kick.com') return;
      const key = host + ' ' + response.status();
      statuses[key] = (statuses[key] || 0) + 1;
    });
    await page.goto(pathToFileURL(path.resolve('app/index.html')).href);
    await page.locator('#channel').fill(channel);
    await page.locator('#watch').click();
    await page.waitForTimeout(20000);
    const frame = page.frames().find(item => item.url().startsWith('https://player.kick.com/'));
    const observation = frame ? await frame.evaluate(() => {
      const video = document.querySelector('video');
      return {
        hasVideo: !!video,
        paused: video ? video.paused : null,
        readyState: video ? video.readyState : null,
        currentTime: video ? video.currentTime : null,
        mediaErrorCode: video && video.error ? video.error.code : null,
        offlineText: /offline|off-line|not live/i.test(document.body.innerText),
        challengeText: /verify you are human|just a moment|verifique.*humano/i.test(document.body.innerText)
      };
    }) : { hasFrame: false };
    await page.waitForTimeout(3000);
    const laterTime = frame ? await frame.evaluate(() => {
      const video = document.querySelector('video');
      return video ? video.currentTime : null;
    }) : null;
    await page.screenshot({ path: 'docs/evidence/embed-' + channel + '.png', timeout: 10000 });
    const parentFocus = await page.evaluate(() => document.activeElement.tagName);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
    const returnedHomeAfterBack = await page.locator('#home').isVisible() && await page.locator('iframe').count() === 0;
    const result = {
      date: new Date().toISOString(),
      environment: 'Playwright Chromium desktop Linux; página local file://; NÃO é webOS',
      channel, statuses, observation, laterTime,
      timeAdvanced: observation.currentTime !== null && laterTime > observation.currentTime,
      parentFocus, returnedHomeAfterBack,
      limitation: 'Observação pontual. Não prova compatibilidade na TV nem consulta de status pela API oficial.'
    };
    fs.writeFileSync('docs/evidence/embed-browser-' + channel + '.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(() => {
  console.error('Falha no diagnóstico do embed. Verifique rede e instalação do Chromium.');
  process.exitCode = 1;
});
