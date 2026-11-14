const { expect } = require('@playwright/test');

async function openSettings(page, prefix = 'native') {
  const panel = page.locator('#' + prefix + '-settings-panel');
  if (!await panel.isVisible()) {
    const gear = page.locator('#' + prefix + '-settings');
    if (!await gear.evaluate(el => el === document.activeElement)) await page.keyboard.press('ArrowRight');
    if (!await gear.evaluate(el => el === document.activeElement)) await page.keyboard.press('ArrowRight');
    if (!await gear.evaluate(el => el === document.activeElement)) await page.keyboard.press('ArrowRight');
    await expect(gear).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(panel).toBeVisible();
}

async function action(page, index, prefix = 'native') {
  await openSettings(page, prefix);
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
module.exports = { openSettings, action };
