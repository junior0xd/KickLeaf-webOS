const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {Protocol}=require('../../service/protocol');const {Metrics}=require('../../service/metrics');const {destination}=require('../../service/config');const {normalize}=require('../../service/normalize');const {Transport}=require('../../service/transport');const {Session}=require('../../service/session');const {HttpClient}=require('../../service/http-client');
const wait=()=>new Promise(r=>setImmediate(r));
function protocol(options={}){const sent=[],events=[],pubs=[],ends=[],metrics=new Metrics();const p=new Protocol({send:(s,phase)=>sent.push({s,phase}),metrics,notify:(k,d)=>events.push({k,d}),onPublication:d=>pubs.push(d),onDisconnect:r=>ends.push(r),timeout:50,...options});return {p,sent,events,pubs,ends,metrics,reply(kind,value={}){const c=JSON.parse(sent.at(-1).s);p.receive(Buffer.from(JSON.stringify({id:c.id,[kind]:value})));}};}
test('destination validation excludes arbitrary hosts, paths, credentials, query, ports and insecure transport',()=>{
 assert.equal(destination('wss://realtime.sa-east-1.platform.kick.com/connection/websocket','wss').protocol,'wss:');
 for(const s of ['ws://realtime.us-east-1.platform.kick.com/connection/websocket','wss://realtime.us-east-1.platform.kick.com.evil/connection/websocket','wss://user@realtime.us-east-1.platform.kick.com/connection/websocket','wss://realtime.us-east-1.platform.kick.com:8080/connection/websocket','wss://realtime.us-east-1.platform.kick.com/connection/websocket?token=x','wss://localhost/connection/websocket'])assert.throws(()=>destination(s,'wss'));
 assert.throws(()=>destination('https://kick.com/api/v2/messages/send/1','https'));
});
test('JSON v2 correlates connect, subscribes once, accepts batch/push and unsubscribes',async()=>{
 const t=protocol();const c=t.p.connect('synthetic-test-token');assert.equal(JSON.parse(t.sent[0].s).connect.name,'kicktv-chatprobe');t.reply('connect',{version:'6.9.7 PRO'});await c;
 const s=t.p.subscribe('chatrooms.20.v2');t.reply('subscribe');await s;assert.equal(t.p.subscribed,'chatrooms.20.v2');
 await assert.rejects(t.p.subscribe('chatrooms.21.v2'),/invalid_protocol_state/);
 t.p.receive(Buffer.from('{}\n'+JSON.stringify({push:{channel:'chatrooms.20.v2',pub:{data:{event:'test'}}}})));assert.equal(t.pubs.length,1);
 const u=t.p.unsubscribe();t.reply('unsubscribe');await u;assert.equal(t.p.subscribed,null);t.p.close();assert.equal(t.p.pending.size,0);
 assert.equal(JSON.stringify(t.events).includes('synthetic-test-token'),false);
});
test('heartbeat sends pong only when requested; close clears heartbeat and lease timers',async()=>{
 const t=protocol();const c=t.p.connect('test');t.reply('connect',{ping:25,pong:true,expires:true,ttl:2700});await c;t.p.receive(Buffer.from('{}'));assert.equal(t.sent.at(-1).s,'{}');assert.equal(t.metrics.phases.F.heartbeats_sent,1);t.p.close();assert.equal(t.p.heartbeat,null);assert.equal(t.p.expiry,null);
 const q=protocol();const d=q.p.connect('test');q.reply('connect',{pong:false});await d;const n=q.sent.length;q.p.receive(Buffer.from('{}'));assert.equal(q.sent.length,n);q.p.close();
});
test('protocol authentication refusal is sanitized and never publishes or retries',async()=>{
 const t=protocol();const c=t.p.connect('secret-placeholder');const id=JSON.parse(t.sent[0].s).id;t.p.receive(Buffer.from(JSON.stringify({id,error:{code:103,message:'secret server data',temporary:false}})));await assert.rejects(c,/centrifugo_103/);assert.equal(t.sent.length,1);assert.equal(JSON.stringify(t.events).includes('secret'),false);t.p.close();
});
test('pending timeout, cancellation, unexpected reply and malformed/binary batches are bounded',async()=>{
 const t=protocol({timeout:5});await assert.rejects(t.p.connect('test'),/command_timeout/);assert.equal(t.p.pending.size,0);t.p.close();
 const q=protocol();const pending=q.p.connect('test');q.p.close();await assert.rejects(pending,/cancelled/);
 const r=protocol();assert.throws(()=>r.p.receive(Buffer.from('{"id":99,"connect":{}}')),/uncorrelated/);assert.throws(()=>r.p.receive(Buffer.from('[]')),/invalid_envelope/);assert.throws(()=>r.p.receive(Buffer.from('{}'),true),/frame_limit/);assert.throws(()=>r.p.receive(Buffer.from(Array(66).fill('{}').join('\n'))),/batch_limit/);await assert.rejects(r.p.command('publish',{},'D'),/not_allowed/);r.p.close();
});
test('server disconnect and unsubscribe stop a session; unrelated publications are excluded',async()=>{
 const t=protocol();const c=t.p.connect('test');t.reply('connect');await c;const s=t.p.subscribe('chatrooms.20.v2');t.reply('subscribe');await s;
 t.p.receive(Buffer.from('{"push":{"channel":"chatrooms.21.v2","pub":{"data":{}}}}'));assert.equal(t.pubs.length,0);
 t.p.receive(Buffer.from('{"push":{"channel":"chatrooms.20.v2","unsubscribe":{"code":2500}}}'));assert.deepEqual(t.ends,['server_unsubscribe']);
 t.p.receive(Buffer.from('{"push":{"disconnect":{"code":3500,"reason":"private details"}}}'));assert.equal(t.ends.at(-1),'server_disconnect');assert.equal(JSON.stringify(t.events).includes('private details'),false);t.p.close();
});
test('normalizer treats rich content as text, limits fields and distinguishes moderation and invalid events',()=>{
 const e=normalize({event:'App\\Events\\ChatMessageEvent',data:JSON.stringify({id:'test-id',sender:{username:'test-user',identity:{badges:[{type:'subscriber',text:'One'}]}},content:'<img onerror=evil> [emote:123:Test]',created_at:'2026-11-12T00:00:00Z'})});assert.equal(e.type,'message');assert.match(e.text,/<img/);assert.deepEqual(e.emotes,[{id:'123',name:'Test'}]);assert.equal(e.badges.length,1);
 assert.deepEqual(normalize({event:'App\\Events\\MessageDeletedEvent',data:{id:'x'}}),{type:'delete'});assert.equal(normalize({event:'App\\Events\\ChatMessageEvent',data:{content:'x'}}),null);assert.deepEqual(normalize({event:'constructor',data:{}}),{type:'other'});assert.equal(normalize('not json'),null);assert.equal(normalize('x'.repeat(40000)),null);
});
class FakeSocket extends EventEmitter{
 static sockets=[];
 constructor(url,opts){super();this.url=url;this.options=opts;this.readyState=0;this.bufferedAmount=0;this.sent=[];FakeSocket.sockets.push(this);setImmediate(()=>{if(this.readyState===3)return;this.emit('upgrade',{statusCode:101,socket:{authorized:true,getProtocol:()=> 'TLSv1.2',bytesWritten:1,bytesRead:1}});this.readyState=1;this.emit('open');});}
 send(s,cb){this.sent.push(s);if(s!=='{}'){const c=JSON.parse(s);const kind=Object.keys(c).find(k=>k!=='id');setImmediate(()=>{if(this.readyState===1&&!(kind==='refresh'&&FakeSocket.refreshReply===null))this.emit('message',Buffer.from(JSON.stringify({id:c.id,[kind]:kind==='connect'?{version:'6.9.7 PRO',...FakeSocket.lease}:kind==='refresh'?FakeSocket.refreshReply:{}})),false);});}if(cb)cb();}
 close(code){this.readyState=3;this.emit('close',code);}terminate(){this.close(1006);}
}
function sessionSetup({refuse=false,pending=false,lease,refreshReply={},renewalAuth}={}){
 FakeSocket.sockets=[];FakeSocket.lease=lease;FakeSocket.refreshReply=refreshReply;
 const calls=[],events=[];let consumers=1,rejectPending,authCalls=0;
 const s=new Session({Socket:FakeSocket,emit:e=>{events.push(e);if(e.kind==='delivery')queueMicrotask(()=>s.ack({identity:e.delivery.identity,ticket:e.delivery.ticket,seq:e.delivery.items.at(-1).seq,credit:{items:512,bytes:1048576}}));return true;},consumers:()=>consumers,httpFactory:metrics=>({active:new Set(),cancel(){if(rejectPending)rejectPending(new Error('cancelled'));},async request(url,body,phase){calls.push({url,body});metrics.add(phase,'http_requests');if(pending)return new Promise((_,reject)=>{rejectPending=reject;});if(refuse)throw new Error('http_403');if(url.endsWith('/auth/connection')){
  if(++authCalls>1&&renewalAuth)return renewalAuth();
  return {data:{token:authCalls===1?'synthetic-token':'synthetic-renewed-token'}};
 }if(url.includes('/api/v2/'))return {id:10,slug:'xqc',chatroom:{id:20}};return {data:{connections:[{provider:'centrifugo',credentials:{url:'wss://realtime.sa-east-1.platform.kick.com/connection/websocket'}}]}};}})});
 return {s,calls,events,consumers:n=>{consumers=n;}};
}
async function ready(t){for(let i=0;i<20&&t.s.state.status!=='reading';i++)await wait();assert.equal(t.s.state.status,'reading');t.s.attach({context:'unit-context',credit:{items:512,bytes:1048576}});}
test('session performs three HTTP calls and one socket, ignores duplicate start and cleans all resources',async()=>{
 const t=sessionSetup();t.s.start({channel:'xqc',activityConfirmed:true});t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);assert.equal(t.calls.length,3);assert.equal(FakeSocket.sockets.length,1);assert.equal(t.calls[0].body.client.type,'web');
 const w=FakeSocket.sockets[0];assert.equal(w.options.headers.Origin,undefined);assert.match(w.options.headers['User-Agent'],/independent/);assert.equal(w.options.rejectUnauthorized,true);
 t.s.publication({event:'App\\Events\\ChatMessageEvent',data:{id:'1',sender:{username:'test'},content:'test'}});t.s.publication({event:'App\\Events\\ChatMessageEvent',data:{id:'1',sender:{username:'test'},content:'test'}});assert.equal(t.s.state.messages,1);assert.equal(t.s.metrics.phases.F.duplicates,1);
 await t.s.stop('test_end');const r=t.s.snapshot().resources;assert.equal(r.socket,false);assert.equal(r.pending_commands,0);assert.deepEqual(r.session_timers,[]);assert.equal(r.queue,0);assert.equal(t.s.start({channel:'xqc',activityConfirmed:true}).errorText,'attempt_already_completed');assert.equal(JSON.stringify(t.s.snapshot()).includes('synthetic-token'),false);
});
test('chat timing diagnostics use service monotonic durations without changing delivery envelopes',async()=>{
 const t=sessionSetup();
 try {
  t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);
  t.s.publication({event:'App\\Events\\ChatMessageEvent',data:{id:'timed',sender:{username:'test'},content:'test'}});
  await t.s.stop('test_end');
  const detail=t.s.snapshot(true).delivery;
  assert.equal(detail.latency.receive_normalized_ms.n,1);
  assert.equal(detail.latency.receive_admitted_ms.n,1);
  assert.equal(detail.latency.receive_ack_ms.n,1);
  assert.ok(detail.latency.receive_ack_ms.sum>=detail.latency.receive_admitted_ms.sum);
  assert.deepEqual(detail.load.peaks[0],[1,1,1]);
  assert.equal(t.s.snapshot().delivery.latency,undefined);
  const envelope=t.events.find(event=>event.kind==='delivery').delivery;
  assert.equal('received_mono' in envelope.items[0],false);
 } finally { await t.s.stop('test_end'); }
});
test('HTTP 403 ends progression before auth, metadata or WSS; no retry',async()=>{const t=sessionSetup({refuse:true});t.s.start({channel:'xqc',activityConfirmed:true});await wait();await t.s.stopping;assert.equal(t.calls.length,1);assert.equal(FakeSocket.sockets.length,0);assert.equal(t.s.state.error,'http_403');assert.equal(t.s.state.reconnects,0);});
test('last consumer and cancel during pending HTTP prevent late network work',async()=>{
 const t=sessionSetup({pending:true});t.s.start({channel:'xqc',activityConfirmed:true});await wait();t.consumers(0);await t.s.stop('last_consumer');await wait();assert.equal(FakeSocket.sockets.length,0);assert.deepEqual(t.s.snapshot().resources.session_timers,[]);
 const q=sessionSetup();q.consumers(0);assert.equal(q.s.start({channel:'xqc',activityConfirmed:true}).errorText,'subscription_required');assert.equal(q.calls.length,0);
});
test('an idle chat stays connected beyond 20 minutes and closes after the last consumer leaves',async()=>{
 const t=sessionSetup();
 try {
  t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);
  t.s.state.reading_at=Date.now()-1201000;
  t.s.tick();
  const active=t.s.snapshot();
  assert.equal(active.status,'reading');
  assert.equal(active.error,null);
  assert.equal(active.resources.socket,true);
  assert.ok(active.subscription_seconds>1200);

  t.consumers(0);
  t.s.tick();
  await t.s.stopping;
  const stopped=t.s.snapshot();
  assert.equal(stopped.reason,'last_consumer');
  assert.equal(stopped.status,'stopped');
  assert.equal(stopped.resources.socket,false);
  assert.deepEqual(stopped.resources.session_timers,[]);
 } finally {
  await t.s.stop('test_end');
 }
});
test('WSS HTTP refusal survives subsequent close/error and never retries',async()=>{
 class Refusal extends EventEmitter{constructor(){super();this.readyState=0;setImmediate(()=>{this.emit('unexpected-response',{destroy:()=>{this.readyState=3;this.emit('close',1006);}},{statusCode:403,socket:{authorized:true,getProtocol:()=> 'TLSv1.2'},destroy(){}});});}}
 const metrics=new Metrics(),failures=[];const t=new Transport({Socket:Refusal,metrics,receive(){},fail:c=>failures.push(c)});await assert.rejects(t.open('wss://realtime.sa-east-1.platform.kick.com/connection/websocket'),/upgrade_http_403/);await t.close();assert.equal(metrics.network.upgrade_status,403);assert.equal(metrics.phases.C.connection_attempts,1);assert.equal(failures.length,0);
});
function fakeHttp(status,body,headers={}){const calls=[];const transport={request(url,options,cb){const req=new EventEmitter();req.socket={bytesWritten:100,bytesRead:200};req.write=b=>{req.body=b;};req.destroy=()=>req.emit('error',{code:'ECONNRESET'});req.end=()=>setImmediate(()=>{const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.socket={authorized:true,getProtocol:()=> 'TLSv1.2'};res.destroy=()=>{};cb(res);res.emit('data',Buffer.from(body));res.emit('end');});calls.push({url,options,req});return req;}};return {transport,calls};}
test('HTTP client records bounded metrics without retaining response body, cookies or credentials',async()=>{const f=fakeHttp(200,'{"data":{"token":"synthetic-secret"}}');const m=new Metrics();const c=new HttpClient(m,f.transport);const r=await c.request('https://web.kick.com/api/v1/realtime/auth/connection',{client_id:'synthetic-id'},'B');assert.equal(r.data.token,'synthetic-secret');assert.equal(c.active.size,0);assert.equal(JSON.stringify(m.snapshot()).includes('synthetic-secret'),false);assert.equal(f.calls[0].options.headers.Cookie,undefined);assert.equal(f.calls[0].options.headers.Origin,undefined);assert.equal(f.calls[0].options.rejectUnauthorized,true);assert.equal(f.calls[0].options.agent.keepAlive,true);let destroyed=false;const destroy=c.agent.destroy.bind(c.agent);c.agent.destroy=()=>{destroyed=true;destroy();};c.cancel();assert.equal(destroyed,true);await assert.rejects(c.request('https://web.kick.com/api/v1/realtime/connection',{},'B'),/cancelled/);});
test('HTTP 403 and disallowed redirects terminate rather than following a different identity or host',async()=>{
 const f=fakeHttp(403,'sensitive error body');const m=new Metrics();const c=new HttpClient(m,f.transport);await assert.rejects(c.request('https://web.kick.com/api/v1/realtime/connection',{},'B'),/http_403/);assert.equal(f.calls.length,1);assert.equal(JSON.stringify(m.snapshot()).includes('sensitive'),false);
 const q=fakeHttp(307,'',{location:'https://evil.test/'});const d=new HttpClient(new Metrics(),q.transport);await assert.rejects(d.request('https://web.kick.com/api/v1/realtime/connection',{},'B'),/redirect_not_allowed/);assert.equal(q.calls.length,1);
});

test('reused socket metrics use per-request deltas and do not double-count earlier requests',async()=>{
 const socket={bytesWritten:0,bytesRead:0};let count=0;
 const transport={request(url,opts,cb){const req=new EventEmitter();req.socket=socket;req.reusedSocket=count++>0;req.write=()=>{};req.destroy=()=>{};req.end=()=>setImmediate(()=>{
  req.emit('socket',socket);socket.bytesWritten+=100;socket.bytesRead+=200;
  const res=new EventEmitter();res.statusCode=200;res.headers={};res.socket={authorized:true,getProtocol:()=> 'TLSv1.3'};res.destroy=()=>{};cb(res);res.emit('data',Buffer.from('{}'));res.emit('end');
 });return req;}};
 const m=new Metrics(),h=new HttpClient(m,transport);await h.request('https://web.kick.com/api/v1/realtime/connection',{},'B');await h.request('https://web.kick.com/api/v1/realtime/auth/connection',{},'B');
 assert.equal(m.http[1].reused_socket,true);assert.deepEqual(m.http.map(r=>r.socket_bytes_written),[100,100]);assert.deepEqual(m.http.map(r=>r.socket_bytes_read),[200,200]);h.cancel();
});

const {Consumers}=require('../../service/consumers');const {slug}=require('../../service/config');const {inspect}=require('../../service/normalize');
const fixture=(id='fixture-1')=>({event:'App\\Events\\ChatMessageEvent',data:JSON.stringify({id,sender:{username:'FixtureAuthor'},content:'Synthetic local fixture only',created_at:'2026-11-12T00:00:00Z'})});
test('subscribe ACK and several publications in the same frame are routed before the promise continuation',async()=>{
 const t=protocol();const c=t.p.connect('fixture');t.reply('connect');await c;
 const pending=t.p.subscribe('chatrooms.20.v2');const id=JSON.parse(t.sent.at(-1).s).id;
 t.p.receive(Buffer.from([JSON.stringify({id,subscribe:{}}),JSON.stringify({push:{channel:'chatrooms.20.v2',pub:{data:fixture('one')}}}),JSON.stringify({push:{channel:'chatrooms.20.v2',pub:{data:fixture('two')}}})].join('\n')));
 assert.equal(t.pubs.length,2);assert.equal(t.p.subscribed,'chatrooms.20.v2');await pending;t.p.close();
});
test('connect ACK and ping in the same frame negotiate pong synchronously',async()=>{
 const t=protocol();const c=t.p.connect('fixture');const id=JSON.parse(t.sent[0].s).id;
 t.p.receive(Buffer.from(JSON.stringify({id,connect:{ping:25,pong:true}})+'\n{}'));assert.equal(t.sent.at(-1).s,'{}');await c;t.p.close();
});
test('publication pushes are counted separately from invalid envelopes, foreign rooms and unknown events',async()=>{
 const t=protocol();const c=t.p.connect('fixture');t.reply('connect');await c;const sub=t.p.subscribe('chatrooms.20.v2');t.reply('subscribe');await sub;
 t.p.receive(Buffer.from(JSON.stringify({push:{channel:'chatrooms.20.v2',pub:null}})));assert.equal(t.pubs.length,1);assert.equal(inspect(t.pubs[0]).reason,'invalid_envelope');
 t.p.receive(Buffer.from(JSON.stringify({push:{channel:'chatrooms.99.v2',pub:{data:fixture()}}})));assert.equal(t.pubs.length,1);assert.equal(t.metrics.phases.F.publications_other_room,1);
 assert.equal(inspect({event:'FutureEvent',data:{}}).reason,'unknown_event');t.p.close();
});
test('selection accepts a slug only, requires confirmed activity and makes no HTTP call otherwise',async()=>{
 const t=sessionSetup();for(const v of ['', 'https://kick.com/ayellol','../ayellol','ayellol?x=1','a b','a'.repeat(26),'áyellol']){assert.throws(()=>slug(v));assert.equal(t.s.start({channel:v,activityConfirmed:true}).returnValue,false);}
 assert.equal(slug('Ayellol'),'ayellol');assert.equal(t.s.start({channel:'ayellol',activityConfirmed:false}).returnValue,false);assert.equal(t.calls.length,0);
 assert.equal(destination('https://kick.com/api/v2/channels/ayellol','https','ayellol').hostname,'kick.com');assert.throws(()=>destination('https://kick.com/api/v2/channels/other','https','ayellol'));
});
test('FIFO sample is retained until DOM ACK; diagnostics expose counts and no message content',async()=>{
 const t=sessionSetup();t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);
 t.s.publication(fixture());t.s.flushSamples();const delivered=t.events.filter(e=>e.kind==='delivery');assert.equal(delivered.length,1);assert.equal(JSON.parse(delivered[0].delivery.items[0].payload).user,'FixtureAuthor');assert.equal(t.s.state.samples_sent,1);assert.equal(t.s.state.steps.message,'confirmed');
 assert.equal(JSON.stringify(t.s.snapshot()).includes('FixtureAuthor'),false);t.s.publication(fixture());assert.equal(t.s.state.duplicates,1);
 t.s.publication({event:'App\\Events\\ChatMessageEvent',data:{id:'bad'}});assert.equal(t.s.state.rejected,1);t.s.publication({event:'FutureEvent',data:{}});assert.equal(t.s.state.unknown_events,1);
 await t.s.stop('manual_stop');assert.equal(t.s.queue.length,0);assert.equal(t.s.ids.size,0);
});
test('closing while subscribe is pending prevents late delivery and releases command timers',async()=>{
 const t=protocol();const c=t.p.connect('fixture');t.reply('connect');await c;const sub=t.p.subscribe('chatrooms.20.v2');t.p.close();await assert.rejects(sub,/cancelled/);
 t.p.receive(Buffer.from(JSON.stringify({push:{channel:'chatrooms.20.v2',pub:{data:fixture()}}})));assert.equal(t.pubs.length,0);assert.equal(t.p.pending.size,0);assert.equal(t.p.subscribed,null);
});
test('Luna consumers cancel work exactly when the last consumer leaves, including failed callbacks',()=>{
 let stops=0;const c=new Consumers(()=>stops++);c.add('a',{respond(){}});c.add('b',{respond(){throw new Error('consumer gone');}});c.broadcast({returnValue:true});assert.equal(c.size,1);assert.equal(stops,0);c.remove('unknown');assert.equal(stops,0);c.remove('a');assert.equal(stops,1);c.remove('a');assert.equal(stops,1);
});
test('stopping an idle session does not poison a later explicit start',async()=>{
 const t=sessionSetup();await t.s.stop('manual_stop');assert.equal(t.s.stopping,null);t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);await t.s.stop('manual_stop');assert.equal(t.s.snapshot().resources.socket,false);
});

test('session closes while subscription ACK is pending and releases socket, timers and pending commands',async()=>{
 class HoldSubscribe extends FakeSocket{send(s,cb){if(s!=='{}'&&JSON.parse(s).subscribe){this.sent.push(s);if(cb)cb();return;}super.send(s,cb);}}
 const t=sessionSetup();t.s.Socket=HoldSubscribe;t.s.start({channel:'xqc',activityConfirmed:true});
 for(let i=0;i<20&&!t.s.protocol?.pending.size;i++)await wait();
 for(let i=0;i<20&&!Array.from(t.s.protocol.pending.values()).some(p=>p.kind==='subscribe');i++)await wait();
 assert.ok(Array.from(t.s.protocol.pending.values()).some(p=>p.kind==='subscribe'));
 await t.s.stop('manual_stop');await wait();const r=t.s.snapshot().resources;assert.equal(r.socket,false);assert.equal(r.pending_commands,0);assert.deepEqual(r.session_timers,[]);assert.equal(t.s.state.error,null);
});
test('high-volume synthetic messages retain only bounded IDs and samples and clear them at stop',async()=>{
 const t=sessionSetup();t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);for(let i=0;i<250;i++)t.s.publication(fixture(String(i+1)));
 assert.equal(t.s.state.messages,250);assert.equal(t.s.queue.length,250);assert.equal(t.s.ids.size,200);t.s.flushSamples();assert.equal(t.s.state.samples_sent,250);await t.s.stop('manual_stop');assert.equal(t.s.queue.length,0);assert.equal(t.s.ids.size,0);assert.deepEqual(t.s.snapshot().resources.session_timers,[]);
});

test('consumer loss during first-publication notification cannot leave a queued message after cleanup',async()=>{
 const t=sessionSetup();t.s.start({channel:'xqc',activityConfirmed:true});await ready(t);const emit=t.s.emit;t.s.emit=e=>{emit(e);if(e.kind==='first_publication'){t.consumers(0);t.s.stop('last_consumer');}};
 t.s.publication(fixture());await t.s.stopping;assert.equal(t.s.queue.length,0);assert.equal(t.s.state.messages,0);assert.equal(t.s.snapshot().resources.socket,false);
});
test('consumer loss during pre-WSS progress never starts a socket afterwards',async()=>{
 const t=sessionSetup();const emit=t.s.emit;t.s.emit=e=>{emit(e);if(e.kind==='opening_wss'){t.consumers(0);t.s.stop('last_consumer');}};
 t.s.start({channel:'xqc',activityConfirmed:true});for(let i=0;i<10&&!t.s.stopping;i++)await wait();await t.s.stopping;assert.equal(FakeSocket.sockets.length,0);assert.equal(t.calls.length,2);assert.equal(t.s.snapshot().resources.pending_commands,0);
});

test('lease follows the server TTL beyond one hour and keeps the five-second margin',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const {p,ends}=protocol();
 p.activate({expires:true,ttl:7200});
 t.mock.timers.tick(7194999);
 assert.deepEqual(ends,[]);
 t.mock.timers.tick(1);
 assert.deepEqual(ends,['lease_ending_no_refresh']);
 p.close();
});

test('leases beyond the Node timer range remain active until the server deadline',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const {p,ends}=protocol();
 p.activate({expires:true,ttl:2147490});
 t.mock.timers.tick(2**31-1);
 assert.deepEqual(ends,[]);
 t.mock.timers.tick(1353);
 assert.deepEqual(ends,['lease_ending_no_refresh']);
 p.close();
});

test('the seventh protocol command and sixth HTTP request remain valid',async()=>{
 const t=protocol();
 const connect=t.p.connect('test');
 t.reply('connect');
 await connect;
 for(const kind of ['subscribe','unsubscribe','subscribe','unsubscribe','subscribe','unsubscribe']){
  const command=kind==='subscribe'?t.p.subscribe('chatrooms.20.v2'):t.p.unsubscribe();
  t.reply(kind);
  await command;
 }
 assert.equal(t.sent.length,7);
 t.p.close();

 const http=fakeHttp(200,'{"data":{}}');
 const metrics=new Metrics();
 const client=new HttpClient(metrics,http.transport);
 try {
  for(let index=0;index<6;index++){
   await client.request('https://web.kick.com/api/v1/realtime/connection',{},'B');
  }
  assert.equal(metrics.phases.B.http_requests,6);
 } finally {
  client.cancel();
 }
});

test('chat stays active beyond the former publication, frame and byte budgets',async()=>{
 const t=sessionSetup();
 try {
  t.s.start({channel:'xqc',activityConfirmed:true});
  await ready(t);
  const ws=FakeSocket.sockets[0];
  const publication=Buffer.from(JSON.stringify({
   push:{channel:'chatrooms.20.v2',pub:{data:{event:'test',padding:'x'.repeat(1500)}}}
  }));
  for(let index=0;index<30001;index++)ws.emit('message',publication,false);
  const active=t.s.snapshot();
  assert.equal(active.status,'reading');
  assert.equal(active.error,null);
  assert.equal(active.events,30001);
  assert.ok(active.metrics.phases.F.frames_received>12000);
  assert.ok(active.metrics.phases.F.ws_payload_rx>16*1024*1024);
 } finally {
  await t.s.stop('test_end');
 }
});

test('automatic lease refresh keeps the socket, subscription and FIFO active past the old deadline',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const fixture=sessionSetup({lease:{expires:true,ttl:2700},refreshReply:{expires:true,ttl:3600}});
 try {
  fixture.s.start({channel:'xqc',activityConfirmed:true});await ready(fixture);
  const socket=FakeSocket.sockets[0];
  const oldDeadline=fixture.s.protocol.leaseDeadline;
  const fifo=fixture.s.delivery;
  const ticket=fifo.consumer.ticket;
  t.mock.timers.tick(2639000);
  assert.equal(fixture.calls.length,3);
  t.mock.timers.tick(2000);
  for(let index=0;index<10&&!fixture.s.state.renewal?.confirmed;index++)await wait();
  assert.equal(fixture.s.state.renewal.confirmed,1);
  assert.equal(fixture.s.state.renewal.ttl_seconds,3600);
  assert.deepEqual(fixture.s.snapshot(true).connection_authorization,{
   ttl_seconds:3600,renewal_required:true,active:true,
   expires_at_ms:fixture.s.protocol.leaseDeadline+5000
  });
  assert.ok(fixture.s.protocol.leaseDeadline>oldDeadline);
  const auth=fixture.calls.filter(call=>call.url.endsWith('/auth/connection'));
  assert.equal(auth.length,2);
  assert.deepEqual(auth[1].body,auth[0].body);
  assert.equal(JSON.parse(socket.sent.at(-1)).refresh.token,'synthetic-renewed-token');
  assert.equal(FakeSocket.sockets.length,1);
  assert.equal(fixture.s.delivery,fifo);
  assert.equal(fifo.consumer.ticket,ticket);
  assert.equal(fixture.s.protocol.subscribed,'chatrooms.20.v2');
  t.mock.timers.tick(60000);
  assert.equal(fixture.s.state.status,'reading');
  socket.emit('message',Buffer.from(JSON.stringify({push:{channel:'chatrooms.20.v2',pub:{data:{
   event:'App\\Events\\ChatMessageEvent',data:{id:'new',sender:{username:'fixture'},content:'after refresh'}
  }}}})),false);
  fifo.lastFlush=-Infinity;fixture.s.flushSamples();await wait();
  assert.equal(fifo.counts.confirmed,1);
  assert.equal(JSON.stringify(fixture.s.snapshot(true)).includes('synthetic-renewed-token'),false);
 } finally {await fixture.s.stop('test_end');}
});

test('automatic renew retries once after Retry-After when the old lease permits it',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 let attempts=0;
 const fixture=sessionSetup({lease:{expires:true,ttl:2700},refreshReply:{expires:true,ttl:2700},
  renewalAuth:()=>{if(++attempts===1)throw Object.assign(new Error('http_429'),{retryAfterMs:4000});return {data:{token:'synthetic-renewed-token'}};}});
 try {
  fixture.s.start({channel:'xqc',activityConfirmed:true});await ready(fixture);
  t.mock.timers.tick(2640000);await wait();
  assert.equal(fixture.s.state.renewal.status,'retry_wait');
  t.mock.timers.tick(3999);assert.equal(attempts,1);
  t.mock.timers.tick(1);
  for(let index=0;index<10&&!fixture.s.state.renewal.confirmed;index++)await wait();
  assert.equal(attempts,2);
  assert.equal(fixture.s.state.renewal.confirmed,1);
 } finally {await fixture.s.stop('test_end');}
});

test('renewal refusal closes with its own reason without opening a replacement socket',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const fixture=sessionSetup({lease:{expires:true,ttl:2700},
  renewalAuth:()=>{throw new Error('http_403');}});
 try {
  fixture.s.start({channel:'xqc',activityConfirmed:true});await ready(fixture);
  t.mock.timers.tick(2640000);await wait();await fixture.s.stopping;
  assert.equal(fixture.s.state.reason,'refresh_http_403');
  assert.equal(FakeSocket.sockets.length,1);
  assert.equal(fixture.calls.length,4);
  assert.ok(!FakeSocket.sockets[0].sent.some(frame=>JSON.parse(frame).refresh));
 } finally {await fixture.s.stop('test_end');}
});

test('closing chat while fetching a renewal prevents late network commands',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 let resolve;
 const fixture=sessionSetup({lease:{expires:true,ttl:2700},renewalAuth:()=>new Promise(done=>{resolve=done;})});
 try {
  fixture.s.start({channel:'xqc',activityConfirmed:true});await ready(fixture);
  t.mock.timers.tick(2640000);await wait();
  assert.equal(fixture.s.state.renewal.status,'attempting');
  await fixture.s.stop('manual_stop');
  resolve({data:{token:'synthetic-late-token'}});await wait();
  assert.equal(fixture.s.state.reason,'manual_stop');
  assert.ok(!FakeSocket.sockets[0].sent.some(frame=>JSON.parse(frame).refresh));
  assert.deepEqual(fixture.s.snapshot().resources.session_timers,[]);
 } finally {await fixture.s.stop('test_end');}
});

test('an unanswered refresh closes cleanly and does not resend an ambiguous command',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const fixture=sessionSetup({lease:{expires:true,ttl:2700},refreshReply:null});
 try {
  fixture.s.start({channel:'xqc',activityConfirmed:true});await ready(fixture);
  t.mock.timers.tick(2640000);await wait();
  t.mock.timers.tick(8000);await wait();await fixture.s.stopping;
  assert.equal(fixture.s.state.reason,'refresh_command_timeout');
  assert.equal(FakeSocket.sockets[0].sent.filter(frame=>JSON.parse(frame).refresh).length,1);
  assert.equal(fixture.s.snapshot().resources.pending_commands,0);
 } finally {await fixture.s.stop('test_end');}
});
