'use strict';
process.env.WS_NO_BUFFER_UTIL='1';process.env.WS_NO_UTF_8_VALIDATE='1';
const Service=require('webos-service'),Socket=require('ws');
const {Session}=require('./session'),{Controller}=require('./controller'),{Consumers}=require('./consumers'),{VERSION}=require('./config');
const APP='com.kicktv.poc',ID=APP+'.service',service=new Service(ID),history=[];
const instance=require('crypto').randomBytes(6).toString('hex');
const consumers=new Consumers(()=>controller.stop(null,'last_consumer'));
const controller=new Controller({consumers:()=>consumers.size,makeSession:emit=>new Session({Socket,emit,consumers:()=>consumers.size}),emit:e=>{
  if(e.kind!=='samples'){history.push({kind:e.kind,at:e.at,session_id:e.session_id,details:e.details||null});if(history.length>60)history.shift();}
  consumers.broadcast({returnValue:true,event:e,instance});
}});
function allowed(m){if(m.sender===APP)return true;m.respond({returnValue:false,errorText:'caller_not_allowed'});return false;}
function supported(){return process.version==='v16.20.2'&&require('ws/package.json').version==='8.22.2';}
function diagnostics(){return {app_id:APP,service_id:ID,version:VERSION,instance,node:process.version,ws:require('ws/package.json').version,supported_runtime:supported(),snapshot:controller.snapshot(),consumers:consumers.size};}
service.register('capabilities',m=>{if(allowed(m))m.respond({returnValue:true,capabilities:diagnostics()});});
service.register('status',m=>{if(allowed(m))m.respond({returnValue:true,capabilities:diagnostics(),history:history.slice()});});
const events=service.register('events');
events.on('request',m=>{if(!allowed(m))return;if(!m.isSubscription){m.respond({returnValue:false,errorText:'subscription_required'});return;}if(consumers.size){m.respond({returnValue:false,errorText:'consumer_already_present'});return;}consumers.add(m.uniqueToken,m);m.respond({returnValue:true,subscribed:true,instance,snapshot:controller.snapshot()});});
events.on('cancel',m=>consumers.remove(m.uniqueToken));
service.register('start',m=>{
  if(!allowed(m))return;if(!supported()){m.respond({returnValue:false,errorText:'unsupported_runtime'});return;}
  if(Object.keys(m.payload||{}).some(k=>!['channel','requestId'].includes(k))){m.respond({returnValue:false,errorText:'parameters_not_allowed'});return;}
  controller.start(m.payload||{}).then(r=>m.respond(r)).catch(()=>m.respond({returnValue:false,errorText:'start_failed'}));
});
service.register('stop',m=>{if(allowed(m))controller.stop(m.payload?.requestId).then(snapshot=>m.respond({returnValue:true,snapshot}));});
