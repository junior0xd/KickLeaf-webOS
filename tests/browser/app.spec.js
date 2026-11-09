const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // O embed remoto é substituído apenas nos testes de interface. Não prova reprodução.
  await page.route('https://player.kick.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body>Embed simulado para teste de interface</body>'
  }));
});

test('campo, setas, OK, tela inteira, Voltar e destruição do iframe', async ({ page }) => {
  await page.goto('/?iframe');
  await expect(page.locator('#channel')).toBeFocused();
  await page.locator('#channel').fill('https://kick.com/XQC');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#watch')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#channel')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const frame = page.locator('iframe');
  await expect(frame).toHaveAttribute('src', 'https://player.kick.com/xqc?autoplay=true&muted=false');
  await expect(page.locator('#home')).toBeHidden();
  await expect(frame).toHaveCSS('width', '1920px');
  await expect(frame).toHaveCSS('height', '1080px');
  await expect.poll(() => page.evaluate(() => document.activeElement.tagName)).toBe('BODY');
  // Tecla real do controle LG.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(frame).toHaveCount(0);
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#channel')).toHaveValue('https://kick.com/XQC');
});

test('entrada inválida apresenta erro sem navegar', async ({ page }) => {
  await page.goto('/?iframe');
  await page.locator('#channel').fill('https://evil.test/xqc');
  await page.keyboard.press('Enter');
  await expect(page.locator('#message')).toContainText('kick.com');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('teclado virtual mantém posse das setas e do primeiro Voltar', async ({ page }) => {
  await page.goto('/?iframe');
  await page.evaluate(() => {
    const event = new Event('keyboardStateChange');
    event.visibility = true;
    document.dispatchEvent(event);
  });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#channel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#message')).toHaveText('');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('keyboardStateChange', { detail: { visibility: false } })));
  await page.keyboard.press('Escape');
  await expect(page.locator('#message')).toContainText('novamente');
});

test('load do iframe não é anunciado como live online ou reprodução confirmada', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  await page.goto('/?iframe');
  await page.locator('#channel').fill('xqc');
  await page.keyboard.press('Enter');
  await expect.poll(() => logs.some(text => text.includes('iframe_load'))).toBe(true);
  expect(logs.some(text => text.includes('desconhecidos'))).toBe(true);
  await expect(page.locator('#notice')).toBeHidden();
});

test('falha observável do frame permite tentar novamente com backoff', async ({ page }) => {
  await page.goto('/?iframe');
  await page.clock.install();
  await page.locator('#channel').fill('xqc');
  await page.keyboard.press('Enter');
  await page.locator('iframe').evaluate(el => el.dispatchEvent(new Event('error')));
  await expect(page.locator('#notice')).toContainText('Tentando novamente');
  await page.clock.runFor(2000);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('#home')).toBeHidden();
});

test('erro nativo HLS mostra mensagem e libera a mídia; Voltar funciona', async ({ page }) => {
  await page.route('https://devstreaming-cdn.apple.com/**', route => route.abort());
  await page.goto('/hls-test.html');
  await page.keyboard.press('Enter');
  await expect(page.locator('#message')).toContainText(/Não foi possível|Falha de rede|indisponível/);
  await expect(page.locator('#video')).not.toHaveAttribute('src');
  await expect(page.locator('#start')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#channel')).toBeVisible();
});

test('parâmetro de abertura inicia diagnóstico HLS, sem opção extra na interface', async ({ page }) => {
  await page.addInitScript(() => { window.PalmSystem = { launchParams: '{"mode":"hls-test"}' }; });
  await page.goto('/');
  await expect(page).toHaveURL(/hls-test.html$/);
  await expect(page.locator('#start')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/index.html\?home$/);
  await expect(page.locator('#channel')).toBeVisible();
});

test('captura da tela inicial', async ({ page }) => {
  await page.goto('/?iframe');
  await page.screenshot({ path: 'docs/evidence/tela-inicial.png' });
});
