const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create,normalize,merge,cardInfo,limits} = require('../app/discovery-api');

const entry = (slug,id=slug) => ({id,channel:{id:2,slug,username:'Nome '+slug}});
const response = (items,cursor=null) => ({data:{livestreams:items,pagination:{next_cursor:cursor}}});
const deferred = () => {
  let resolve;
  const promise = new Promise(done=>{resolve=done;});
  return {promise,resolve};
};

test('normaliza dados incompletos, variantes permitidas, contagem zero e horários',()=>{
  const item=normalize({...entry('Canal'),viewer_count:0,show_view_count:false,
    start_time:'2026-11-23 20:00:00',category:{id:15,name:'Conversas'},
    thumbnail:{src:'http://images.kick.com/large.webp',srcset:'https://images.kick.com/big.webp 1024w, https://images.kick.com/small.webp 320w, https://elsewhere.test/x 10w'}
  },null,1);
  assert.equal(item.slug,'canal');
  assert.equal(item.viewers,0);
  assert.equal(item.startedAt,'2026-11-23T20:00:00.000Z');
  assert.equal(item.categoryId,15);
  assert.deepEqual(item.thumbnail.variants.map(v=>v.width),[320,1024]);
  assert.equal(cardInfo(item).viewers,null);
  assert.equal(normalize(entry('https://kick.com/name')),null);
  assert.equal(normalize({...entry('x'),viewer_count:-2,show_view_count:'true'}).viewers,null);
  assert.equal(normalize(entry('x')).title,null);
  assert.equal(normalize(entry('x')).showViewerCount,null);
});

test('complementa a abertura por slug sem descartar campos do catálogo e sem misturar lives distintas',()=>{
  const catalogue=normalize({...entry('abc','uuid'),title:'Catálogo',viewer_count:50,
    show_view_count:false,category:{name:'Conversas'}},null,2);
  const playback=normalize({id:12,viewers:51,session_title:'Atual'},'abc',5);
  const result=merge(catalogue,playback);
  assert.equal(result.name,'Nome abc');
  assert.equal(result.category,'Conversas');
  assert.equal(result.title,'Atual');
  assert.equal(result.viewers,51);
  assert.equal(result.streamId,'uuid');
  assert.equal(cardInfo(result).viewers,null);
  assert.equal(merge(catalogue,normalize(entry('abc','new'),null,6)).title,null);
});

test('página seguinte usa after opaco, deduplica e encerra cursor repetido',async()=>{
  const urls=[];
  const api=create({request:async url=>{
    urls.push(new URL(url));
    return urls.length===1 ? response([entry('a'),entry('b')],'a+/=')
      : response([entry('a'),entry('c','b'),entry('d')],'a+/=');
  }});
  const query=api.query({displayLanguage:'en',language:'pt',categoryId:15});
  assert.equal((await query.next()).items.length,2);
  const page=await query.next();
  assert.deepEqual(page.items.map(item=>item.slug),['d']);
  assert.equal(page.issue,'pagination_stalled');
  assert.equal(page.done,true);
  assert.equal(urls[1].searchParams.get('after'),'a+/=');
  assert.equal(urls[1].searchParams.has('cursor'),false);
  assert.deepEqual(Object.fromEntries(urls[0].searchParams),
    {limit:'24',sort:'viewer_count_desc',display_language:'en',language:'pt',category_id:'15'});
});

test('página idêntica com cursor novo encerra a paginação',async()=>{
  let n=0;
  const api=create({request:async()=>response([entry('a')],String(++n))});
  const query=api.query();
  await query.next();
  assert.deepEqual(await query.next(),{items:[],done:true,issue:'pagination_stalled'});
});

test('deduplica concorrência, reutiliza cache por filtros e expira páginas e canais',async()=>{
  let n=0, clock=0;
  const req=deferred();
  const api=create({now:()=>clock,request:async()=>{n++;return req.promise;}});
  const a=api.query(), b=api.query();
  const pending=a.next();
  assert.equal(a.next(),pending);
  const other=b.next();
  assert.equal(n,1);
  req.resolve(response([entry('a')]));
  await Promise.all([pending,other]);
  await api.query().next();
  assert.equal(n,1);
  await api.query({language:'pt'}).next();
  assert.equal(n,2);
  assert.equal(api.metadata('a').slug,'a');
  clock=limits.ttl;
  assert.equal(api.metadata('a'),null);
  await api.query().next();
  assert.equal(n,3);
});

test('cancelamentos descartam resposta tardia e permitem reiniciar a mesma consulta',async()=>{
  const old=deferred(), fresh=deferred();
  const signals=[];
  const api=create({request:(url,{signal})=>{
    signals.push(signal);
    return signals.length===1 ? old.promise : fresh.promise;
  }});
  const query=api.query();
  const before=query.next();
  api.cancel();
  const after=query.next();
  assert.equal(signals[0].aborted,true);
  fresh.resolve(response([entry('new')]));
  await after;
  old.resolve(response([entry('old')]));
  await assert.rejects(before,{code:'cancelled'});
  assert.equal(api.metadata('old'),null);
  assert.equal(api.metadata('new').slug,'new');
});

test('erro de contrato, lista vazia e Retry-After não iniciam ciclos de tentativas',async()=>{
  let n=0, clock=0;
  const api=create({now:()=>clock,request:async()=>{
    n++;
    if(n===1)return response([{}]);
    if(n===2)throw Object.assign(new Error('limit'),{code:'http_429',retryAfter:'10'});
    return response([]);
  }});
  await assert.rejects(api.query().next(),{code:'invalid_contract'});
  await assert.rejects(api.query().next(),{code:'http_429'});
  clock=9999;
  await assert.rejects(api.query().next(),{code:'http_429'});
  assert.equal(n,2);
  clock=10000;
  assert.deepEqual(await api.query().next(),{items:[],done:true,issue:null});
});

test('transporte comum classifica HTTP, JSON inválido, timeout e falha de rede',async t=>{
  const {request}=require('../app/kick-http');
  const target='https://web.kick.com/api/v1/livestreams';
  const controller=new AbortController();
  let status=400;
  let operation=(_url,options)=>{
    assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');
    return Promise.resolve(new Response('{}',{status,headers:{'Retry-After':'12'}}));
  };
  t.mock.method(globalThis,'fetch',(...args)=>operation(...args));
  const get=()=>request(target,{signal:controller.signal,timeout:30});
  for (const code of [400,401,403,404,429,503]) {
    status=code;
    await assert.rejects(get(),{code:'http_'+code,retryAfter:'12'});
  }
  operation=async()=>new Response('{');
  await assert.rejects(get(),{code:'invalid_json'});
  operation=async()=>{throw new TypeError('fetch failed');};
  await assert.rejects(get(),{code:'network_or_cors'});
  operation=(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  await assert.rejects(get(),{code:'timeout'});
});
