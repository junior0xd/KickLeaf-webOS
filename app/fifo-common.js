(function(root){'use strict';
const api={};
api.bytes=s=>new TextEncoder().encode(s).byteLength;
api.same=(a,b)=>a&&b&&['instance','run_id','session_id'].every(k=>a[k]===b[k]);
api.assert=(v,code)=>{if(!v)throw Error(code);};
// Production keeps aggregate counters only; no diagnostic ledger or message content.
class Journal{
 constructor(){this.total=0;}
 add(){this.total++;}
 snapshot(){return {events:this.total,retained_records:0};}
}
class Occupancy{
 constructor(clock,items,bytes){this.clock=clock;this.capItems=items;this.capBytes=bytes;this.started=clock.mono();this.at=this.started;this.n=0;this.bytes=0;this.units=0;this.itemArea=0;this.byteArea=0;this.maxItems=0;this.maxBytes=0;}
 set(n,bytes,units){const t=this.clock.mono();this.itemArea+=this.n*(t-this.at);this.byteArea+=this.bytes*(t-this.at);this.at=t;this.n=n;this.bytes=bytes;this.units=units;this.maxItems=Math.max(n,this.maxItems);this.maxBytes=Math.max(bytes,this.maxBytes);}
 snapshot(){this.set(this.n,this.bytes,this.units);const dt=this.at-this.started;return {items:this.n,utf8_bytes:this.bytes,utf16_units:this.units,max_items:this.maxItems,max_utf8_bytes:this.maxBytes,mean_items:dt?this.itemArea/dt:0,mean_utf8_bytes:dt?this.byteArea/dt:0,item_ms:this.itemArea,byte_ms:this.byteArea,capacity_items:this.capItems,capacity_bytes:this.capBytes};}
}
// Second-aligned rolling windows. No message records or periodic sampling.
const LOAD_WINDOWS=[1,5,30],LOAD_SLOTS=31;
class Load {
 constructor(clock){this.clock=clock;this.started=clock.mono();this.second=-1;this.position=LOAD_SLOTS-1;this.buckets=Array.from({length:LOAD_SLOTS},()=>[0,0,0]);this.sums=[[0,0,0],[0,0,0],[0,0,0]];this.peaks=[[0,0,0],[0,0,0],[0,0,0]];}
 add(index,count,time){
  const second=Math.floor((time-this.started)/1000);
  // Empty seconds can only lower a rolling sum.
  for(let step=Math.min(second-this.second,LOAD_SLOTS);step>0;step--){
   this.position=(this.position+1)%LOAD_SLOTS;
   for(let w=0;w<3;w++){
    const old=this.buckets[(this.position+LOAD_SLOTS-LOAD_WINDOWS[w])%LOAD_SLOTS];
    for(let i=0;i<3;i++)this.sums[w][i]-=old[i];
   }
   this.buckets[this.position].fill(0);
  }
  this.second=second;
  this.buckets[this.position][index]+=count;
  for(let w=0;w<3;w++){
   this.sums[w][index]+=count;
   this.peaks[w][index]=Math.max(this.peaks[w][index],this.sums[w][index]);
  }
 }
 snapshot(now=this.clock.mono()){
  const current=Math.floor((now-this.started)/1000),recent=[];
  for(let second=Math.max(0,current-30);second<current;second++){
   const gap=this.second-second;
   if(gap>=LOAD_SLOTS)continue;
   const counts=gap<0?[0,0,0]:this.buckets[(this.position+LOAD_SLOTS-gap)%LOAD_SLOTS];
   recent.push([second,...counts]);
  }
  return {windows_seconds:LOAD_WINDOWS.slice(),columns:['normalized','first_offered','confirmed'],peaks:this.peaks.map(row=>row.slice()),recent_1s:recent};
 }
}
api.Load=Load;
api.Journal=Journal;api.Occupancy=Occupancy;
api.config={renderItems:32,items:512,bytes:1048576,itemBytes:8192,flushMs:100,ackMs:2000,retries:3,maxSequence:60000,drainMs:60000};
api.hist=()=>({bounds:[0,.01,.025,.05,.1,.25,.5,1,2,4,8,16,32,64,128,256,512,750,1000,1500,2000,4000,8000,16000,32000],counts:Array(26).fill(0),n:0,sum:0,min:null,max:null,invalid:0});
api.observe=(h,x)=>{if(!Number.isFinite(x)||x<0){h.invalid++;return;}let i=0;while(i<h.bounds.length&&x>h.bounds[i])i++;h.counts[i]++;h.n++;h.sum+=x;h.min=h.min===null?x:Math.min(x,h.min);h.max=h.max===null?x:Math.max(x,h.max);};
api.percentile=(h,q)=>{let n=0;for(let i=0;i<h.counts.length;i++){n+=h.counts[i];if(n>=Math.ceil(h.n*q)&&h.n)return {lower:i?h.bounds[i-1]:0,upper:h.bounds[i]===undefined?null:h.bounds[i],exact:false};}return null;};
api.clock=()=>({mono:()=>performance.now(),wall:()=>Date.now()});
if(typeof module==='object')module.exports=api;else root.KickFIFOCommon=api;
})(typeof window==='object'?window:globalThis);
