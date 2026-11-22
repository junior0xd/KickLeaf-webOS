(function(){'use strict';
 var URI='luna://com.kicktv.alpha.service',panel=document.getElementById('chat-panel'),list=document.getElementById('chat-messages'),label=document.getElementById('chat-state'),button=document.getElementById('native-theater');
 var channel=null,wanted=false,epoch=0,active=null,chain=Promise.resolve();
 var stats={state:'Idle',presented:0,batches:0,discarded:0,pruned:0,queue_peak:0,session_count:0,last:null,error:null,received:0,render_ms_total:0,render_ms_max:0};
 var names={Idle:'Desabilitado',Negotiating:'Conectando',Connecting:'Conectando',Subscribing:'Assinando sala',Connected:'Conectado',Closing:'Encerrando',Closed:'Encerrado',Error:'Chat indisponível'};
 function state(value){stats.state=value;label.textContent=names[value];}
 function layout(){panel.hidden=!wanted;document.body.classList.toggle('theater',wanted);button.setAttribute('aria-pressed',String(wanted));button.setAttribute('aria-label',wanted?'Ocultar chat e voltar à tela cheia':'Ativar chat no modo teatro');}
 function request(method,parameters){return new Promise(function(resolve,reject){var h,settled=false;
  function finish(ok,r){if(settled)return;settled=true;clearTimeout(timer);if(ok&&r&&r.returnValue===true)resolve(r);else reject(Error('luna_failed'));}
  var timer=setTimeout(function(){if(settled)return;settled=true;if(h)h.cancel();reject(Error('luna_timeout'));},method==='stop'?65000:12000);
  try{h=webOS.service.request(URI,{method:method,parameters:parameters||{},onSuccess:function(r){finish(true,r);},onFailure:function(r){finish(false,r);}});}catch(_){finish(false,null);}
 });}
 function cancelConsumer(c){clearTimeout(c.subscriptionTimer);c.subscriptionTimer=null;var h=c.handle;c.handle=null;c.subscribed=false;if(h)h.cancel();if(c.rejectSubscription)c.rejectSubscription(Error('cancelled'));c.rejectSubscription=null;}
 function release(c,abort){if(c.released)return;c.released=true;cancelRender(c);cancelConsumer(c);
  if(c.consumer){c.consumer.cleanup(!!abort);var n=c.consumer.counts;stats.presented+=n.inserted;stats.received+=n.received_unique;stats.pruned+=n.pruned;stats.discarded+=n.discarded;stats.queue_peak=Math.max(stats.queue_peak,c.consumer.occupancy.maxItems);}
  else list.textContent='';
  if(window.KickBadges)KickBadges.clear();if(window.KickEmotes)KickEmotes.destroy();c.early=null;if(active===c)active=null;
 }
 async function close(c){if(!c||c.released)return;if(c.closingPromise)return c.closingPromise;c.closing=true;state('Closing');
  c.closingPromise=(async function(){try{if(c.started){var r=await request('stop',{requestId:c.id});if(r.snapshot&&r.snapshot.session_id===c.id)stats.last=r.snapshot.session;}}finally{release(c,!!c.consumer&&c.consumer.queue.length>0);}})();return c.closingPromise;
 }
 function cancelRender(c){cancelAnimationFrame(c.renderFrame);clearTimeout(c.renderTimer);c.renderFrame=null;c.renderTimer=null;}
 function scheduleRender(c){
  if(c.renderTimer!==null||c.released||c.consumer.ticket===null||(!c.consumer.queue.length&&!c.consumer.fatal))return;
  var timerMs=50,scheduledAt=c.consumer.clock.mono();
  function render(source){
   cancelRender(c);if(active!==c||c.released||c.consumer.ticket===null)return;
   if(c.consumer.queue.length)c.consumer.recordRenderSchedule(source,c.consumer.clock.mono()-scheduledAt,timerMs);
   var before=c.consumer.counts.inserted;c.consumer.render();if(c.consumer.counts.inserted>before)stats.batches++;
   var h=c.consumer.h.render_batch_ms;stats.render_ms_total=h.sum;stats.render_ms_max=h.max||0;
   if(c.consumer.fatal){if(!c.closing){stats.error='render_failure';void close(c).catch(function(){}).finally(function(){state('Error');});}return;}
   scheduleRender(c);
  }
  c.renderFrame=requestAnimationFrame(function(){render('frame');});
  // Keep draining when webOS throttles animation callbacks, including with the screen off.
  c.renderTimer=setTimeout(function(){render('timer');},timerMs);
 }
 function delivery(c,envelope){if(!c.consumer||c.consumer.ticket===null){c.early=envelope;return;}c.consumer.receive(envelope);stats.queue_peak=Math.max(stats.queue_peak,c.consumer.queue.length);scheduleRender(c);}
 function receive(c,e){if(active!==c||c.released||e.session_id!==c.id||!e.snapshot)return;
  if(e.kind==='delivery'&&e.delivery){delivery(c,e.delivery);return;}
  if(e.snapshot.sequence<=c.lastSequence)return;c.lastSequence=e.snapshot.sequence;stats.last=e.snapshot;var s=e.snapshot;
  if(!c.closing){if(s.status==='starting')state(s.phase==='B'?'Negotiating':s.phase==='C'||s.phase==='D'?'Connecting':'Subscribing');if(s.status==='reading')state('Connected');}
  if(s.status==='closing'){state('Closing');if(c.consumer&&s.delivery&&s.delivery.ticket===null&&s.delivery.queue.items>0&&!c.recovering&&c.recoveryAttempts===0)void recover(c);}
  if(s.status==='stopped'){stats.error=s.error||null;release(c,!!c.consumer&&c.consumer.queue.length>0);state(s.error?'Error':'Closed');if(/^delivery_(items|bytes|item_bytes)/.test(s.error||''))label.textContent='Chat interrompido por sobrecarga';}
 }
 function subscribe(c){return new Promise(function(resolve,reject){c.rejectSubscription=reject;c.subscriptionTimer=setTimeout(function(){cancelConsumer(c);reject(Error('subscription_timeout'));},12000);
  try{c.handle=webOS.service.request(URI,{method:'events',parameters:{subscribe:true,context:String(performance.timeOrigin),requestId:c.id},subscribe:true,resubscribe:false,onSuccess:function(r){if(active!==c||c.released)return;if(r.returnValue===false){cancelConsumer(c);reject(Error('subscription_refused'));return;}if(r.subscribed){clearTimeout(c.subscriptionTimer);c.subscriptionTimer=null;c.rejectSubscription=null;c.subscribed=true;resolve();}else if(r.event)receive(c,r.event);},onFailure:function(){if(active!==c||c.released)return;if(!c.subscribed){cancelConsumer(c);reject(Error('subscription_failed'));}else void recover(c);}});}catch(_){cancelConsumer(c);reject(Error('bridge_unavailable'));}
 });}
 async function bind(c){c.consumer.ticket=null;var r=await request('attach',{requestId:c.id,context:String(performance.timeOrigin),credit:c.consumer.credit(),watermark:c.consumer.watermark,pending:c.consumer.queue.map(function(e){return e.seq;})});
  if(active!==c||c.released)return;if(!KickFIFOCommon.same(c.consumer.identity,r.identity))throw Error('session_identity_changed');c.consumer.attach(r.ticket);var early=c.early;c.early=null;if(early)delivery(c,early);else scheduleRender(c);
 }
 async function recover(c){if(c.recovering)return;c.recovering=true;try{if(c.recoveryAttempts++>=1)throw Error('subscription_failed');cancelConsumer(c);await subscribe(c);await bind(c);}catch(_){stats.error='chat_unavailable';try{await close(c);}catch(__){}state('Error');}finally{c.recovering=false;}}
 function schedule(){var ticket=++epoch;if(active&&!active.started)cancelConsumer(active);
  chain=chain.catch(function(){}).then(async function(){if(active)await close(active);if(ticket!==epoch)return;if(!wanted||!channel){state('Closed');return;}
   var c={id:'s'+Date.now().toString(36)+'_'+ticket,handle:null,consumer:null,renderFrame:null,renderTimer:null,lastSequence:-1,subscribed:false,started:false,released:false,recoveryAttempts:0};active=c;stats.last=null;stats.error=null;state('Negotiating');
   document.getElementById('chat-channel').textContent='Chat · '+channel;
   try{await subscribe(c);if(ticket!==epoch||!wanted){await close(c);return;}
    var parameters={channel:channel,requestId:c.id};
    var r=await request('start',parameters);if(active!==c||c.released)return;c.started=true;stats.session_count++;if(r.snapshot)stats.last=r.snapshot;
    c.consumer=new KickFIFOUI.Consumer({clock:KickFIFOCommon.clock(),identity:r.snapshot.delivery.identity,adapter:KickFIFODOM(list),config:{renderItems:64,renderBudgetMs:8},sendAck:function(a){return request('ack',Object.assign({requestId:c.id},a)).then(function(reply){if(!reply.accepted&&!['duplicate','stale'].includes(reply.reason))throw Error('ack_refused');});},sendNack:function(a){void request('nack',Object.assign({requestId:c.id},a)).catch(function(){});}});
    await bind(c);if(ticket!==epoch||!wanted){await close(c);return;}if(stats.last&&stats.last.status==='reading')state('Connected');
   }catch(_){if(active===c){stats.error='chat_unavailable';try{await close(c);}catch(__){}if(ticket===epoch)state('Error');}}
  }).catch(function(){stats.error='cleanup_failed';state('Error');});
 }
 function valid(value){return typeof value==='string'&&/^[a-z0-9][a-z0-9_]{0,24}$/.test(value);}
 function hide(){wanted=false;layout();state('Closing');schedule();}
 function toggle(){if(wanted){hide();return;}if(!valid(channel))return;wanted=true;layout();schedule();}
 window.addEventListener('kicktv-channel-selected',function(e){var next=e.detail&&e.detail.channel;if(next===channel)return;channel=valid(next)?next:null;document.getElementById('chat-channel').textContent=channel?'Chat · '+channel:'Chat';if(wanted)schedule();});
 window.addEventListener('kicktv-channel-left',function(){hide();channel=null;});
 document.addEventListener('visibilitychange',function(){if(document.hidden)hide();});window.addEventListener('pagehide',function(){hide();if(active)release(active,true);});
 window.KickChatUI={toggle:toggle,hide:hide,visible:function(){return wanted;},snapshot:function(){var c=active&&active.consumer,n=c?c.counts:{},images=window.KickEmotes?KickEmotes.snapshot():null;return {state:stats.state,enabled:wanted,channel:channel,session_id:active?active.id:null,consumer:!!active&&active.subscribed,presented:stats.presented+(n.inserted||0),batches:stats.batches,discarded:stats.discarded+(n.discarded||0),pruned:stats.pruned+(n.pruned||0),queue_peak:stats.queue_peak,queue:c?c.queue.length:0,dom_rows:list.children.length,dom_nodes:list.querySelectorAll('*').length,session_count:stats.session_count,last:stats.last,error:stats.error,received:stats.received+(n.received_unique||0),render_ms_total:stats.render_ms_total,render_ms_max:stats.render_ms_max,delivery:c?c.snapshot():null,images:images,badges:window.KickBadges?KickBadges.snapshot():null};}};
 layout();state('Idle');
}());
