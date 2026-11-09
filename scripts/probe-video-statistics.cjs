// Optional public-network smoke test. No Kick requests or production credentials.
const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await chromium.launch();
  const observation={environment:'Chromium Linux; not webOS TV',source:'Apple public Bip Bop HLS',backend_response:'mocked',media_and_video_events:'real, no media method overrides',physical_tv:false};
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    await page.addInitScript(()=>{window.PalmSystem={launchParams:JSON.stringify({mode:'native-hls',backendURL:'http://127.0.0.1:8766',apiToken:'test-only-'+'x'.repeat(32)})};});
    await page.route('http://127.0.0.1:8766/api/streams/**',r=>r.fulfill({json:{channel:'hls-test',online:true,playback:{type:'hls',live:false,url:'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',qualities:[]}},headers:{'Access-Control-Allow-Origin':'null','Access-Control-Allow-Headers':'Authorization','Access-Control-Allow-Methods':'GET'}}));
    await page.goto(pathToFileURL(path.resolve('app/native-hls.html')).href);
    await page.locator('#channel').fill('hls-test');await page.locator('#watch').click();
    try {
      await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>1;},null,{timeout:20000});
      await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
      const first=await page.locator('video').evaluate(v=>v.currentTime);
      await page.waitForTimeout(3200);
      observation.panel_visible=await page.locator('#video-statistics').isVisible();
      observation.panel_fields=await page.locator('[data-stat]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.stat,n.textContent])));
      observation.snapshot=await page.evaluate(()=>KickNativeDiagnostics.snapshot());
      observation.video_advanced_with_panel=await page.locator('video').evaluate((v,first)=>v.currentTime>first,first);
      await page.keyboard.press('Escape');
      fs.mkdirSync('.build',{recursive:true});
      await page.screenshot({path:'.build/video-statistics-public-preview.png'});
      await page.keyboard.press('ArrowRight');
      await page.locator('#video-statistics-toggle').click();
      observation.panel_disabled=!(await page.locator('#video-statistics').isVisible());
      observation.video_still_playing=await page.locator('video').evaluate(v=>!v.paused&&!v.ended);
      await page.keyboard.press('Escape');await page.keyboard.press('Escape');
      observation.media_released=await page.locator('video').count()===0;
      observation.success=true;
    } catch(error){observation.success=false;observation.failure_type=error.name;observation.snapshot=await page.evaluate(()=>KickNativeDiagnostics.snapshot());}
  } finally {await browser.close();}
  fs.writeFileSync('docs/evidence/video-statistics-public-hls.json',JSON.stringify(observation,null,2)+'\n');
  console.log(JSON.stringify(observation));
  if(!observation.success) process.exitCode=1;
})().catch(()=>{console.error('Public HLS probe failed; raw diagnostics omitted.');process.exitCode=1;});
