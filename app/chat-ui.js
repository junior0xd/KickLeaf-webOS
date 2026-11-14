(function(){'use strict';
 var URI='luna://com.kicktv.poc.service',panel=document.getElementById('chat-panel'),list=document.getElementById('chat-messages'),label=document.getElementById('chat-state'),button=document.getElementById('native-theater');
 var channel=null,wanted=false,epoch=0,handle=null,requestId=null,subscriptionReject=null,subscriptionTimer=null,batchTimer=null,queue=[],chain=Promise.resolve(),lastSequence=-1;
 var stats={state:'Idle',presented:0,batches:0,discarded:0,pruned:0,queue_peak:0,session_count:0,last:null,error:null,consumer:false,received:0,render_ms_total:0,render_ms_max:0};
 var names={Idle:'Desabilitado',Negotiating:'Conectando',Connecting:'Conectando',Subscribing:'Assinando sala',Connected:'Conectado',Closing:'Encerrando',Closed:'Encerrado',Error:'Chat indisponível'};
 function state(value){stats.state=value;label.textContent=names[value];}
 function clear(){clearTimeout(batchTimer);batchTimer=null;queue=[];list.textContent='';if(window.KickBadges)KickBadges.clear();}
 function layout(){panel.hidden=!wanted;document.body.classList.toggle('theater',wanted);button.setAttribute('aria-pressed',String(wanted));button.setAttribute('aria-label',wanted?'Ocultar chat e voltar à tela cheia':'Ativar chat no modo teatro');}
 function request(method,parameters){return new Promise(function(resolve,reject){var h;var timer=setTimeout(function(){if(h)h.cancel();reject(Error('luna_timeout'));},12000);try{h=webOS.service.request(URI,{method:method,parameters:parameters||{},onSuccess:function(r){clearTimeout(timer);r.returnValue===false?reject(Error('luna_refused')):resolve(r);},onFailure:function(){clearTimeout(timer);reject(Error('luna_failed'));}});}catch(_){clearTimeout(timer);reject(Error('bridge_unavailable'));}});}
 function cancelConsumer(){clearTimeout(subscriptionTimer);subscriptionTimer=null;if(handle)handle.cancel();handle=null;stats.consumer=false;if(subscriptionReject)subscriptionReject(Error('cancelled'));subscriptionReject=null;}
 // sRGB relative luminance; fixed chat background #111318, minimum contrast 4.5:1.
 function luminance(hex){var c=[1,3,5].map(function(i){var v=parseInt(hex.slice(i,i+2),16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
 var backgroundLuminance=luminance('#111318'),fallbackColor='#8ce66b';
 function displayColor(value){if(typeof value!=='string'||value.length!==7||!/^#[0-9a-fA-F]{6}$/.test(value))return fallbackColor;var l=luminance(value),ratio=(Math.max(l,backgroundLuminance)+0.05)/(Math.min(l,backgroundLuminance)+0.05);return ratio>=4.5?value:fallbackColor;}
 function renderBatch(){
  batchTimer=null;if(!wanted){clear();return;}var batch=queue.splice(0);if(!batch.length)return;var started=performance.now(),fragment=document.createDocumentFragment();
  batch.forEach(function(m){var row=document.createElement('div');row.className='chat-row';
   if(window.KickBadges&&m.badgeItems&&m.badgeItems.length){var badges=document.createElement('span');badges.className='chat-badges';KickBadges.mount(badges,m.badgeItems);row.appendChild(badges);}
   var name=document.createElement('strong');name.textContent=m.user.slice(0,80);name.style.color=displayColor(m.color);row.appendChild(name);
   var text=document.createElement('span');text.textContent=': '+m.text.slice(0,2000);row.appendChild(text);fragment.appendChild(row);
  });list.appendChild(fragment);stats.presented+=batch.length;stats.batches++;while(list.children.length>60){list.firstElementChild.remove();stats.pruned++;}list.scrollTop=list.scrollHeight;var elapsed=performance.now()-started;stats.render_ms_total+=elapsed;stats.render_ms_max=Math.max(stats.render_ms_max,elapsed);
 }

 function receive(e,ticket){
  if(ticket!==epoch||!wanted||e.session_id!==requestId||!e.snapshot||e.snapshot.sequence<=lastSequence)return;lastSequence=e.snapshot.sequence;stats.last=e.snapshot;
  var s=e.snapshot;if(s.status==='starting')state(s.phase==='B'?'Negotiating':s.phase==='C'||s.phase==='D'?'Connecting':'Subscribing');
  if(s.status==='reading')state('Connected');if(s.status==='closing')state('Closing');
  if(e.kind==='samples'&&Array.isArray(e.samples)){e.samples.slice(-5).forEach(function(m){if(m&&typeof m.user==='string'&&typeof m.text==='string'){stats.received++;queue.push({user:m.user,text:m.text,timestamp:m.timestamp,color:m.color,badgeItems:window.KickBadges?KickBadges.select(m):[]});};});while(queue.length>20){queue.shift();stats.discarded++;}stats.queue_peak=Math.max(stats.queue_peak,queue.length);if(!batchTimer)batchTimer=setTimeout(renderBatch,250);}
  if(s.status==='stopped'){stats.error=s.error||null;state(s.error?'Error':'Closed');clear();cancelConsumer();}
 }
 function subscribe(ticket){return new Promise(function(resolve,reject){subscriptionReject=reject;subscriptionTimer=setTimeout(function(){cancelConsumer();reject(Error('subscription_timeout'));},12000);try{handle=webOS.service.request(URI,{method:'events',parameters:{subscribe:true},subscribe:true,resubscribe:false,onSuccess:function(r){if(ticket!==epoch)return;if(r.returnValue===false){cancelConsumer();reject(Error('subscription_refused'));return;}if(r.subscribed){clearTimeout(subscriptionTimer);subscriptionTimer=null;subscriptionReject=null;stats.consumer=true;resolve();}else if(r.event)receive(r.event,ticket);},onFailure:function(){cancelConsumer();reject(Error('subscription_failed'));}});}catch(_){cancelConsumer();reject(Error('bridge_unavailable'));}});}
 function schedule(){var ticket=++epoch,previous=requestId;cancelConsumer();clear();
  chain=chain.catch(function(){}).then(async function(){
   if(previous){var stopped=await request('stop',{requestId:previous});if(ticket===epoch&&stopped.snapshot&&stopped.snapshot.session_id===previous)stats.last=stopped.snapshot.session;}
   if(ticket!==epoch||!wanted||!channel){if(ticket===epoch)state('Closed');return;}
   requestId='s'+Date.now().toString(36)+'_'+ticket;lastSequence=-1;stats.last=null;stats.error=null;state('Negotiating');
   try{await subscribe(ticket);if(ticket!==epoch||!wanted)return;var r=await request('start',{channel:channel,requestId:requestId});if(ticket===epoch){stats.session_count++;if(r.snapshot&&r.snapshot.sequence>=lastSequence)stats.last=r.snapshot;}}
   catch(_){if(ticket===epoch){stats.error='chat_unavailable';state('Error');clear();cancelConsumer();}}
  }).catch(function(){if(ticket===epoch){stats.error='cleanup_failed';state('Error');cancelConsumer();}});
 }
 function valid(value){return typeof value==='string'&&/^[a-z0-9][a-z0-9_]{0,24}$/.test(value);}
 function hide(){wanted=false;layout();state('Closing');schedule();}
 function toggle(){if(wanted){hide();return;}if(!valid(channel))return;wanted=true;layout();schedule();}
 window.addEventListener('kicktv-channel-selected',function(e){var next=e.detail&&e.detail.channel;if(next===channel)return;channel=valid(next)?next:null;document.getElementById('chat-channel').textContent=channel?'Chat · '+channel:'Chat';if(wanted)schedule();});
 window.addEventListener('kicktv-channel-left',function(){hide();channel=null;});
 document.addEventListener('visibilitychange',function(){if(document.hidden)hide();});window.addEventListener('pagehide',hide);
 window.KickChatUI={toggle:toggle,hide:hide,visible:function(){return wanted;},snapshot:function(){return {state:stats.state,enabled:wanted,channel:channel,session_id:requestId,consumer:stats.consumer,presented:stats.presented,batches:stats.batches,discarded:stats.discarded,pruned:stats.pruned,queue_peak:stats.queue_peak,queue:queue.length,dom_rows:list.children.length,dom_nodes:list.querySelectorAll('*').length,session_count:stats.session_count,last:stats.last,error:stats.error,received:stats.received,render_ms_total:stats.render_ms_total,render_ms_max:stats.render_ms_max,badges:window.KickBadges?KickBadges.snapshot():null};}};
 layout();state('Idle');
}());
