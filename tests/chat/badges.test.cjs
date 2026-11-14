const {test}=require('node:test'),assert=require('node:assert/strict');
const {badgeSet,LIMITS,LEGACY}=require('../../service/badges'),{normalize}=require('../../service/normalize');
const fixture=identity=>({event:'App\\Events\\ChatMessageEvent',data:{id:'synthetic-1',content:'Texto <img onerror=evil()>\ninalterado',sender:{username:'SYNTHETIC_AUTHOR',identity},created_at:'2026-01-01T12:00:00Z'}});
const legacy={type:'subscriber',text:'Subscriber',count:3};
const v2={name:'level',badge_type:'global',selected:false,sort_order:2,image_url:'https://synthetic.invalid/badge.png',metadata:{level:17}};
test('missing sources and invalid identities degrade to absent, without dropping a message',()=>{
 for(const v of [undefined,null,{},[],1]){const m=normalize(fixture(v));assert.equal(m.badgeSet.version,1);for(const k of ['legacy','v2'])assert.deepEqual(m.badgeSet[k],{state:'absent',items:[],rejected:0,truncated:false});}
});
test('source states distinguish absent, invalid, empty and nonempty even if every item is rejected',()=>{
 for(const [input,state] of [[null,'invalid'],[{},'invalid'],['x','invalid'],[[],'empty'],[[null,3],'items']]){
  const s=badgeSet({badges:input,badges_v2:input});assert.equal(s.legacy.state,state);assert.equal(s.v2.state,state);assert.equal(s.legacy.items.length,0);
 }
 assert.equal(badgeSet({badges:[null,3]}).legacy.rejected,2);
});
test('legacy known category, label, count and original index are preserved without units or extra fields',()=>{
 const b=badgeSet({badges:[null,{...legacy,active:true,unknown:{danger:'x'}}]}).legacy.items[0];
 assert.deepEqual(b,{index:1,type:'subscriber',text:'Subscriber',count:3,fields:{type:'known',text:'valid',count:'valid'}});
 assert.equal(b.months,undefined);assert.equal(b.active,undefined);
});
test('legacy recognized categories are exact, unknown values become markers without copying the discriminator',()=>{
 for(const type of LEGACY)assert.equal(badgeSet({badges:[{type}]}).legacy.items[0].fields.type,'known');
 for(const type of ['Moderator','channel','__proto__','constructor','UNKNOWN_SYNTHETIC']){const b=badgeSet({badges:[{type}]}).legacy.items[0];assert.equal(b.type,null);assert.equal(b.fields.type,'unknown');}
 for(const type of [null,{},1,'', 'x'.repeat(33)])assert.equal(badgeSet({badges:[{type}]}).legacy.items[0].fields.type,'invalid');
 assert.equal(badgeSet({badges:[{}]}).legacy.items[0].fields.type,'absent');
});
test('count accepts safe nonnegative integers only and absence differs from invalid',()=>{
 for(const count of [0,3,Number.MAX_SAFE_INTEGER])assert.equal(badgeSet({badges:[{count}]}).legacy.items[0].count,count);
 for(const count of [-1,1.5,'3',true,null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){const b=badgeSet({badges:[{count}]}).legacy.items[0];assert.equal(b.count,null);assert.equal(b.fields.count,'invalid');}
 assert.equal(badgeSet({badges:[{}]}).legacy.items[0].fields.count,'absent');
});
test('v2 preserves false and does not add active, role, image trust or visual policy',()=>{
 const b=badgeSet({badges_v2:[{...v2,active:true,unknown:'x'}]}).v2.items[0];
 assert.equal(b.name,'level');assert.equal(b.badge_type,'global');assert.equal(b.selected,false);assert.equal(b.sort_order,2);assert.equal(b.metadata.level,17);assert.equal(b.image_url,v2.image_url);
 assert.equal(b.fields.selected,'valid');assert.equal(b.active,undefined);assert.equal(b.trusted,undefined);assert.equal(b.visible,undefined);
});
test('selected true, false, absent and invalid are unambiguous; false is never filtered',()=>{
 const items=badgeSet({badges_v2:[{selected:true},{selected:false},{},{selected:null},{selected:'false'},{selected:1}]}).v2.items;
 assert.deepEqual(items.map(b=>b.selected),[true,false,null,null,null,null]);assert.deepEqual(items.map(b=>b.fields.selected),['valid','valid','absent','invalid','invalid','invalid']);
});
test('sort_order accepts signed safe integers, preserves raw array order, ties and source indices',()=>{
 const items=badgeSet({badges_v2:[{sort_order:8},null,{sort_order:-1},{sort_order:8},{},{sort_order:'2'}]}).v2.items;
 assert.deepEqual(items.map(b=>b.sort_order),[8,-1,8,null,null]);assert.deepEqual(items.map(b=>b.index),[0,2,3,4,5]);assert.equal(items[3].fields.sort_order,'absent');assert.equal(items[4].fields.sort_order,'invalid');
 for(const sort_order of [Number.MIN_SAFE_INTEGER,0,Number.MAX_SAFE_INTEGER])assert.equal(badgeSet({badges_v2:[{sort_order}]}).v2.items[0].sort_order,sort_order);
 for(const sort_order of [null,Infinity,1.1,Number.MAX_SAFE_INTEGER+1,true])assert.equal(badgeSet({badges_v2:[{sort_order}]}).v2.items[0].fields.sort_order,'invalid');
});
for(const [label,url] of Object.entries({http:'http://synthetic.invalid/x',relative:'/x',malformed:'https://[',credentials:'https://user:pass@synthetic.invalid/x',empty_credentials:'https://@synthetic.invalid/x',query:'https://synthetic.invalid/x?token=synthetic',fragment:'https://synthetic.invalid/x#part',port:'https://synthetic.invalid:444/x',backslash:'https://synthetic.invalid\\x',whitespace:' https://synthetic.invalid/x',scheme:'javascript:alert(1)',extra_slash:'https:///synthetic.invalid/x'})){
 test('inert image reference rejects '+label,()=>{const b=badgeSet({badges_v2:[{image_url:url}]}).v2.items[0];assert.equal(b.image_url,null);assert.equal(b.fields.image_url,'invalid');});
}
test('image references preserve a valid HTTPS original string and never claim a trusted origin',()=>{
 const image_url='HTTPS://synthetic.invalid:443/badge.png';assert.equal(badgeSet({badges_v2:[{image_url}]}).v2.items[0].image_url,image_url);
 assert.equal(badgeSet({badges_v2:[{}]}).v2.items[0].fields.image_url,'absent');
});
test('unknown v2 scope is represented without inventing channel or copying its raw discriminator',()=>{
 for(const badge_type of ['channel','other','GLOBAL']){const b=badgeSet({badges_v2:[{badge_type}]}).v2.items[0];assert.equal(b.badge_type,null);assert.equal(b.fields.badge_type,'unknown');}
 assert.equal(badgeSet({badges_v2:[{}]}).v2.items[0].fields.badge_type,'absent');
 assert.equal(badgeSet({badges_v2:[{badge_type:null}]}).v2.items[0].fields.badge_type,'invalid');
});
test('metadata and level states are validated locally without copying arbitrary metadata',()=>{
 const values=[{}, {metadata:null},{metadata:[]},{metadata:{}},{metadata:{level:0,unknown:'ignored'}},{metadata:{level:3}},{metadata:{level:-1}},{metadata:{level:'3'}}];
 const items=badgeSet({badges_v2:values}).v2.items;
 assert.deepEqual(items.map(b=>b.fields.metadata),['absent','invalid','invalid','valid','valid','valid','valid','valid']);
 assert.deepEqual(items.map(b=>b.fields.level),['absent','invalid','invalid','absent','valid','valid','invalid','invalid']);
 assert.deepEqual(items[4].metadata,{level:0});assert.equal(items[5].metadata.level,3);
});
test('both sources stay separate, retain duplicates, and the visual limit of four is not applied',()=>{
 const b=badgeSet({badges:Array(6).fill(legacy),badges_v2:Array(6).fill(v2)});assert.equal(b.legacy.items.length,6);assert.equal(b.v2.items.length,6);assert.equal(b.v2.items[5].selected,false);assert.equal(b.equivalences,undefined);
});
test('mixed arrays reject only nonobjects and preserve original indices of object records',()=>{
 const b=badgeSet({badges:[null,[],legacy,3,{},false],badges_v2:[[],v2,null,{}]});assert.equal(b.legacy.rejected,4);assert.deepEqual(b.legacy.items.map(x=>x.index),[2,4]);assert.equal(b.v2.rejected,2);assert.deepEqual(b.v2.items.map(x=>x.index),[1,3]);
});
test('item and scan limits are independent with explicit truncation and bounded rejected counts',()=>{
 const b=badgeSet({badges:Array(1000).fill(legacy),badges_v2:[...Array(16).fill(null),v2]});assert.equal(b.legacy.items.length,LIMITS.items);assert.equal(b.legacy.truncated,true);assert.equal(b.v2.items.length,0);assert.equal(b.v2.rejected,LIMITS.scan);assert.equal(b.v2.truncated,true);
 const sparse=Array(1e6);assert.equal(badgeSet({badges:sparse}).legacy.rejected,16);
});
test('long strings invalidate only their own fields and leave the chat content intact',()=>{
 const input=fixture({color:'#FFAA99',badges:[{type:'x'.repeat(33),text:'x'.repeat(41)}],badges_v2:[{name:'x'.repeat(65),image_url:'https://synthetic.invalid/'+'x'.repeat(1024)}]});
 const m=normalize(input);assert.equal(m.text,input.data.content);assert.equal(m.color,'#FFAA99');assert.equal(m.badgeSet.legacy.items[0].text,null);assert.equal(m.badgeSet.v2.items[0].name,null);assert.equal(m.badgeSet.v2.items[0].image_url,null);
});
test('hostile labels are inert strings, controls are removed and unknown keys never leak',()=>{
 const raw=JSON.parse('{"badges":[{"type":"moderator","text":"<img onerror=evil()>\\u202e","__proto__":{"polluted":true}}],"badges_v2":[{"name":"<script>evil()</script>","metadata":{"level":1,"cookie":"SYNTHETIC_SECRET"},"token":"SYNTHETIC_SECRET"}]}');
 const b=badgeSet(raw);assert.equal(b.legacy.items[0].text,'<img onerror=evil()>');assert.match(b.v2.items[0].name,/<script>/);assert.equal({}.polluted,undefined);assert.equal(JSON.stringify(b).includes('SYNTHETIC_SECRET'),false);
});
test('JSON roundtrip preserves explicit states, values, separation and indices',()=>{
 const b=badgeSet({badges:[null,legacy],badges_v2:[v2,{}]});assert.deepEqual(JSON.parse(JSON.stringify(b)),b);
});
test('existing message fields and legacy projection remain compatible; nonmessages are unchanged',()=>{
 const e=fixture({color:'#FFAA99',badges:[legacy],badges_v2:[v2]});e.data.type='reply';e.data.metadata={original_message:{id:'synthetic-parent'}};
 const m=normalize(e);assert.equal(m.id,e.data.id);assert.equal(m.user,e.data.sender.username);assert.equal(m.text,e.data.content);assert.equal(m.timestamp,e.data.created_at);assert.equal(m.color,'#FFAA99');assert.deepEqual(m.badges,[{type:'subscriber',text:'Subscriber'}]);assert.deepEqual(m.emotes,[]);
 for(const [name,type] of [['MessageDeletedEvent','delete'],['UserBannedEvent','ban'],['ChatroomClearEvent','clear']])assert.deepEqual(normalize({event:name,data:{}}),{type});
});
test('maximum bounded badgeSet serialization stays below 20 KiB per message',()=>{
 const prefix='https://synthetic.invalid/',image_url=prefix+'x'.repeat(LIMITS.image-prefix.length);
 const b=badgeSet({badges:Array(8).fill({type:'subscriber',text:'x'.repeat(40),count:Number.MAX_SAFE_INTEGER}),badges_v2:Array(8).fill({...v2,name:'x'.repeat(64),image_url,sort_order:Number.MAX_SAFE_INTEGER,metadata:{level:Number.MAX_SAFE_INTEGER}})});
 assert.equal(b.v2.items[0].fields.image_url,'valid');assert(Buffer.byteLength(JSON.stringify(b))<20*1024);
});
test('wire bound also handles worst-case escaped Unicode labels; raw non-ASCII URLs are rejected',()=>{
 const prefix='https://synthetic.invalid/',image_url=prefix+'x'.repeat(LIMITS.image-prefix.length);
 const b=badgeSet({badges:Array(8).fill({...legacy,text:'\ud800'.repeat(40)}),badges_v2:Array(8).fill({...v2,name:'\ud800'.repeat(64),image_url})});
 assert(Buffer.byteLength(JSON.stringify(b))<20*1024);
 for(const image_url of ['https://synthetic.invalid/á','https://synthetic.invalid/\ud800'])assert.equal(badgeSet({badges_v2:[{image_url}]}).v2.items[0].fields.image_url,'invalid');
});
