/* Recebe metadados privados via stdin; grava somente observações sem URLs. */
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('@playwright/test');
(async () => {
  const payload=JSON.parse(fs.readFileSync(0,'utf8'));
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    const network=[];
    let corsError=false;
    page.on('console',msg=>{if(msg.type()==='error' && /CORS|cross-origin/i.test(msg.text())) corsError=true;});
    page.on('response',response=>{
      const host=new URL(response.url()).hostname;
      if (!host.endsWith('.live-video.net') && host!=='devstreaming-cdn.apple.com' && host!=='stream.kick.com') return;
      const headers=response.headers();
      network.push({status:response.status(),has_cors:!!headers['access-control-allow-origin'],allows_file_origin:['*','null'].includes(headers['access-control-allow-origin']),hls_mime:/mpegurl/i.test(headers['content-type']||'')});
    });
    await page.addInitScript(() => { window.PalmSystem={launchParams:JSON.stringify({mode:'native-hls',backendURL:'http://127.0.0.1:8766',apiToken:'probe-local-only-'+'x'.repeat(32)})}; });
    await page.route('http://127.0.0.1:8766/api/streams/**',route=>route.fulfill({json:payload,headers:{'Access-Control-Allow-Origin':'null','Access-Control-Allow-Headers':'Authorization','Access-Control-Allow-Methods':'GET'}}));
    await page.goto(pathToFileURL(path.resolve('app/native-hls.html')).href);
    const support=await page.evaluate(()=>document.createElement('video').canPlayType('application/vnd.apple.mpegurl'));
    await page.locator('#channel').fill(payload.channel);
    await page.locator('#watch').click();
    await page.waitForTimeout(5000);
    const first=await page.evaluate(()=>{const v=document.querySelector('video');return v?v.currentTime:null;});
    await page.waitForTimeout(3000);
    const observation=await page.evaluate(()=>{
      const v=document.querySelector('video');
      return {snapshot:window.KickNativeDiagnostics.snapshot(),time:v?v.currentTime:null,error_message:document.getElementById('message').textContent};
    });
    await page.keyboard.press('Escape');
    console.log(JSON.stringify({environment:'Playwright Chromium Linux, não webOS',backend_http_transport:'simulado com metadados reais da descoberta',hls_network:'CDN real; sem proxy',can_play_hls:support,first_time:first,later_time:observation.time,time_advanced:first!==null&&observation.time>first,snapshot:observation.snapshot,error_message:observation.error_message,network,cors_error_observed:corsError,media_released:await page.locator('video').count()===0}));
  } finally {await browser.close();}
})().catch(()=>{console.error('Falha no diagnóstico nativo; detalhes sensíveis omitidos.');process.exitCode=1;});
