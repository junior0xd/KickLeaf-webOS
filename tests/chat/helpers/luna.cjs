'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../../..');
// The synthetic bus uses the production service delivery engine, not a second queue implementation.
async function installSDK(page){
 for(const name of ['fifo-common.js','fifo-ui.js','fifo-dom.js','chat-emotes.js'])await page.addScriptTag({path:path.join(ROOT,'app',name)});
 const delivery=fs.readFileSync(path.join(ROOT,'service/delivery.js'),'utf8').replace("const C=require('./fifo-common');",'const C=KickFIFOCommon;').replace('module.exports={Delivery};','return Delivery;');
 await page.addScriptTag({content:'window.FixtureDelivery=(function(){'+delivery+'})();'});
 await page.addScriptTag({content:`(()=>{
 let callback=null,seq=0,id=null,snapshot=null,serial=0,engine=null,timer=null;const calls=[];
 function post(kind,extra={}){if(!snapshot||!callback)return;snapshot={...snapshot,sequence:++seq,last_event:kind,delivery:engine?.snapshot()};callback(JSON.parse(JSON.stringify({returnValue:true,event:{kind,session_id:id,snapshot,...extra}})));}
 window.fixture={calls,fetches:[],hold:false,dropACK:false,late:null,get delivery(){return engine;},emit(kind='samples',samples){
  if(kind==='samples'){for(const m of samples||[]){const number=++serial;engine.publication({id:String(number),type:'message',...m},number,Date.now());}engine.flush();}else post(kind);
 },failChat(){if(engine)engine.finish(true);clearInterval(timer);snapshot={...snapshot,status:'stopped',error:'socket_closed_1006'};post('stopped');},failConsumer(){const cb=this.failure;if(cb)cb();}};
 window.webOS={service:{request(uri,o){calls.push({method:o.method,parameters:o.parameters});let cancelled=false;const h={cancel(){if(cancelled)return;cancelled=true;calls.push({method:'cancel'});if(o.method==='events'){callback=null;if(engine?.consumer)engine.disconnect(engine.consumer.ticket);}}};setTimeout(async()=>{if(cancelled)return;
  if(o.method==='events'){callback=o.onSuccess;fixture.failure=o.onFailure;fixture.late=()=>{if(!cancelled)o.onSuccess({returnValue:true,subscribed:true});};if(!fixture.hold)fixture.late();}
  if(o.method==='start'){id=o.parameters.requestId;serial=0;engine=new FixtureDelivery({identity:{instance:'synthetic',run_id:'live',session_id:id},clock:KickFIFOCommon.clock(),inspect:event=>({event})});snapshot={sequence:++seq,phase:'F',status:'reading',channel:o.parameters.channel,metrics:{phases:{},http:[],network:{}},messages:0,events:0,resources:{socket:true},memory:{rss:24000000},delivery:engine.snapshot()};timer=setInterval(()=>engine.flush(),100);o.onSuccess({returnValue:true,snapshot});post('reading');}
  if(o.method==='attach'){const bound=engine.connect(o.parameters,envelope=>{post('delivery',{delivery:envelope});return !!callback;});o.onSuccess({returnValue:true,...bound});}
  if(o.method==='ack'){if(fixture.dropACK)o.onFailure({returnValue:false});else o.onSuccess({returnValue:true,...engine.ack(o.parameters)});}
  if(o.method==='nack')o.onSuccess({returnValue:true,accepted:engine.nack(o.parameters)});
  if(o.method==='stop'){if(engine&&snapshot.status!=='stopped'){engine.close('manual_stop');snapshot={...snapshot,status:'closing'};post('closing');const until=Date.now()+5000;while(engine.queue.length&&Date.now()<until)await new Promise(r=>setTimeout(r,10));engine.finish(engine.queue.length>0);clearInterval(timer);snapshot={...snapshot,status:'stopped',reason:'manual_stop',resources:{socket:false}};post('stopped');}o.onSuccess({returnValue:true,snapshot:{session_id:o.parameters.requestId,session:snapshot}});}
 },0);return h;}}};
 })();`});
}
module.exports={installSDK};
