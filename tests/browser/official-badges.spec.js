const {test,expect}=require('@playwright/test');
const {badgeSet}=require('../../service/badges');


test('remote CSS counts validated badges on attached rows and reuses the rule', async ({page}) => {
 const url = 'https://files.kick.com/synthetic-badge.png';
 await page.route(url, route => route.fulfill({
  body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),
  contentType: 'image/gif',
  headers: {'access-control-allow-origin':'*'}
 }));
 await page.goto('/native-hls.html');
 await page.evaluate(url => {
  const row = document.createElement('div');
  row.id = 'remote-badge-css-test';
  const badge = {kind:'v2',url,label:'Distintivo remoto'};
  KickBadges.mount(row, [badge, badge], 'css');
  document.body.appendChild(row);
  KickBadges.mount(document.createElement('div'), [badge], 'css');
 }, url);
 const badges = page.locator('#remote-badge-css-test .chat-badge-remote-0');
 await expect(badges).toHaveCount(2);
 await expect(badges.first()).toHaveCSS('background-image', /^url\("blob:/);
 const counts = await page.evaluate(() => KickBadges.snapshot().counts);
 expect(counts.effective_remote).toBe(2);
 expect(counts.requests).toBe(1);
 await page.evaluate(() => KickBadges.clear());
 await expect(badges.first()).toHaveCSS('background-image', 'none');
});

test('local CSS badges reuse one rule and preserve the icon and accessible label', async ({page}) => {
 await page.goto('/native-hls.html');
 await page.evaluate(() => {
  const row = document.createElement('div');
  row.id = 'badge-css-test';
  document.body.appendChild(row);
  const badge = {kind:'legacy',icon:'ModeratorBadge',label:'Moderador'};
  KickBadges.mount(row, [badge, badge], 'css');
  KickBadges.mount(row, [badge]);
 });
 const row = page.locator('#badge-css-test');
 const cssBadges = row.locator('span[role=img][aria-label=Moderador]');
 await expect(cssBadges).toHaveCount(2);
 await expect(cssBadges.first()).toHaveCSS('background-image', /badge-icons\/ModeratorBadge\.svg/);
 await expect(cssBadges.first()).toHaveCSS('width', '20px');
 await expect(row.locator('img[alt=Moderador]')).toHaveCount(1);
 const rules = await page.evaluate(() => Array.from(document.styleSheets)
  .flatMap(sheet => Array.from(sheet.cssRules)).filter(rule => rule.selectorText === '.chat-badge-icon-ModeratorBadge').length);
 expect(rules).toBe(1);
});
test('official local badges decode at chat size without CDN requests',async({page})=>{
 const external=[];await page.route(/^https?:\/\/(?:files|ext\.cdn)\.kick\.com\//,r=>{external.push(r.request().url());return r.abort();});
 await page.goto('/native-hls.html');
 const identities=['moderator','subscriber','vip','og','verified','bot','broadcaster','founder','staff','sidekick','chat_identity','trainwreckstv'].map(type=>({badges:[{type}]}));
 for(const count of [1,5,10,25,50,100,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000,2000,3000,4000,5000])identities.push({badges:[{type:'sub_gifter',count}]});
 for(let level=1;level<=99;level++)identities.push({badges_v2:[{name:'level',selected:true,metadata:{level}}]});
 await page.evaluate(sets=>{const parent=document.getElementById('chat-messages');sets.forEach(badgeSet=>KickBadges.mount(parent,KickBadges.select({badgeSet})));},identities.map(badgeSet));
 await expect(page.locator('.chat-badge')).toHaveCount(139);
 await expect.poll(()=>page.locator('.chat-badge').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0&&img.width===20&&img.height===20))).toBe(true);
 expect(await page.locator('.chat-badge').evaluateAll(imgs=>imgs.every(img=>getComputedStyle(img).filter==='none'))).toBe(true);
 await page.evaluate(badgeSet=>KickBadges.mount(document.getElementById('chat-messages'),KickBadges.select({badgeSet})),badgeSet({badges:[{type:'unknown_synthetic'}]}));
 await expect(page.locator('.chat-badge-fallback')).toHaveCount(1);
 await expect(page.locator('.chat-badge-fallback')).toHaveCSS('filter','invert(1)');
 expect(external).toEqual([]);
 expect(await page.evaluate(()=>KickBadges.snapshot().counts.local_v2_rendered)).toBe(99);
});
