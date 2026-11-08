// Optional real-network experiment. No video downloads, cookies, challenge handling,
// signed URLs, response bodies or raw browser errors are written to the evidence.
const { chromium } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeChannel } = require('../app/channel.js');
async function main() {
  const channel = normalizeChannel(process.argv[2] || 'yoda');
  const endpoint = 'https://kick.com/api/v2/channels/' + encodeURIComponent(channel) + '/livestream';
  const result = { date: new Date().toISOString(), channel, physical_tv: false, experiments: [] };
  const server = http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>CORS probe</title>');});
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser = await chromium.launch({headless:true});
    result.chromium = browser.version();
    for(const origin of ['http','file']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let corsConsole = false;
      const statuses = [], headers = [], pendingHeaders = [], sentOrigins = [];
      page.on('request',request=>{
        if(request.url()===endpoint) pendingHeaders.push(request.allHeaders().then(h=>{sentOrigins.push(h.origin || null);}));
      });
      page.on('console', message=>{if(message.type()==='error' && /CORS policy|Access-Control-Allow-Origin/.test(message.text())) corsConsole=true;});
      page.on('response',response=>{
        if(response.url()===endpoint) {
          statuses.push(response.status());
          pendingHeaders.push(response.allHeaders().then(h=>{
            const allow=h['access-control-allow-origin'];
            headers.push({acao:allow==='*'||allow==='null'||allow===new URL(page.url()).origin?allow:(allow?'other':null),vary_origin:!!h.vary&&/origin/i.test(h.vary)});
          }));
        }
      });
      if(origin==='file') await page.goto(pathToFileURL(path.resolve(__dirname,'../app/index.html')).href);
      else await page.goto('http://127.0.0.1:'+server.address().port);
      const observation = await page.evaluate(async endpoint=>{
        const observation={origin:location.origin,protocol:location.protocol};
        try {
          const response=await fetch(endpoint,{credentials:'omit',mode:'cors',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
          observation.http_status=response.status;
          if(response.ok){
            const json=await response.json();
            observation.offline=!!json && json.data===null;
            observation.has_playback_url=!!(json&&json.data&&typeof json.data.playback_url==='string');
          }
          observation.readable=true;
        } catch(error){observation.readable=false;observation.error_name=error.name;}
        return observation;
      },endpoint);
      await Promise.all(pendingHeaders);
      result.experiments.push({...observation,request_origins:sentOrigins,response_cors_headers:headers,observed_http_statuses:statuses,cors_console_error:corsConsole});
      await context.close();
    }
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
  console.log(JSON.stringify(result,null,2));
}
main().catch(()=>{console.error('O experimento não pôde ser executado; nenhum dado de reprodução foi registrado.');process.exitCode=1;});
