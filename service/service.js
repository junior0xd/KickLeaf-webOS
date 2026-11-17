'use strict';
process.env.WS_NO_BUFFER_UTIL='1';process.env.WS_NO_UTF_8_VALIDATE='1';
const Service=require('webos-service'),Socket=require('ws');
const {Session}=require('./session'),{Controller}=require('./controller'),{Consumers}=require('./consumers'),{VERSION}=require('./config');
const APP='com.kicktv.alpha',ID=APP+'.service',service=new Service(ID),history=[];
const instance=require('crypto').randomBytes(6).toString('hex');
const consumers=new Consumers(()=>controller.consumerLost());
const controller=new Controller({consumers:()=>consumers.size,makeSession:emit=>new Session({Socket,emit,consumers:()=>consumers.size}),emit:e=>{
  if(e.kind!=='delivery'&&e.kind!=='samples'){history.push({kind:e.kind,at:e.at,session_id:e.session_id,details:e.details||null});if(history.length>60)history.shift();}
  return consumers.broadcast({returnValue:true,event:e,instance});
}});
function allowed(m){if(m.sender===APP)return true;m.respond({returnValue:false,errorText:'caller_not_allowed'});return false;}
function supported(){return process.version==='v16.20.2'&&require('ws/package.json').version==='8.22.2';}
function diagnostics(){return {app_id:APP,service_id:ID,version:VERSION,instance,node:process.version,ws:require('ws/package.json').version,supported_runtime:supported(),snapshot:controller.snapshot(),consumers:consumers.size};}
service.register('capabilities',m=>{if(allowed(m))m.respond({returnValue:true,capabilities:diagnostics()});});
service.register('status',m=>{if(allowed(m))m.respond({returnValue:true,capabilities:diagnostics(),history:history.slice()});});
const events=service.register('events');
events.on('request',m=>{
  if(!allowed(m))return;
  if(!m.isSubscription){m.respond({returnValue:false,errorText:'subscription_required'});return;}
  const p=m.payload||{};
  if(typeof p.context!=='string'||!p.context.length||p.context.length>128){m.respond({returnValue:false,errorText:'invalid_context'});return;}
  // Cancel notifications may arrive after the replacement request. Replace only
  // the same DOM context/session, or a terminal session with no preserved work.
  if(consumers.size){
    const terminal=controller.current?.session.stopped===true;
    const same=p.requestId===controller.current?.id&&[...consumers.contexts.values()].every(c=>c===p.context);
    if(!terminal&&!same){m.respond({returnValue:false,errorText:'consumer_already_present'});return;}
    for(const token of [...consumers.members.keys()])consumers.remove(token);
  }
  consumers.add(m.uniqueToken,m,p.context);m.respond({returnValue:true,subscribed:true,instance,snapshot:controller.snapshot()});
});
events.on('cancel',m=>consumers.remove(m.uniqueToken));
service.register('start',m=>{
  if(!allowed(m))return;if(!supported()){m.respond({returnValue:false,errorText:'unsupported_runtime'});return;}
  if(Object.keys(m.payload||{}).some(k=>!['channel','requestId'].includes(k))){m.respond({returnValue:false,errorText:'parameters_not_allowed'});return;}
  controller.start(m.payload||{}).then(r=>m.respond(r)).catch(()=>m.respond({returnValue:false,errorText:'start_failed'}));
});
service.register('stop',m=>{if(allowed(m))controller.stop(m.payload?.requestId).then(snapshot=>m.respond({returnValue:true,snapshot}));});
// This local DOM acknowledgement is independent of Centrifugo's protocol ACK.
for(const method of ['attach','ack','nack'])service.register(method,m=>{
  if(!allowed(m))return;
  const keys=method==='attach'?['requestId','context','credit','watermark','pending']:method==='ack'?['requestId','identity','ticket','seq','credit','dom_wall']:['requestId','identity','ticket','expected'];
  if(!m.payload||Object.keys(m.payload).some(k=>!keys.includes(k))){m.respond({returnValue:false,errorText:'parameters_not_allowed'});return;}
  m.respond(controller.delivery(method,m.payload));
});
