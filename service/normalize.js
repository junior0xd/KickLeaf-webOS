'use strict';
const {badgeSet}=require('./badges');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function text(v,n){return typeof v==='string'?v.slice(0,n).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''):'';}
function decode(v){if(typeof v!=='string')return v;if(Buffer.byteLength(v)>32768)throw new Error('payload_limit');return JSON.parse(v);}
function inspect(value){
  try{
    value=decode(value);if(!object(value))return {reason:'invalid_envelope'};
    if(typeof value.event!=='string'||value.event.length>160)return {reason:'missing_event_type'};
    const name=value.event.split('\\').pop();
    const kinds={ChatMessageEvent:'message',MessageDeletedEvent:'delete',ChatroomClearEvent:'clear',UserBannedEvent:'ban',UserUnbannedEvent:'unban',PinnedMessageCreatedEvent:'pin',PinnedMessageDeletedEvent:'unpin',PollUpdateEvent:'poll',PollDeleteEvent:'poll_delete'};
    if(!Object.prototype.hasOwnProperty.call(kinds,name))return {event:{type:'other'},reason:'unknown_event'};
    const data=decode(value.data);if(!object(data))return {reason:'invalid_event_data'};
    const kind=kinds[name];if(kind!=='message')return {event:{type:kind}};
    if(!object(data.sender)||typeof data.sender.username!=='string'||!data.sender.username.length||typeof data.content!=='string')return {reason:'invalid_message_fields'};
    const id=typeof data.id==='string'?text(data.id,128):Number.isSafeInteger(data.id)&&data.id>0?String(data.id):'';
    if(!id)return {reason:'missing_message_id'};
    const timestamp=typeof data.created_at==='string'&&Number.isFinite(Date.parse(data.created_at))?data.created_at.slice(0,40):null;
    const rawColor=object(data.sender.identity)?data.sender.identity.color:null;
    const color=typeof rawColor==='string'&&rawColor.length===7&&/^#[0-9a-fA-F]{6}$/.test(rawColor)?rawColor:null;
    const badges=object(data.sender.identity)&&Array.isArray(data.sender.identity.badges)?data.sender.identity.badges.slice(0,8).filter(object).map(b=>({type:text(b.type,32),text:text(b.text,40)})):[];
    const emotes=[],content=text(data.content,2000),re=/\[emote:([0-9]{1,15}):([^\]\r\n]{1,80})\]/g;let m;
    while((m=re.exec(content))&&emotes.length<24)emotes.push({id:m[1],name:m[2]});
    return {event:{type:'message',id,user:text(data.sender.username,80),text:content,timestamp,color,emotes,badges,badgeSet:badgeSet(data.sender.identity)}};
  }catch(_){return {reason:'invalid_json_or_size'};}
}
function normalize(value){return inspect(value).event||null;}
module.exports={normalize,inspect};
