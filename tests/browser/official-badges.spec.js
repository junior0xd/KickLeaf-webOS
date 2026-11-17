const {test,expect}=require('@playwright/test');
const {badgeSet}=require('../../service/badges');
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
