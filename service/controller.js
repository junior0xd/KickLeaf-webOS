'use strict';
const {slug}=require('./config');
const ID=/^[a-zA-Z0-9_-]{1,64}$/;
class Controller {
  constructor({makeSession,emit,consumers}){
    Object.assign(this,{makeSession,emit,consumers});this.current=null;this.intent=null;this.chain=Promise.resolve();this.serial=0;
    this.blocked=false;this.totals={sessions:0,starts_requested:0,connections_opened:0,http_requests:0};this.recent=[];
  }
  snapshot(){return {session_id:this.current?.id||null,session:this.current?this.current.session.snapshot():null,totals:{...this.totals},blocked:this.blocked,recent:this.recent.slice()};}
  start(p){
    let channel;try{channel=slug(p.channel);if(!ID.test(p.requestId))throw Error();}catch(_){return Promise.resolve({returnValue:false,errorText:'invalid_selection'});}
    if(this.blocked)return Promise.resolve({returnValue:false,errorText:'permanent_refusal'});
    if(this.intent===p.requestId)return Promise.resolve({returnValue:true,duplicate:true,snapshot:this.snapshot()});
    this.intent=p.requestId;const ticket=++this.serial;this.totals.starts_requested++;
    const run=async()=>{
      if(this.current)await this.current.session.stop('explicit_replacement');
      if(ticket!==this.serial||this.intent!==p.requestId||!this.consumers())return {returnValue:false,errorText:'cancelled'};
      const current={id:p.requestId,session:null};
      current.session=this.makeSession(e=>{
        if(e.kind==='stopped'){
          const metrics=e.snapshot.metrics;
          this.totals.connections_opened+=metrics.phases.C?.connections_opened||0;
          this.totals.http_requests+=metrics.http.length;
          this.recent.push({id:current.id,reason:e.snapshot.reason,error:e.snapshot.error,messages:e.snapshot.messages,events:e.snapshot.events});if(this.recent.length>8)this.recent.shift();
          if(/^(http_(401|403|404|429)|upgrade_http_(401|403|404|429)|centrifugo_|invalid_guest_token)/.test(e.snapshot.error||''))this.blocked=true;
        }
        this.emit({...e,session_id:current.id});
      });
      this.current=current;this.totals.sessions++;
      const r=current.session.start({channel,activityConfirmed:true});return {...r,session_id:current.id};
    };
    const result=this.chain.then(run,run);this.chain=result.catch(()=>{});return result;
  }
  async stop(id,reason='manual_stop'){
    if(id&&this.intent&&id!==this.intent)return this.snapshot();
    if(id&&id!==this.intent&&id!==this.current?.id)return this.snapshot();
    this.intent=null;this.serial++;
    if(this.current)await this.current.session.stop(reason);
    return this.snapshot();
  }
}
module.exports={Controller};
