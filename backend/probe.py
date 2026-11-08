"""Experimento finito: mantém URLs na memória e escreve só resultados filtrados."""
import argparse
import asyncio
import hashlib
import inspect
import json
from pathlib import Path
import secrets
import subprocess
from datetime import datetime, timezone

import httpx
import streamlink
from streamlink.plugins import kick
from streamlink.stream.hls import M3U8Parser
from .settings import Settings
from .discovery import Discovery, DiscoveryError, safe_url


async def run(provider, channel, browser, output):
    result = {'date': datetime.now(timezone.utc).isoformat(), 'provider': provider, 'channel': channel,
              'environment': 'Ubuntu Linux; não webOS', 'streamlink_version': streamlink.__version__,
              'plugin_sha256': hashlib.sha256(inspect.getsource(kick).encode()).hexdigest(),
              'tv_tested': False, 'challenge_browser_used': False, 'cookies_used': False}
    try:
        data = await Discovery(Settings(token=secrets.token_urlsafe(32), provider=provider)).resolve(channel)
        result['online'] = data['online']
        if data['online']:
            result['qualities'] = [{k:q[k] for k in ('label','width','height','bitrate','fps','selectable')} for q in data['playback']['qualities']]
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                response = await client.get(data['playback']['url'])
                response.raise_for_status()
                manifest = M3U8Parser(base_uri=data['playback']['url']).parse(response.text)
            # Escolhe uma variante real, mantendo seu áudio externo se houver.
            playlist = next((p for p in manifest.playlists if not p.is_iframe and p.stream_info.resolution), None)
            lines = ['#EXTM3U']
            if playlist:
                uri = safe_url(playlist.uri, provider)
                audio = next((m for m in playlist.media if m.type == 'AUDIO' and m.uri), None)
                if audio:
                    audio_uri = safe_url(audio.uri, provider)
                    lines.append(f'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="probe",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="{audio_uri}"')
                lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={playlist.stream_info.bandwidth}' + (',AUDIO="probe"' if audio else ''))
                lines.append(uri)
                stdin = ('\n'.join(lines)+'\n').encode()
                flags = ['-v','error','-protocol_whitelist','pipe,https,tls,tcp,crypto,http,httpproxy','-rw_timeout','10000000','-f','hls','-i','pipe:0']
                try:
                    probe = subprocess.run(['ffprobe',*flags,'-analyzeduration','1500000','-probesize','2000000','-show_entries','stream=codec_name,codec_type,width,height,r_frame_rate','-of','json'],input=stdin,capture_output=True,timeout=30)
                    result['ffprobe_exit'] = probe.returncode
                    if probe.returncode == 0: result['streams'] = json.loads(probe.stdout).get('streams',[])
                    decoded = subprocess.run(['ffmpeg',*flags,'-frames:v','1','-t','1','-f','null','-'],input=stdin,capture_output=True,timeout=30)
                    result['ffmpeg_decode_exit'] = decoded.returncode
                except subprocess.TimeoutExpired: result['decoder_timeout'] = True
            if browser:
                process = subprocess.run(['node','scripts/probe-native-hls.cjs'],input=json.dumps(data).encode(),capture_output=True,timeout=35)
                result['browser'] = json.loads(process.stdout) if process.returncode == 0 else {'error':'browser_probe_failed'}
    except DiscoveryError as exc:
        result['error_code'] = exc.code
    except Exception as exc:
        result['error_type'] = type(exc).__name__  # Não inclui mensagem, URL ou traceback.
    if output: Path(output).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--provider',choices=['public-test','kick'],default='public-test')
    p.add_argument('--channel',default='hls-test')
    p.add_argument('--browser',action='store_true')
    p.add_argument('--output')
    args=p.parse_args()
    asyncio.run(run(args.provider,args.channel,args.browser,args.output))
