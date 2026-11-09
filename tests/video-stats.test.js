const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../app/video-stats.js');
function fixture(variant=null){
  let time=0;
  const video=new EventTarget();
  Object.assign(video,{videoWidth:1920,videoHeight:1080,currentTime:10,paused:false,ended:false,seeking:false,readyState:4,
    buffered:{length:2,start:i=>[0,40][i],end:i=>[18.4,50][i]},seekable:{length:1,start:()=>0,end:()=>25},frames:600,dropped:12});
  video.getVideoPlaybackQuality=()=>({totalVideoFrames:video.frames,droppedVideoFrames:video.dropped});
  const stats=create({now:()=>time});stats.attach(video,{quality:variant?'variant-0':'auto',variant,live:true});
  return {video,stats,tick:ms=>{time+=ms;},emit:name=>video.dispatchEvent(new Event(name))};
}
test('mede resolução, buffer contíguo e contadores sem confundir borda com latência',()=>{
  const {stats,video}=fixture();const s=stats.snapshot();
  assert.equal(s.width,1920);assert.equal(s.height,1080);assert.ok(Math.abs(s.buffered_ahead_seconds-8.4)<1e-9);
  assert.equal(s.live_edge_gap_seconds,15);assert.equal(s.absolute_latency_seconds,null);
  assert.equal(s.dropped_frames,12);assert.equal(s.total_frames,600);assert.equal(s.observed_presented_fps,null);
  video.currentTime=30;assert.equal(stats.snapshot().buffered_ahead_seconds,0);assert.equal(stats.snapshot().live_edge_gap_seconds,null);
});
test('Auto não infere variante, codecs, FPS nominal nem bitrate; manual usa metadados declarados',()=>{
  assert.equal(fixture().stats.snapshot().nominal_bitrate,null);
  const variant={label:'1080p',fps:60,bitrate:6200000,codecs:['avc1.640028','mp4a.40.2'],url:'https://secret.test/?token=PRIVATE'};
  const {stats}=fixture(variant);const s=stats.snapshot();
  assert.equal(s.nominal_bitrate,6200000);assert.equal(s.nominal_fps,60);assert.equal(s.quality_label,'1080p');
  assert.deepEqual(s.declared_codecs,['avc1.640028','mp4a.40.2']);assert.doesNotMatch(JSON.stringify(s),/PRIVATE|secret|https:/);
});
test('estima FPS por delta de quadros apresentados e tempo, invalidando pausa/reset',()=>{
  const {stats,video,tick,emit}=fixture();emit('playing');stats.snapshot();tick(1000);video.frames+=60;video.dropped+=2;
  assert.equal(stats.snapshot().observed_presented_fps,58);assert.equal(stats.snapshot().observed_presented_fps,58);
  emit('pause');assert.equal(stats.snapshot().observed_presented_fps,null);
  emit('playing');stats.snapshot();tick(1000);video.frames=10;video.dropped=0;assert.equal(stats.snapshot().observed_presented_fps,null);
  stats.resetSample();assert.equal(stats.snapshot().observed_presented_fps,null);
  video.frames=0;video.dropped=0;stats.snapshot();tick(1000);assert.equal(stats.snapshot().observed_presented_fps,null);
});
test('buffering exclui carga inicial, pausas e busca; agrupa waiting e mede tempo monotônico',()=>{
  const {stats,video,tick,emit}=fixture();emit('waiting');tick(2000);assert.equal(stats.snapshot().buffering_count,0);
  emit('playing');emit('waiting');emit('waiting');tick(2500);assert.equal(stats.snapshot().buffering_count,1);assert.equal(stats.snapshot().buffering_seconds,2.5);
  video.paused=true;emit('pause');tick(5000);emit('waiting');assert.equal(stats.snapshot().buffering_seconds,2.5);
  video.paused=false;emit('playing');video.seeking=true;emit('seeking');emit('waiting');assert.equal(stats.snapshot().buffering_count,1);
  video.seeking=false;emit('seeked');emit('playing');emit('waiting');tick(1200);emit('playing');
  assert.equal(stats.snapshot().buffering_count,2);assert.equal(stats.snapshot().buffering_seconds,3.7);
});
test('APIs ausentes/lançando e números inválidos retornam N/D, sem Infinity/NaN',()=>{
  const {stats,video}=fixture({bitrate:Infinity,fps:NaN,codecs:['https://secret.test/']});
  video.getVideoPlaybackQuality=undefined;video.videoWidth=0;video.videoHeight=NaN;
  let s=stats.snapshot();assert.equal(s.total_frames,null);assert.equal(s.width,null);assert.equal(s.height,null);assert.equal(s.nominal_bitrate,null);assert.deepEqual(s.declared_codecs,[]);
  for(const value of [{totalVideoFrames:-1,droppedVideoFrames:0},{totalVideoFrames:5,droppedVideoFrames:6},{totalVideoFrames:Infinity,droppedVideoFrames:NaN}]){
    video.getVideoPlaybackQuality=()=>value;assert.equal(stats.snapshot().total_frames,null);
  }
  video.getVideoPlaybackQuality=()=>{throw new Error('unsupported');};
  video.buffered={get length(){throw new Error('changing source');}};
  s=stats.snapshot();assert.equal(s.buffered_ahead_seconds,null);assert.equal(s.total_frames,null);assert.equal(s.live_edge_gap_seconds,15);
  video.buffered={length:1,start:()=>20,end:()=>10};assert.equal(stats.snapshot().buffered_ahead_seconds,null);
  video.buffered={length:NaN};assert.equal(stats.snapshot().buffered_ahead_seconds,null);
});
test('troca de vídeo remove todos os listeners, reseta métricas e ignora eventos antigos',()=>{
  const {stats,video,emit,tick}=fixture();const counts={added:0,removed:0};
  stats.detach();const add=video.addEventListener.bind(video),remove=video.removeEventListener.bind(video);
  video.addEventListener=(...args)=>{counts.added++;return add(...args);};video.removeEventListener=(...args)=>{counts.removed++;return remove(...args);};
  for(let i=0;i<20;i++){stats.attach(video,{quality:'auto',live:true});emit('playing');emit('waiting');tick(100);stats.detach();assert.equal(stats.snapshot(),null);}
  assert.equal(counts.added,counts.removed);
  stats.setPhase('discovering');assert.equal(stats.state(),'discovering');assert.equal(stats.snapshot(),null);emit('playing');assert.equal(stats.state(),'discovering');
});
for(const end of ['ended','error'])test(end+' encerra buffering e invalida FPS',()=>{
  const {stats,emit,tick}=fixture();emit('playing');emit('waiting');tick(1000);emit(end);tick(5000);
  assert.equal(stats.snapshot().state,end);assert.equal(stats.snapshot().buffering_seconds,1);assert.equal(stats.snapshot().observed_presented_fps,null);
});
