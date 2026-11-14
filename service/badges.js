'use strict';
// Structural metadata only. No selection, equivalence, image loading or display order policy.
const LIMITS=Object.freeze({scan:16,items:8,type:32,text:40,name:64,image:1024});
const LEGACY=Object.freeze(['moderator','subscriber','sub_gifter','vip','og','broadcaster','founder','verified','staff','bot']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const has=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
function field(v,key,accept){
  if(!has(v,key))return {value:null,state:'absent'};
  return accept(v[key])?{value:v[key],state:'valid'}:{value:null,state:'invalid'};
}
function string(v,n){return typeof v==='string'&&v.length>0&&v.length<=n;}
function label(v,key,n){
  const f=field(v,key,x=>string(x,n));
  if(f.state==='valid')f.value=f.value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'');
  if(f.value==='')return {value:null,state:'invalid'};
  return f;
}
function kind(v,key,known){
  const f=field(v,key,x=>string(x,LIMITS.type));
  if(f.state==='valid')return known.includes(f.value)?{value:f.value,state:'known'}:{value:null,state:'unknown'};
  return f;
}
function image(value){
  if(!string(value,LIMITS.image)||!/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(value)||/[^\x21-\x7e]|\\/.test(value))return false;
  try{
    const u=new URL(value),authority=value.slice(value.indexOf('//')+2).split(/[/?#]/)[0];
    // Inert reference, not a trusted origin. No credentials, query/fragment or non-default port.
    return u.protocol==='https:'&&!!u.hostname&&!authority.includes('@')&&!u.username&&!u.password&&!u.port&&!value.includes('?')&&!value.includes('#');
  }catch(_){return false;}
}
function legacy(v,index){
  const type=kind(v,'type',LEGACY),text=label(v,'text',LIMITS.text),count=field(v,'count',x=>Number.isSafeInteger(x)&&x>=0);
  return {index,type:type.value,text:text.value,count:count.value,fields:{type:type.state,text:text.state,count:count.state}};
}
function modern(v,index){
  const name=label(v,'name',LIMITS.name),type=kind(v,'badge_type',['global']);
  const selected=field(v,'selected',x=>typeof x==='boolean'),order=field(v,'sort_order',Number.isSafeInteger),url=field(v,'image_url',image);
  const metadata=!has(v,'metadata')?'absent':object(v.metadata)?'valid':'invalid';
  const level=metadata==='valid'?field(v.metadata,'level',x=>Number.isSafeInteger(x)&&x>=0):{value:null,state:metadata==='absent'?'absent':'invalid'};
  return {index,name:name.value,badge_type:type.value,selected:selected.value,sort_order:order.value,image_url:url.value,metadata:{level:level.value},
    fields:{name:name.state,badge_type:type.state,selected:selected.state,sort_order:order.state,image_url:url.state,metadata,level:level.state}};
}
function source(identity,key,convert){
  const out={state:'absent',items:[],rejected:0,truncated:false};
  if(!has(identity,key))return out;
  const raw=identity[key];if(!Array.isArray(raw)){out.state='invalid';return out;}
  out.state=raw.length?'items':'empty';
  let i=0;
  for(;i<raw.length&&i<LIMITS.scan&&out.items.length<LIMITS.items;i++){
    if(!has(raw,i)||!object(raw[i])){out.rejected++;continue;}
    out.items.push(convert(raw[i],i));
  }
  out.truncated=i<raw.length;return out;
}
function badgeSet(identity){
  identity=object(identity)?identity:{};
  return {version:1,legacy:source(identity,'badges',legacy),v2:source(identity,'badges_v2',modern)};
}
module.exports={badgeSet,LIMITS,LEGACY};
