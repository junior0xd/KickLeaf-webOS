const {test,expect}=require('@playwright/test');
const listing='https://web.kick.com/api/v1/livestreams?';
const playback='https://test.playback.live-video.net/master.m3u8';
const headers={'Access-Control-Allow-Origin':'*'};
const items=(start,count)=>Array.from({length:count},(_,index)=>{
  const id=start+index;
  return {id:'stream-'+id,title:'Transmissão '+id+' '+('título longo '.repeat(30)),
    channel:{id,slug:'canal'+id,username:'Canal '+id},category:{id:15,name:'Conversas'},
    thumbnail:{src:'https://images.kick.com/large.webp',
      srcset:'https://images.kick.com/small.webp 480w, https://images.kick.com/large.webp 1280w'},
    viewer_count:id===1?0:500-id,show_view_count:id!==2};
});
const directory=(livestreams,next_cursor)=>({data:{livestreams,pagination:{next_cursor}}});
async function configure(page) {
  await page.addInitScript(()=>{
    window.PalmSystem={launchParams:JSON.stringify({experimentalDiscovery:true})};
    HTMLMediaElement.prototype.load=function(){};
    HTMLMediaElement.prototype.pause=function(){};
    HTMLMediaElement.prototype.play=function(){queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();};
  });
  await page.route('https://kick.com/api/v2/channels/**',r=>r.fulfill({headers,json:{data:{id:999,playback_url:playback,viewers:7}}}));
  await page.route('https://test.playback.live-video.net/**',r=>r.fulfill({headers,body:'#EXTM3U\n#EXTINF:5,\nchunk.ts\n'}));
  await page.route('https://images.kick.com/**',r=>r.fulfill({status:404}));
}
test('grade mantém quatro colunas, carrega variantes sob demanda e restaura seleção',async({page})=>{
  await configure(page);
  const queries=[],images=[];
  page.on('request',r=>{if(r.url().startsWith('https://images.kick.com/'))images.push(r.url());});
  await page.route(listing+'**',r=>{
    const url=new URL(r.request().url());
    queries.push(url.searchParams.get('after'));
    return r.fulfill({headers,json:url.searchParams.has('after')?directory(items(25,24),null):directory(items(1,24),'segunda')});
  });
  await page.goto('/');
  const cards=page.locator('.browse-card');
  await expect(cards).toHaveCount(24);
  await expect(page.locator('#watch')).toBeFocused();
  expect(await cards.nth(0).evaluate(el=>el.getBoundingClientRect().top)).toEqual(await cards.nth(3).evaluate(el=>el.getBoundingClientRect().top));
  await expect(cards.nth(0)).toContainText('0 espectadores');
  await expect(cards.nth(1)).not.toContainText('498');
  await expect.poll(()=>images.length).toBeGreaterThan(0);
  expect(images.every(url=>url.endsWith('/small.webp'))).toBe(true);
  expect(queries).toEqual([null]);
  await page.keyboard.press('ArrowDown');
  await expect(cards.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cards.nth(1)).toBeFocused();
  for(let i=0;i<5;i++)await page.keyboard.press('ArrowDown');
  await expect(cards.nth(21)).toBeFocused();
  await expect(cards).toHaveCount(48);
  expect(queries).toEqual([null,'segunda']);
  const scroll=await page.locator('#browse-scroll').evaluate(el=>el.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('video')).toHaveAttribute('src',playback);
  await expect(page.locator('[data-info=name]')).toHaveText('Canal 22');
  await expect(page.locator('[data-info=viewers]')).toHaveText('7 espectadores');
  await expect(page.locator('#browse-grid img[src]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(cards.nth(21)).toBeFocused();
  expect(await page.locator('#browse-scroll').evaluate(el=>el.scrollTop)).toEqual(scroll);
  await expect(cards).toHaveCount(48);
  expect(queries).toEqual([null,'segunda']);
});
test('rede indisponível preserva slug e permite nova tentativa explícita',async({page})=>{
  await configure(page);
  let count=0;
  await page.route(listing+'**',r=>r.fulfill({headers,status:count++===0?503:200,json:directory([],null)}));
  await page.goto('/');
  await expect(page.locator('#browse-retry')).toBeVisible();
  await page.locator('#browse-retry').click();
  await expect(page.locator('#browse-status')).toHaveText('Nenhuma transmissão ao vivo encontrada.');
  await page.locator('#channel').fill('manual');
  await page.keyboard.press('Enter');
  await expect(page.locator('video')).toHaveCount(1);
  expect(count).toBe(2);
});
test('entrada por slug ignora uma listagem que estava pendente',async({page})=>{
  await configure(page);
  let release;
  const wait=new Promise(done=>{release=done;});
  await page.route(listing+'**',async r=>{await wait;await r.fulfill({headers,json:directory(items(1,24),null)}).catch(()=>{});});
  await page.goto('/');
  await expect(page.locator('#browse-status')).toContainText('Carregando');
  await page.locator('#channel').fill('manual');
  await page.keyboard.press('Enter');
  await expect(page.locator('video')).toHaveCount(1);
  release();
  await expect(page.locator('.browse-card')).toHaveCount(0);
  expect(await page.evaluate(()=>KickHomeDiagnostics.snapshot().busy)).toBe(false);
});

test('OK abre card e a negativa de audiência permanece durante atualização do chat',async({page})=>{
  await configure(page);
  await page.route(listing+'**',r=>r.fulfill({headers,json:directory(items(1,3),null)}));
  await page.goto('/');
  const cards=page.locator('.browse-card');
  await expect(cards).toHaveCount(3);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.dispatchEvent('.browse-card:focus','keydown',{key:'Enter',keyCode:13});
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('[data-info=name]')).toHaveText('Canal 2');
  await expect(page.locator('[data-info=viewers]')).toBeHidden();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kicktv-stream-info',{detail:{channel:'canal2',info:{viewers:9}}})));
  await expect(page.locator('[data-info=viewers]')).toBeHidden();
});
