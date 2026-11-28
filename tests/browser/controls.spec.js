const { test, expect } = require('@playwright/test');
const { openSettings } = require('./helpers/controls');

for (const mode of ['direct-hls', 'iframe']) {
  test.describe('barra compacta: ' + mode, () => {
    const prefix = mode === 'iframe' ? 'player' : 'native';
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mode => {
        window.PalmSystem = { launchParams: JSON.stringify({ mode }) };
        HTMLMediaElement.prototype.load = function () {};
        HTMLMediaElement.prototype.pause = function () {};
        HTMLMediaElement.prototype.play = function () {
          queueMicrotask(() => this.dispatchEvent(new Event('playing')));
          return Promise.resolve();
        };
      }, mode);
      await page.route('https://kick.com/api/**', r => r.fulfill({
        json: { data: { playback_url: 'https://test.playback.live-video.net/master.m3u8' } },
        headers: { 'Access-Control-Allow-Origin': '*' }
      }));
      await page.route('https://test.playback.live-video.net/**', r => r.fulfill({
        body: '#EXTM3U\n#EXTINF:4,\nsegment.ts', headers: { 'Access-Control-Allow-Origin': '*' }
      }));
      await page.route('https://player.kick.com/**', r => r.fulfill({
        contentType: 'text/html', body: '<body style="background:#ddd">Mídia simulada</body>'
      }));
      await page.goto('/');
      await page.clock.install();
      await page.clock.pauseAt(Date.now() + 1000);
      await page.locator('#channel').fill('yetz');
      await page.locator('#watch').click();
      await expect(page.locator('#notice')).toBeHidden();
    });

    test('pula ações futuras, preserva foco entre painéis e retoma ocultação automática', async ({ page }) => {
      const controls = page.locator('#' + prefix + '-controls');
      const gear = page.locator('#' + prefix + '-settings');
      const panel = page.locator('#' + prefix + '-settings-panel');
      await page.keyboard.press('Enter');
      await expect(gear).toBeFocused();
      await expect(controls.locator('.icon-control:disabled')).toHaveCount(mode === 'iframe' ? 3 : 0);
      if (mode === 'direct-hls') {
        for (const [key,id] of [['ArrowLeft','native-info'],['ArrowLeft','native-theater'],['ArrowLeft','native-play-pause'],['ArrowLeft','native-fullscreen'],['ArrowLeft','native-settings'],['ArrowRight','native-fullscreen'],['ArrowRight','native-play-pause'],['ArrowRight','native-theater'],['ArrowRight','native-info'],['ArrowRight','native-settings']]) {
          await page.keyboard.press(key); await expect(page.locator('#'+id)).toBeFocused();
        }
      } else {
        for (const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Shift+Tab']) { await page.keyboard.press(key);await expect(gear).toBeFocused(); }
      }
      await page.keyboard.press('Enter');
      await expect(gear).toHaveAttribute('aria-expanded', 'true');
      const quality = page.locator(mode === 'iframe' ? '#quality-button' : '#native-quality');
      await expect(quality).toBeFocused();
      await page.clock.runFor(10000);
      await expect(panel).toBeVisible();
      await page.keyboard.press('ArrowUp');
      await expect(page.locator('#' + prefix + '-close-settings')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(quality).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(panel).toBeHidden();
      await page.clock.runFor(10000);
      await expect(page.locator(mode === 'iframe' ? '#quality-menu' : '#native-quality-menu')).toBeVisible();
      const back = () => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, cancelable: true })));
      await back();
      await expect(quality).toBeFocused();
      await back();
      await expect(panel).toBeHidden();
      await expect(gear).toBeFocused();
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
      await page.clock.runFor(4999);
      await expect(controls).toBeVisible();
      await page.clock.runFor(1);
      await expect(controls).toBeHidden();
      await expect(page.locator('body')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(gear).toBeFocused();
      // Closing by OK and by pointer uses the same restoration path.
      await openSettings(page, prefix);
      await page.locator('#' + prefix + '-close-settings').click();
      await expect(gear).toBeFocused();
      await openSettings(page, prefix);
      for (let i = 0; i < (mode === 'iframe' ? 2 : 4); i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(gear).toBeFocused();
    });

    test('SVGs locais carregam e a barra cabe de 720p a 4K sobre o gradiente', async ({ page }) => {
      await page.keyboard.press('ArrowRight');
      const controls = page.locator('#' + prefix + '-controls');
      const images = controls.locator('img');
      await expect(images).toHaveCount(mode === 'direct-hls' ? 6 : 5);
      expect(await images.evaluateAll(imgs => imgs.every(img =>
        img.getAttribute('src').startsWith('phosphor-') && img.complete && img.naturalWidth > 0))).toBe(true);
      for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
        await page.setViewportSize({ width, height });
        for (const button of await controls.locator('.icon-control').all()) {
          const box = await button.boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(56);
          expect(box.height).toBeGreaterThanOrEqual(56);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.y + box.height).toBeLessThanOrEqual(height);
        }
        const gradient = await controls.evaluate(el => {
          const css = getComputedStyle(el, '::before');
          const bar = getComputedStyle(el);
          return { pointer: css.pointerEvents, z: css.zIndex, image: css.backgroundImage,
            width: parseFloat(css.width), bottom: css.bottom, background: bar.backgroundColor };
        });
        expect(gradient.pointer).toBe('none');
        expect(gradient.z).toBe('-1');
        expect(gradient.width).toBe(width);
        expect(gradient.bottom).toBe('0px');
        expect(gradient.background).toBe('rgba(0, 0, 0, 0)');
        expect(gradient.image).toContain('linear-gradient');
        await openSettings(page, prefix);
        const panel = page.locator('#' + prefix + '-settings-panel');
        const box = await panel.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        if (mode === 'direct-hls') await page.screenshot({ path: '.build/controls-panel-' + height + '.png' });
        await page.keyboard.press('Escape');
        if (mode === 'direct-hls') {
          for (const [name, color] of [['light', '#eeeeee'], ['dark', '#181818']]) {
            await page.locator('video').evaluate((el, color) => { el.style.background = color; }, color);
            await page.screenshot({ path: '.build/controls-' + height + '-' + name + '.png' });
          }
        }
      }
      await page.clock.runFor(5000);
      await expect(controls).toBeHidden();
      await expect(page.locator('#' + prefix + '-settings-panel')).toBeHidden();
      if (mode === 'direct-hls') await page.screenshot({ path: '.build/controls-hidden.png' });
    });

    test('volume do controle remoto continua sem interceptação', async ({ page }) => {
      await openSettings(page, prefix);
      const prevented = await page.evaluate(() => [447, 448, 449].map(keyCode => {
        const event = new KeyboardEvent('keydown', { keyCode, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }));
      expect(prevented).toEqual([false, false, false]);
    });
  });
}
