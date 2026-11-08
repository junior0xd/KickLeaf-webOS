const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parse, mediaURL} = require('../app/hls-manifest.js');
const MASTER='https://test.playback.live-video.net/path/master.m3u8?token=FAKE';
test('limita URLs a HTTPS de CDN, sem credenciais, portas e origens arbitrárias',()=>{
  assert.equal(mediaURL('../720.m3u8',MASTER),'https://test.playback.live-video.net/720.m3u8');
  for(const value of ['http://stream.kick.com/a','https://evil.test/a','https://live-video.net.evil.test/a','https://a@stream.kick.com/a','https://stream.kick.com:444/a','javascript:alert(1)','https://stream.kick.com/a#token',null]) assert.throws(()=>mediaURL(value));
});
test('extrai resolução, bitrate, FPS e lista CODECS com vírgula entre aspas',()=>{
  const result=parse('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,FRAME-RATE=59.940,CODECS="avc1.64001f,mp4a.40.2"\n720.m3u8\n',MASTER);
  assert.equal(result.kind,'master');
  assert.deepEqual(result.qualities[0],{id:'variant-0',label:'720p',width:1280,height:720,bitrate:2500000,fps:59.94,codecs:['avc1.64001f','mp4a.40.2'],url:'https://test.playback.live-video.net/path/720.m3u8',selectable:true,reason:null});
});
test('áudio externo, grupos desconhecidos e vídeo externo não oferecem seleção manual',()=>{
  for(const group of ['#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"','', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8",DEFAULT=YES', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI=""']){
    const result=parse('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4,AUDIO="a"\nv.m3u8\n'+group,MASTER);
    assert.equal(result.qualities[0].selectable,false); assert.equal(result.qualities[0].url,null);
  }
  const muxed=parse('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Muxed"\n#EXT-X-STREAM-INF:AUDIO="a"\nv.m3u8',MASTER);
  assert.equal(muxed.qualities[0].selectable,true);
  assert.equal(parse('#EXTM3U\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="v",URI="video.m3u8"\n#EXT-X-STREAM-INF:VIDEO="v"\nv.m3u8',MASTER).qualities[0].selectable,false);
});
test('playlist de mídia sem variantes preserva Auto; URI inválida não é oferecida',()=>{
  assert.deepEqual(parse('\uFEFF#EXTM3U\r\n#EXTINF:4,\r\nseg.ts\r\n',MASTER),{kind:'media',qualities:[]});
  assert.equal(parse('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://evil.test/a',MASTER).qualities[0].selectable,false);
});
test('rejeita manifesto inválido, enorme, incompleto ou variantes demais',()=>{
  for(const text of ['<html>error</html>','#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1','#EXTM3U\n'+ 'x'.repeat(524288),'#EXTM3U\n'+ '#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n'.repeat(65)]) assert.throws(()=>parse(text,MASTER));
});
