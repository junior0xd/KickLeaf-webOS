const {test,expect}=require('@playwright/test');
const listing='https://web.kick.com/api/v1/livestreams?';
const playback='https://test.playback.live-video.net/master.m3u8';
const headers={'Access-Control-Allow-Origin':'*'};
const items=(start,count)=>Array.from({length:count},(_,index)=>{
  const id=start+index;
  return {id:'stream-'+id,title:'Transmissão '+id+' '+('título longo '.repeat(30)),
    channel:{id,slug:'canal'+id,username:'Canal '+id,profile_pic:`https://images.kick.com/avatar-${id}.webp`},
    category:id===3 ? null : {id:15,name:'Conversas'},
    thumbnail:{src:`https://images.kick.com/thumb-${id}-1280.webp`,
      srcset:`https://images.kick.com/thumb-${id}-480.webp 480w, https://images.kick.com/thumb-${id}-1280.webp 1280w`},
    viewer_count:id===1 ? 1200 : id===3 ? 0 : 500-id,show_view_count:id!==2};
});
const directory=(livestreams,next_cursor)=>({data:{livestreams,pagination:{next_cursor}}});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2FcAAAAASUVORK5CYII=','base64');
async function configure(page,listingEnabled=true) {
  await page.addInitScript(listingEnabled=>{
    if (listingEnabled) localStorage.setItem('kickleaf.liveListingEnabled','true');
    HTMLMediaElement.prototype.load=function(){};
    HTMLMediaElement.prototype.pause=function(){};
    HTMLMediaElement.prototype.play=function(){queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();};
  },listingEnabled);
  await page.route('https://kick.com/api/v2/channels/**',r=>r.fulfill({headers,json:{data:{id:999,playback_url:playback,viewers:7}}}));
  await page.route('https://test.playback.live-video.net/**',r=>r.fulfill({headers,body:'#EXTM3U\n#EXTINF:5,\nchunk.ts\n'}));
  await page.route('https://images.kick.com/**',r=>r.fulfill({contentType:'image/png',body:pixel}));
}
async function press(page,key,count) {
  for(let i=0;i<count;i++) await page.keyboard.press(key);
}

test('cinco cards por grupo, tráfego sob demanda e restauração da live selecionada',async({page},testInfo)=>{
  await configure(page);
  const queries=[],images=[];
  page.on('request',r=>{
    if(r.url().startsWith('https://images.kick.com/')) images.push(new URL(r.url()).pathname);
  });
  await page.route(listing+'**',r=>{
    const url=new URL(r.request().url());
    queries.push(Object.fromEntries(url.searchParams));
    return r.fulfill({headers,json:url.searchParams.has('after')?
      directory([...items(24,1),...items(25,3)],null):directory(items(1,24),'segunda')});
  });
  await page.goto('/');
  const cards=page.locator('.browse-card');
  const firstSlug=slug=>expect(cards.first()).toHaveAttribute('data-slug',slug);
  await expect(cards).toHaveCount(5);
  await expect(page.locator('#home-start')).toBeFocused();
  await expect(page.locator('#home-events')).toBeHidden();
  await expect(page.locator('#home-promotion')).toBeHidden();
  await expect(page.locator('#home-recent')).toBeHidden();
  await expect(page.locator('#browse-next')).toBeVisible();
  const bounds=await cards.evaluateAll(nodes=>nodes.map(node=>{
    const {x,right,y,width,height}=node.getBoundingClientRect();
    return {x,right,y,width,height};
  }));
  expect(bounds.every(card=>card.x>0 && card.right<1920 && card.y===bounds[0].y && card.height===bounds[0].height)).toBe(true);
  expect(Math.max(...bounds.map(card=>card.width))-Math.min(...bounds.map(card=>card.width))).toBeLessThan(1);
  const thumbnail=await cards.first().locator('.browse-thumbnail').boundingBox();
  expect(thumbnail.width/thumbnail.height).toBeCloseTo(16/9,2);
  await expect(cards.first().locator('.browse-live')).toHaveText('1,2 mil');
  await expect(cards.nth(1).locator('.browse-live')).toHaveText('Ao vivo');
  await expect(cards.nth(2).locator('.browse-live')).toHaveText('0');
  const title=cards.first().locator('.browse-title');
  await expect(title).toHaveAttribute('title',items(1,1)[0].title.trim());
  await expect(title).toHaveCSS('white-space','nowrap');
  await expect(title).toHaveCSS('text-overflow','ellipsis');
  expect(await title.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await expect.poll(()=>images.length).toBe(10);
  expect(images.every(url=>/^\/(avatar-[1-5]|thumb-[1-5]-480)\.webp$/.test(url))).toBe(true);
  expect(queries).toHaveLength(1);
  expect(queries[0].limit).toBe('24');

  await page.keyboard.press('ArrowDown');
  await expect(cards.first()).toBeFocused();
  for(const first of [6,11,16]) {
    await press(page,'ArrowRight',5);
    await firstSlug('canal'+first);
    await expect(cards.first()).toBeFocused();
    await expect.poll(()=>images.length).toBe((first+4)*2);
    expect(queries).toHaveLength(1);
  }
  await press(page,'ArrowRight',4);
  await expect(cards.last()).toBeFocused();
  // Focusing card 20 still leaves the next network page untouched.
  expect(queries).toHaveLength(1);
  await page.keyboard.press('ArrowRight');
  await firstSlug('canal21');
  await expect(cards.last()).toHaveAttribute('data-slug','canal25');
  await expect(cards.first()).toBeFocused();
  expect(queries.map(query=>query.after)).toEqual([undefined,'segunda']);
  expect(queries[1].limit).toBe('24');
  await expect.poll(()=>images.length).toBe(50);
  await press(page,'ArrowRight',5);
  await firstSlug('canal26');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('#browse-group')).toHaveText('Grupo 6');
  await expect(page.locator('#browse-next')).toBeHidden();
  await expect.poll(()=>images.length).toBe(54);
  await press(page,'ArrowRight',2);
  await expect(cards.last()).toBeFocused();
  await press(page,'ArrowLeft',2);
  await firstSlug('canal21');
  await expect(cards.last()).toBeFocused();
  await expect(page.locator(':focus')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>KickHomeDiagnostics.snapshot().images)).toBe(10);
  expect(images).toHaveLength(54);
  const beforeOpen=images.length;

  await page.keyboard.press('Enter');
  await expect(page.locator('video')).toHaveAttribute('src',playback);
  await expect(page.locator('[data-info=name]')).toHaveText('Canal 25');
  await expect(page.locator('[data-info=viewer-count]')).toHaveText('7');
  await expect(page.locator('#browse-grid img[src]')).toHaveCount(0);
  await page.evaluate(()=>{const now=Date.now(); Date.now=()=>now+61_000;});
  await page.keyboard.press('Escape');
  await expect(cards.last()).toBeFocused();
  await expect(cards.last()).toHaveAttribute('data-slug','canal25');
  await expect(page.locator('#browse-group')).toHaveText('Grupo 5');
  await expect(page.locator('#home-recent')).toContainText('Canal 25');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.recent-card')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cards.last()).toBeFocused();
  expect(queries).toHaveLength(2);
  await expect.poll(()=>page.evaluate(()=>KickHomeDiagnostics.snapshot().images)).toBe(10);
  expect(images).toHaveLength(beforeOpen);
  await testInfo.attach('contagem-de-requisicoes.json',{contentType:'application/json',
    body:JSON.stringify({listagem:queries.length,imagensAteRetornoHorizontal:beforeOpen,imagensIncluindoVoltaDoPlayer:images.length})});
  console.log(`OLED: ${queries.length} listagens, ${beforeOpen} imagens durante a navegação horizontal e ${images.length} incluindo a volta do player.`);
});

test('mantém o grupo visível durante falha, compartilha avanço pendente e tenta novamente',async({page})=>{
  await configure(page);
  const cursors=[];
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  await page.route(listing+'**',async r=>{
    const cursor=new URL(r.request().url()).searchParams.get('after');
    cursors.push(cursor);
    if(cursors.length===2) {
      await pending;
      return r.fulfill({headers,status:503});
    }
    return r.fulfill({headers,json:cursor ? directory(items(25,3),null) : directory(items(1,24),'segunda')});
  });
  await page.goto('/');
  const cards=page.locator('.browse-card');
  await expect(cards).toHaveCount(5);
  await page.keyboard.press('ArrowDown');
  await press(page,'ArrowRight',20);
  await expect(page.locator('#browse-status')).toHaveText('Carregando mais transmissões…');
  expect(cursors).toEqual([null,'segunda']);
  release();
  await expect(page.locator('#browse-retry')).toBeVisible();
  await expect(cards.first()).toHaveAttribute('data-slug','canal16');
  await expect(cards.last()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#browse-retry')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cards.first()).toBeFocused();
  await expect(cards.last()).toHaveAttribute('data-slug','canal25');
  await expect(page.locator('#browse-retry')).toBeHidden();
  expect(cursors).toEqual([null,'segunda','segunda']);
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

test('entrada por slug cancela a listagem pendente e registra o canal acessado',async({page})=>{
  await configure(page);
  let release;
  let calls=0;
  const wait=new Promise(done=>{release=done;});
  await page.route(listing+'**',async r=>{
    if(++calls===1) await wait;
    await r.fulfill({headers,json:directory(items(1,24),null)}).catch(()=>{});
  });
  await page.goto('/');
  await expect(page.locator('#browse-status')).toContainText('Carregando');
  await page.locator('#channel').fill('manual');
  await page.keyboard.press('Enter');
  await expect(page.locator('video')).toHaveCount(1);
  release();
  await expect(page.locator('.browse-card')).toHaveCount(0);
  expect(await page.evaluate(()=>KickHomeDiagnostics.snapshot().busy)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#watch')).toBeFocused();
  await expect(page.locator('.recent-card')).toHaveAttribute('data-slug','manual');
  await expect(page.locator('.browse-card')).toHaveCount(5);
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

test('em 3840 × 2160 os cinco cards cabem e o formulário respeita o teclado da TV',async({page})=>{
  await page.setViewportSize({width:3840,height:2160});
  await configure(page);
  await page.route(listing+'**',r=>r.fulfill({headers,json:directory(items(1,10),null)}));
  await page.goto('/');
  const cards=page.locator('.browse-card');
  await expect(cards).toHaveCount(5);
  for(const card of await cards.all()) await expect(card).toBeInViewport({ratio:1});
  await press(page,'ArrowRight',2);
  await expect(page.locator('#channel')).toBeFocused();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('keyboardStateChange',{detail:{visibility:true}})));
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#channel')).toBeFocused();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('keyboardStateChange',{detail:{visibility:false}})));
  await page.keyboard.press('ArrowDown');
  await expect(cards.first()).toBeFocused();
});

test('estrutura de destaques oculta seções vazias e só permite abrir slugs válidos',async({page})=>{
  await configure(page,false);
  await page.goto('/native-hls.html');
  await page.evaluate(()=>{
    const id=name=>document.getElementById(name);
    const api=KickDiscovery.create({request:async()=>({data:{livestreams:[]}})});
    window.highlightTest=KickDiscoveryHome.create({api,home:id('home'),input:id('channel'),watch:id('watch'),
      open:()=>{id('home').dataset.opened=id('channel').value;}});
    highlightTest.setHighlights({
      banner:{title:'Destaque de teste',slug:'https://invalid.test',image:'https://invalid.test/x'},
      activeEvents:[{title:'Evento de teste',slug:'canal-teste',description:'Descrição',period:'Período'}]
    });
    highlightTest.start.focus();
    highlightTest.resume();
    highlightTest.arrow(40);
  });
  await expect(page.locator('#home-promotion article')).toContainText('Destaque de teste');
  await expect(page.locator('#home-promotion button, #home-promotion img[src]')).toHaveCount(0);
  await expect(page.locator('#home-events button')).toBeFocused();
  await page.evaluate(()=>highlightTest.activate(false));
  await expect(page.locator('#home')).toHaveAttribute('data-opened','canal-teste');
  await page.evaluate(()=>highlightTest.setHighlights());
  await expect(page.locator('#home-promotion')).toBeHidden();
  await expect(page.locator('#home-events')).toBeHidden();
});

test('Ao vivo habilita a listagem sem parâmetros e mantém a escolha após reabrir', async ({page})=>{
  await configure(page,false);
  let calls=0;
  await page.route(listing+'**',r=>{calls++;return r.fulfill({headers,json:directory(items(1,5),null)});});
  await page.goto('/');
  await expect(page.locator('#browse')).toBeHidden();
  expect(calls).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#home-live')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.browse-card')).toHaveCount(5);
  expect(calls).toBe(1);
  await page.goto('/');
  await expect(page.locator('.browse-card')).toHaveCount(5);
  expect(calls).toBe(2);
});
