'use strict';
const {VERSION}=require('./config');
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
class Protocol {
  constructor({send,metrics,notify,onPublication,onDisconnect,timeout=8000}) {
    Object.assign(this,{send,metrics,notify,onPublication,onDisconnect,timeout});
    this.next=0;this.pending=new Map();this.connected=false;this.subscribed=null;this.closed=false;
    this.pong=false;this.heartbeat=null;this.expiry=null;this.lastSeen=Date.now();
  }
  command(kind,data,phase) {
    if(!['connect','subscribe','unsubscribe'].includes(kind)||this.closed||this.pending.size>=2)return Promise.reject(new Error('command_not_allowed'));
    if((kind==='connect'&&(this.connected||this.pending.size))||(kind==='subscribe'&&(!this.connected||this.subscribed||this.pending.size)))return Promise.reject(new Error('invalid_protocol_state'));
    if(this.next>=6)return Promise.reject(new Error('command_budget'));
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('command_timeout'));},this.timeout);
      this.pending.set(id,{kind,channel:kind==='subscribe'?data.channel:null,resolve,reject,timer});
      this.metrics.add(phase,'commands');this.metrics.add(phase,kind+'_commands');
      try{this.send(JSON.stringify({id,[kind]:data}),phase);}catch(_){clearTimeout(timer);this.pending.delete(id);reject(new Error('command_send_error'));}
    });
  }
  activate(result) {
    const ping=Number(result.ping),ttl=Number(result.ttl);
    if(result.pong===true&&(!Number.isFinite(ping)||ping<=0||ping>300))throw new Error('invalid_heartbeat');
    if(result.expires&&(!Number.isFinite(ttl)||ttl<=5))throw new Error('invalid_lease');
    this.connected=true;this.pong=result.pong===true;this.lastSeen=Date.now();
    if(Number.isFinite(ping)&&ping>0&&ping<=300){
      this.pingSeconds=ping;
      this.heartbeat=setInterval(()=>{if(Date.now()-this.lastSeen>(ping+10)*1000)this.onDisconnect('heartbeat_timeout');},1000);
    }
    if(result.expires)this.expiry=setTimeout(()=>this.onDisconnect('lease_ending_no_refresh'),Math.min(ttl-5,3600)*1000);
    this.notify('protocol_connected',{server_version:typeof result.version==='string'&&/^[0-9. PRO-]{1,32}$/.test(result.version)?result.version:null,ping_seconds:this.pingSeconds||null,pong_required:this.pong,ttl_seconds:Number.isFinite(ttl)?ttl:null});
  }
  async connect(token){await this.command('connect',{token,name:'kicktv-chatprobe',version:VERSION},'D');if(this.closed)throw new Error('cancelled');}
  async subscribe(channel){
    if(!/^chatrooms\.[1-9][0-9]{0,14}\.v2$/.test(channel))throw new Error('invalid_room');
    await this.command('subscribe',{channel},'E');if(this.closed)throw new Error('cancelled');
  }
  receive(bytes,binary=false) {
    if(this.closed)return;
    if(binary||bytes.length>65536)throw new Error('protocol_frame_limit');
    const lines=bytes.toString('utf8').split('\n').filter(s=>s.trim());
    if(lines.length>64)throw new Error('protocol_batch_limit');
    for(const line of lines){
      if(this.closed)return;
      const r=JSON.parse(line);if(!object(r))throw new Error('protocol_invalid_envelope');this.lastSeen=Date.now();
      if(!Object.keys(r).length){
        this.metrics.add('F','heartbeats_received');
        if(this.connected&&this.pong){this.send('{}','F');this.metrics.add('F','heartbeats_sent');}
        this.notify('heartbeat_received');continue;
      }
      if(r.id!==undefined&&r.id!==0){
        if(!Number.isSafeInteger(r.id)||r.id<1)throw new Error('invalid_reply_id');
        const p=this.pending.get(r.id);if(!p)throw new Error('uncorrelated_reply');clearTimeout(p.timer);this.pending.delete(r.id);
        if(r.error){const code=Number.isInteger(r.error.code)?r.error.code:null;this.notify('protocol_error',{code,temporary:r.error.temporary===true});p.reject(new Error('centrifugo_'+(code===null?'error':code)));continue;}
        if(!object(r[p.kind])){p.reject(new Error('invalid_reply'));continue;}
        try{
          // Apply acknowledgements synchronously: the next line may already be a ping or publication.
          if(p.kind==='connect')this.activate(r.connect);
          if(p.kind==='subscribe'){this.subscribed=p.channel;this.metrics.add('E','subscriptions_confirmed');this.notify('subscribed');}
          if(p.kind==='unsubscribe'){this.subscribed=null;this.notify('unsubscribed');}
          p.resolve(r[p.kind]);
        }catch(error){p.reject(error);}
        continue;
      }
      if(!object(r.push))throw new Error('protocol_unknown_envelope');
      const push=r.push;
      if(push.disconnect){this.notify('server_disconnect',{code:Number.isInteger(push.disconnect.code)?push.disconnect.code:null});this.onDisconnect('server_disconnect');return;}
      if(push.unsubscribe&&push.channel===this.subscribed){this.onDisconnect('server_unsubscribe');return;}
      if(Object.prototype.hasOwnProperty.call(push,'pub')){
        this.metrics.add('F','publication_pushes_seen');
        if(push.channel===this.subscribed&&this.subscribed){this.onPublication(object(push.pub)?push.pub.data:undefined);}
        else this.metrics.add('F','publications_other_room');
      }else this.metrics.add('F','other_pushes');
    }
  }
  async unsubscribe(){if(!this.subscribed||this.closed)return;await this.command('unsubscribe',{channel:this.subscribed},'cleanup');}
  close(){
    this.closed=true;this.connected=false;this.subscribed=null;clearInterval(this.heartbeat);clearTimeout(this.expiry);this.heartbeat=this.expiry=null;
    this.pending.forEach(p=>{clearTimeout(p.timer);p.reject(new Error('cancelled'));});this.pending.clear();
  }
}
module.exports={Protocol};
