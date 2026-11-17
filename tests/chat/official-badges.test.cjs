const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {badgeSet}=require('../../service/badges');
const root=path.resolve(__dirname,'../..'),packaging=require('../../packaging.json');
function api(){const context={window:{},Map,Set,URL};vm.runInNewContext(fs.readFileSync(path.join(root,'app/chat-badges.js'),'utf8'),context);return context.window.KickBadges;}
function select(identity){return api().select({badgeSet:badgeSet(identity)});}
const expected={moderator:'ModeratorBadge',subscriber:'SubscriberBadge',vip:'VIPBadge',og:'OGBadge',verified:'VerifiedBadge',bot:'BotBadge',broadcaster:'HostBadge',founder:'FounderBadge',staff:'StaffBadge',sidekick:'SidekickBadge',chat_identity:'IdentityBadge',trainwreckstv:'TrainwreckstvBadge'};
test('official legacy types survive normalization and resolve only to packaged local SVGs',()=>{
 for(const [type,icon] of Object.entries(expected)){
  const result=select({badges:[{type}]});assert.equal(result.length,1);assert.equal(result[0].icon,icon);
  assert(packaging.files.includes('badge-icons/'+icon+'.svg'));assert(fs.readFileSync(path.join(root,'app/badge-icons',icon+'.svg'),'utf8').includes('<svg'));
 }
 assert.equal(select({badges:[{type:'__proto__'}]})[0].icon,'question');
});
test('gift quantity selects all 28 official ranges, including both sides of every boundary',()=>{
 const thresholds=[1,5,10,25,50,100,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000,2000,3000,4000,5000];
 function icon(count){return select({badges:[{type:'sub_gifter',count}]})[0].icon;}
 thresholds.forEach((n,i)=>{assert.equal(icon(n),'Gift'+n);assert(packaging.files.includes('badge-icons/Gift'+n+'.svg'));if(i)assert.equal(icon(n-1),'Gift'+thresholds[i-1]);});
 for(const n of [0,-1,null,undefined,'5000',1.5])assert.equal(icon(n),'Gift1');
 assert.equal(icon(Number.MAX_SAFE_INTEGER),'Gift5000');
});
test('only selected v2 levels 1–99 use local SVGs; other v2 images keep their URL',()=>{
 function one(name,level,selected=true){return select({badges_v2:[{name,metadata:{level},selected,image_url:'https://files.kick.com/test.png'}]});}
 for(let level=1;level<=99;level++){
  const b=one('level',level)[0];assert.equal(b.kind,'v2-local');assert.equal(b.icon,'Level'+level);
  assert(packaging.files.includes('badge-icons/'+b.icon+'.svg'));
 }
 for(const level of [0,100,-1,'1',null]){const b=one('level',level)[0];assert.equal(b.kind,'v2');assert.equal(b.url,'https://files.kick.com/test.png');}
 assert.equal(one('level',1,false).length,0);assert.equal(one('other',1)[0].kind,'v2');
});
test('Founder uses the approved solid variant without embedded image or filters',()=>{
 const svg=fs.readFileSync(path.join(root,'app/badge-icons/FounderBadge.svg'),'utf8');
 assert(svg.includes('#3b2a08'));assert(!/base64|<image|<filter|feTurbulence/.test(svg));assert(Buffer.byteLength(svg)<1100);
});
