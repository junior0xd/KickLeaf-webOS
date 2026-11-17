'use strict';
const crypto=require('crypto');const {Metrics}=require('./metrics');const {HttpClient}=require('./http-client');const {Transport}=require('./transport');const {Protocol}=require('./protocol');const {slug,destination}=require('./config');const {inspect}=require('./normalize');
const {Delivery}=require('./delivery');const FIFO=require('./fifo-common');
const STEP_KEYS=['service','negotiation','guest','wss','centrifugo','subscription','heartbeat','publication','message'];
class Session {
  constructor({Socket,emit,consumers,httpFactory,transportFactory,windowSeconds=1200,deliveryConfig={}}){
    Object.assign(this,{Socket,emit,consumers,httpFactory,transportFactory});this.metrics=new Metrics();this.windowSeconds=windowSeconds;this.cpuStart=process.cpuUsage();this.tickAt=Date.now();this.loopLagMax=0;
    this.state={sequence:0,phase:'idle',status:'idle',channel:null,reconnects:0,events:0,messages:0,rejected:0,unknown_events:0,duplicates:0,samples_sent:0,checkpoints:[],error:null,steps:Object.fromEntries(STEP_KEYS.map(k=>[k,k==='service'?'confirmed':'waiting']))};
    this.delivery=new Delivery({identity:{instance:crypto.randomUUID(),run_id:'live',session_id:crypto.randomUUID()},clock:FIFO.clock(),inspect:event=>({event}),config:deliveryConfig});
    this.timers={};this.ids=new Set();this.attempted=false;this.wanted=false;this.stopping=null;this.stopped=false;
  }
  get queue(){return this.delivery.queue;}
  attach(p){if(!this.attempted||this.stopped)throw Error("session_closed");return this.delivery.connect(p,envelope=>this.emit({kind:"delivery",at:Date.now(),snapshot:this.snapshot(),delivery:envelope}));}
  ack(p){if(this.stopped)return {accepted:false,reason:"closed"};return this.delivery.ack(p);}
  nack(p){return {accepted:this.delivery.nack(p)};}
  detach(){if(this.delivery.consumer)this.delivery.disconnect(this.delivery.consumer.ticket);}
  snapshot(){
    if(this.transport)this.transport.capture();
    const now=this.state.ended_at||Date.now();
    return {...this.state,steps:{...this.state.steps},checkpoints:this.state.checkpoints.slice(),connection_seconds:this.state.opened_at?(now-this.state.opened_at)/1000:0,subscription_seconds:this.state.reading_at?Math.max(0,(now-this.state.reading_at)/1000):0,
      metrics:this.metrics.snapshot(),delivery:this.delivery.snapshot(),memory:{rss:process.memoryUsage().rss,heap_used:process.memoryUsage().heapUsed},cpu:process.cpuUsage(this.cpuStart),event_loop_lag_max_ms:this.loopLagMax,
      resources:{socket:!!(this.transport&&this.transport.ws),http_requests:this.http?this.http.active.size:0,pending_commands:this.protocol?this.protocol.pending.size:0,session_timers:Object.keys(this.timers),heartbeat:!!(this.protocol&&this.protocol.heartbeat),lease_timer:!!(this.protocol&&this.protocol.expiry),queue:this.queue.length,consumers:this.consumers(),closing:!!this.stopping&&!this.stopped}};
  }
  event(kind,details){this.state.sequence++;this.state.last_event=kind;this.emit({kind,at:Date.now(),snapshot:this.snapshot(),details:details||null});}
  step(key,status){this.state.steps[key]=status;}
  start(parameters){
    let channel;
    try{if(!parameters||parameters.activityConfirmed!==true)throw new Error();channel=slug(parameters.channel);}catch(_){return {returnValue:false,errorText:'channel_and_activity_required'};}
    if(!this.consumers())return {returnValue:false,errorText:'subscription_required'};
    if(this.wanted)return {returnValue:true,already_running:true,snapshot:this.snapshot()};
    if(this.attempted)return {returnValue:false,errorText:'attempt_already_completed'};
    this.attempted=true;this.wanted=true;this.state.channel=channel;this.state.started_at=Date.now();this.state.status='starting';
    this.http=this.httpFactory?this.httpFactory(this.metrics,channel):new HttpClient(this.metrics,undefined,channel);
    this.timers.delivery=setInterval(()=>this.flushSamples(),100);
    this.timers.deadline=setTimeout(()=>this.fail('setup_deadline'),45000);
    this.run().catch(e=>{const code=typeof e.message==='string'&&/^[a-zA-Z0-9_]{1,80}$/.test(e.message)?e.message:'setup_error';if(this.wanted)this.fail(code);});
    return {returnValue:true,snapshot:this.snapshot()};
  }
  alive(){if(!this.wanted||!this.consumers())throw new Error('cancelled');}
  async run(){
    let token=null;
    try{
      this.state.phase='B';this.step('negotiation','running');this.event('negotiating');const clientId=crypto.randomUUID();
      const result=await this.http.request('https://web.kick.com/api/v1/realtime/connection',{client:{id:clientId,type:'web'},capabilities:{accepted_providers:[{provider:'centrifugo'}]}},'B');this.alive();
      const connections=result&&result.data&&result.data.connections;const c=Array.isArray(connections)&&connections.find(v=>v&&v.provider==='centrifugo');
      if(!c||!c.credentials||typeof c.credentials.url!=='string')throw new Error('invalid_negotiation');const endpoint=destination(c.credentials.url,'wss');
      this.state.endpoint=endpoint.href;this.state.region=endpoint.hostname.split('.')[1];this.step('negotiation','confirmed');this.step('guest','running');this.event('authenticating_guest');
      const auth=await this.http.request('https://web.kick.com/api/v1/realtime/auth/connection',{client_id:clientId},'B');this.alive();token=auth&&auth.data&&auth.data.token;if(auth&&auth.data)delete auth.data.token;
      this.state.token_present=typeof token==='string'&&token.length>0;if(!this.state.token_present||token.length>8192)throw new Error('invalid_guest_token');
      if(this.http.releaseIdle)this.http.releaseIdle();this.state.negotiation_complete=true;this.step('guest','confirmed');this.state.phase='C';this.step('wss','running');this.event('opening_wss');this.alive();
      const opts={Socket:this.Socket,metrics:this.metrics,phase:()=>this.wanted?this.state.phase:'cleanup',receive:(b,bin)=>this.protocol.receive(b,bin),fail:code=>this.fail(code)};
      this.transport=this.transportFactory?this.transportFactory(opts):new Transport(opts);
      this.protocol=new Protocol({send:(t,p)=>this.transport.send(t,p),metrics:this.metrics,notify:(k,d)=>this.protocolEvent(k,d),onPublication:v=>this.publication(v),onDisconnect:code=>this.fail(code)});
      await this.transport.open(endpoint.href);this.alive();this.state.opened_at=Date.now();this.state.transport_accepted=true;this.step('wss','confirmed');this.state.phase='D';this.step('centrifugo','running');this.event('connecting_centrifugo');this.alive();
      const connecting=this.protocol.connect(token);token=null;await connecting;this.alive();this.state.phase='E';this.step('subscription','running');this.event('resolving_public_room');this.alive();
      const meta=await this.http.request('https://kick.com/api/v2/channels/'+this.state.channel,undefined,'E');this.alive();if(this.http.releaseIdle)this.http.releaseIdle();
      this.state.channel_live=meta&&meta.livestream===undefined?null:!!(meta&&meta.livestream);if(this.state.channel_live===false)throw new Error('channel_offline');
      const channelId=meta&&meta.id,roomId=meta&&meta.chatroom&&meta.chatroom.id;
      if(!Number.isSafeInteger(channelId)||channelId<=0||!Number.isSafeInteger(roomId)||roomId<=0||meta.slug!==this.state.channel)throw new Error('invalid_channel_metadata');
      this.state.channel_id=channelId;this.state.chatroom_id=roomId;this.state.room='chatrooms.'+roomId+'.v2';this.event('subscribing_room');this.alive();
      await this.protocol.subscribe(this.state.room);this.alive();
      this.state.phase='F';this.state.status='reading';this.state.reading_at=Date.now();this.tickAt=Date.now();this.state.window_seconds=this.windowSeconds;clearTimeout(this.timers.deadline);delete this.timers.deadline;
      this.timers.tick=setInterval(()=>this.tick(),1000);this.event('reading');
    }finally{token=null;}
  }
  protocolEvent(kind,details){
    if(kind==='protocol_connected'){this.state.protocol_details=details;this.state.protocol_accepted=true;this.step('centrifugo','confirmed');}
    if(kind==='subscribed'){this.state.subscription_confirmed=true;this.step('subscription','confirmed');}
    if(kind==='heartbeat_received')this.step('heartbeat','confirmed');
    this.event(kind,details);
  }
  fail(code){
    if(!this.wanted)return;this.state.error=code;this.metrics.add(this.state.phase,'errors');
    for(const key of STEP_KEYS)if(this.state.steps[key]==='running')this.step(key,'failed');
    this.stop(code);
  }
  publication(value){
    if(!this.wanted)return;this.state.events++;this.metrics.add('F','publications');
    if(this.state.events>30000){this.fail('event_budget');return;}
    if(this.state.events===1){this.step('publication','confirmed');this.event('first_publication');}
    if(!this.wanted)return;
    const parsed=inspect(value),event=parsed.event;
    if(!event){this.state.rejected++;this.metrics.add('F','parser_rejected');this.metrics.add('F',parsed.reason);if(this.state.rejected===1)this.event('parser_rejected');return;}
    this.metrics.add('F','event_'+event.type);
    if(event.type==='other'){this.state.unknown_events++;if(this.state.unknown_events===1)this.event('unknown_event');return;}
    if(event.type!=='message')return;
    if(this.ids.has(event.id)){this.state.duplicates++;this.metrics.add('F','duplicates');return;}
    this.ids.add(event.id);if(this.ids.size>200)this.ids.delete(this.ids.values().next().value);
    const b=event.badgeSet,selected=b.v2.items.filter(x=>x.selected===true).length,total=b.legacy.items.filter(x=>x.fields.type==='known'||x.fields.type==='unknown').length+selected;
    this.metrics.add('F','badge_messages',total?1:0);this.metrics.add('F','badge_legacy_items',b.legacy.items.length);this.metrics.add('F','badge_v2_items',b.v2.items.length);this.metrics.add('F','badge_selected_true',selected);this.metrics.add('F','badge_total_'+total);this.metrics.add('F','badge_over_four',total>4?1:0);this.metrics.add('F','badge_truncated_legacy',b.legacy.truncated?1:0);this.metrics.add('F','badge_truncated_v2',b.v2.truncated?1:0);
    this.state.messages++;if(this.state.messages===1){this.step('message','confirmed');this.event('first_normalized_message');}
    if(!this.wanted)return;
    const accepted=this.delivery.publication(event,this.delivery.lastPublication+1,Date.now());
    if(!accepted){this.metrics.add('F','delivery_refused');void this.stop('delivery_'+this.delivery.closeReason);}

  }
  flushSamples(){
    if(this.stopped)return;
    this.delivery.flush();this.state.samples_sent=this.delivery.counts.delivery_attempts;
    if(this.delivery.closed&&this.wanted)void this.stop('delivery_'+this.delivery.closeReason);
  }
  tick(){
    this.loopLagMax=Math.max(this.loopLagMax,Math.max(0,Date.now()-this.tickAt-1000));this.tickAt=Date.now();
    if(!this.consumers()){this.stop('last_consumer');return;}
    if(process.memoryUsage().rss>128*1024*1024){this.fail('memory_budget');return;}
    const elapsed=(Date.now()-this.state.reading_at)/1000;
    if(elapsed>=this.windowSeconds){
      this.state.checkpoints.push({seconds:this.windowSeconds,observed_seconds:elapsed,messages:this.state.messages,publications:this.state.events,transport_error:!!this.state.error});
      this.stop(this.state.messages?'observation_complete':this.state.events?'publications_without_message':'no_publications_observed');return;
    }
    this.event('status');
  }
  stop(reason,abort=reason==='memory_budget'){
    if(!this.attempted)return Promise.resolve();
    if(this.stopping){if(abort)this.abortDrain=true;return this.stopping;}
    if(/^delivery_/.test(reason))this.state.error=this.state.error||reason;
    this.abortDrain=abort;this.delivery.close(reason);this.delivery.draining();
    this.wanted=false;this.state.status='closing';this.state.reason=reason;this.state.ended_at=Date.now();
    for(const key of STEP_KEYS)if(['waiting','running'].includes(this.state.steps[key]))this.step(key,'not_observed');
    Object.values(this.timers).forEach(t=>{clearTimeout(t);clearInterval(t);});this.timers={};this.ids.clear();if(this.http)this.http.cancel();
    this.stopping=Promise.resolve().then(async()=>{
      if(this.protocol&&this.protocol.subscribed&&this.transport&&this.transport.ws&&this.transport.ws.readyState===1){
        let timer;try{await Promise.race([this.protocol.unsubscribe(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('unsubscribe_deadline')),1000);})]);}catch(_){this.metrics.add('cleanup','unsubscribe_incomplete');}finally{clearTimeout(timer);}
      }
      if(this.protocol)this.protocol.close();if(this.transport)await this.transport.close();
      const deadline=this.delivery.clock.mono()+this.delivery.cfg.drainMs;
      while(this.queue.length&&!this.abortDrain&&!this.delivery.fatal&&this.delivery.clock.mono()<deadline){this.flushSamples();await new Promise(resolve=>setTimeout(resolve,25));}
      if(this.queue.length)this.state.error=this.state.error||(this.abortDrain?'delivery_aborted':this.delivery.fatal||'drain_timeout');
      this.delivery.finish(this.queue.length>0);this.state.discarded_on_close=this.delivery.counts.discarded;
      this.metrics.add('cleanup','sessions_closed');this.state.status='stopped';this.stopped=true;this.event('stopped');
    });
    this.event('closing');return this.stopping;
  }
}
module.exports={Session,STEP_KEYS};
