const { test, expect } = require('@playwright/test');


test('shared CSS shows pending names, deduplicates IDs, and releases its rules', async ({ page }) => {
  await page.route('https://files.kick.com/emotes/9001/fullsize', route => route.fulfill({
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'), contentType: 'image/gif'
  }));
  await page.route('https://files.kick.com/emotes/9002/fullsize', route => route.abort());
  await page.goto('/native-hls.html');
  const pending = await page.evaluate(() => {
    const row = document.createElement('div');
    row.id = 'emote-test-row';
    document.body.appendChild(row);
    window.releaseTestEmotes = KickEmotes.mount(row, '[emote:9001:One] [emote:9001:Alias] [emote:9002:Missing]');
    return row.textContent;
  });
  expect(pending).toBe('[emote:One] [emote:Alias] [emote:Missing]');
  const tiles = page.locator('#emote-test-row .chat-emote-lazy-css-9001');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.first()).toHaveAttribute('aria-label', '[emote:One]');
  await expect(tiles.last()).toHaveAttribute('aria-label', '[emote:Alias]');
  await expect(tiles.first()).toHaveCSS('background-image', 'url("https://files.kick.com/emotes/9001/fullsize")');
  await expect(tiles.first()).toHaveCSS('width', '28px');
  await expect(page.locator('#emote-test-row')).toContainText('[emote:Missing]');
  await expect.poll(() => page.evaluate(() => KickEmotes.snapshot().counts.lazy_css_failed)).toBe(1);
  const counts = await page.evaluate(() => {
    window.releaseTestEmotes();
    KickEmotes.destroy();
    return KickEmotes.snapshot().counts;
  });
  expect(counts.lazy_css_loads).toBe(2);
  expect(counts.lazy_css_ready).toBe(1);
  expect(counts.lazy_css_ids).toBe(0);
  expect(counts.lazy_css_dom_emotes).toBe(0);
  await expect(tiles.first()).toHaveCSS('background-image', 'none');
});
