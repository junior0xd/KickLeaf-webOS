const { action } = require('./helpers/controls');
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.PalmSystem = { launchParams: '{"mode":"iframe"}' }; });
  await page.route('https://player.kick.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body>Player simulado</body>' }));
  await page.goto('/');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
});

async function start(page) {
  await page.locator('#channel').fill('yoda');
  await page.keyboard.press('Enter');
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('#notice')).toBeHidden();
}
async function frameError(page) {
  await page.locator('iframe').evaluate(frame => frame.dispatchEvent(new Event('error')));
}
async function back(page) {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true, cancelable: true })));
}

test('OK abre a barra e configurações; Voltar restaura o foco antes de sair', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#player-settings')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#quality-button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#quality-menu')).toContainText('não disponibiliza');
  await page.clock.runFor(10000);
  await expect(page.locator('#quality-menu')).toBeVisible();
  await back(page);
  await expect(page.locator('#quality-menu')).toBeHidden();
  await expect(page.locator('#quality-button')).toBeFocused();
  await back(page);
  await expect(page.locator('#player-settings-panel')).toBeHidden();
  await expect(page.locator('#player-settings')).toBeFocused();
  await back(page);
  await expect(page.locator('#player-controls')).toBeHidden();
  await expect(page.locator('iframe')).toHaveCount(1);
  await back(page);
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('controles desaparecem após cinco segundos e setas renovam o prazo', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Enter');
  await page.clock.runFor(4000);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#player-settings')).toBeFocused();
  await page.clock.runFor(4000);
  await expect(page.locator('#player-controls')).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.locator('#player-controls')).toBeHidden();
  await expect(page.locator('body')).toBeFocused();
});

test('recarga manual substitui o iframe e libera callbacks antigos em ciclos repetidos', async ({ page }) => {
  await start(page);
  for (let i = 0; i < 5; i++) {
    await page.locator('iframe').evaluate(frame => { window.previousFrame = frame; });
    await action(page,1,'player');
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => !window.previousFrame.isConnected && window.previousFrame.onload === null && window.previousFrame.onerror === null)).toBe(true);
    await expect(page.locator('#player-controls')).toBeHidden();
  }
});

test('limita a três recuperações com backoff 2/4/8 segundos, mesmo após load', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  await start(page);
  for (const delay of [2000, 4000, 8000]) {
    await page.locator('iframe').evaluate(frame => { window.previousFrame = frame; });
    await frameError(page);
    // Erros duplicados não criam timers adicionais.
    await frameError(page);
    await page.clock.runFor(delay - 1);
    expect(await page.evaluate(() => window.previousFrame.isConnected)).toBe(true);
    await page.clock.runFor(1);
    await expect.poll(() => page.evaluate(() => !window.previousFrame.isConnected)).toBe(true);
    await expect(page.locator('#notice')).toBeHidden(); // load da nova navegação
  }
  await frameError(page);
  await expect(page.locator('#message')).toContainText('três tentativas');
  await expect(page.locator('iframe')).toHaveCount(0);
  const count = logs.filter(line => line.includes('embed_requested')).length;
  await page.clock.runFor(120000);
  expect(logs.filter(line => line.includes('embed_requested')).length).toBe(count);
  expect(count).toBe(4); // tentativa inicial + três automáticas
});

test('Voltar cancela reconexão pendente e listeners de rede não reabrem o player', async ({ page }) => {
  await start(page);
  await frameError(page);
  await back(page);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await page.clock.runFor(120000);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
});

test('queda de rede não reinicia um embed carregado; recuperação aguarda online se houve erro', async ({ page }) => {
  await start(page);
  await page.locator('iframe').evaluate(frame => { window.previousFrame = frame; });
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.clock.runFor(10000);
  await expect(page.locator('#notice')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.clock.runFor(20000);
  expect(await page.evaluate(() => window.previousFrame.isConnected)).toBe(true);
  await frameError(page);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.previousFrame.isConnected)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.clock.runFor(2000);
  await expect.poll(() => page.evaluate(() => !window.previousFrame.isConnected)).toBe(true);
});

test('não interpreta mensagens remotas não documentadas ou pausas como falha', async ({ page }) => {
  await start(page);
  await page.locator('iframe').evaluate(frame => { window.previousFrame = frame; });
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://player.kick.com', data: { type: 'pause', token: 'FAKE_PRIVATE_TOKEN' } }));
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', data: { type: 'error' } }));
  });
  await page.clock.runFor(120000);
  expect(await page.evaluate(() => window.previousFrame.isConnected)).toBe(true);
  await expect(page.locator('#notice')).toBeHidden();
});

test('volume e mute não são interceptados', async ({ page }) => {
  await start(page);
  const results = await page.evaluate(() => [447, 448, 449].map(keyCode => {
    const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  expect(results).toEqual([false, false, false]);
});

test('indicador inicial tem prazo máximo; timeout não inventa buffering nem reinicia', async ({ page }) => {
  await page.route('https://player.kick.com/**', () => {}); // navegação mantida sem resposta
  await page.locator('#channel').fill('minerva');
  await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toBeVisible();
  await page.clock.runFor(6000);
  await expect(page.locator('#notice')).toBeHidden();
  await page.clock.runFor(19000);
  await expect(page.locator('#notice')).toContainText('não foi confirmada');
  await page.clock.runFor(6000);
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('iframe')).toHaveCount(1);
  await back(page);
  await expect(page.locator('#home')).toBeVisible();
});

test('logs não expõem o canal, URL, tokens ou conteúdo de mensagens remotas', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  await start(page);
  await action(page,0,'player');
  await frameError(page);
  expect(logs.some(line => line.includes('capabilities'))).toBe(true);
  expect(logs.join('\n')).not.toMatch(/https:\/\/|yoda|FAKE_PRIVATE_TOKEN|m3u8/);
});

test('ciclos de abertura e recarga não acumulam listeners de rede', async ({ page }) => {
  await page.evaluate(() => {
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.networkListeners = { online: new Set(), offline: new Set() };
    window.addEventListener = (type, listener, options) => {
      if (window.networkListeners[type]) window.networkListeners[type].add(listener);
      add(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (window.networkListeners[type]) window.networkListeners[type].delete(listener);
      remove(type, listener, options);
    };
  });
  for (let i = 0; i < 10; i++) {
    await start(page);
    await action(page,1,'player');
    expect(await page.evaluate(() => [window.networkListeners.online.size, window.networkListeners.offline.size])).toEqual([1, 1]);
    await back(page);
    expect(await page.evaluate(() => [window.networkListeners.online.size, window.networkListeners.offline.size])).toEqual([0, 0]);
    await expect(page.locator('iframe')).toHaveCount(0);
  }
});
