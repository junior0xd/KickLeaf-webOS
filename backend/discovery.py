"""Descoberta sem cookies, Chromium, fingerprint de navegador ou proxy de vídeo."""
import json
import logging
import re
from urllib.parse import urlsplit

import httpx
from streamlink.stream.hls import M3U8Parser

# O parser upstream pode registrar linhas de playlists. Desative logs dessas
# bibliotecas neste processo para que URLs assinadas não cheguem aos handlers.
for name, logger in list(logging.Logger.manager.loggerDict.items()):
    if isinstance(logger, logging.Logger) and name.startswith(('streamlink', 'httpx', 'httpcore', 'urllib3')):
        logger.disabled = True

PUBLIC_HLS = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8'
CHANNEL = re.compile(r'^[a-zA-Z0-9_-]{1,25}$')


class DiscoveryError(Exception):
    def __init__(self, code, status=502):
        self.code, self.status = code, status
        super().__init__(code)  # Nunca preserve uma exceção com URL/token.


def safe_url(url, provider):
    if not isinstance(url, str) or len(url) > 16384:
        raise DiscoveryError('invalid_stream')
    p = urlsplit(url)
    host = (p.hostname or '').lower()
    allowed = host == 'devstreaming-cdn.apple.com' if provider == 'public-test' else (
        host == 'stream.kick.com' or host.endswith('.live-video.net'))
    if p.scheme != 'https' or not allowed or p.username or p.password or p.fragment or p.port not in (None, 443):
        raise DiscoveryError('unsupported_stream_origin')
    return url


def parse_manifest(text, url, provider):
    if not text.lstrip().startswith('#EXTM3U'):
        raise DiscoveryError('invalid_playlist')
    try:
        manifest = M3U8Parser(base_uri=url).parse(text)
    except Exception:
        raise DiscoveryError('invalid_playlist') from None
    # Não ofereça conteúdo protegido ao player desta PoC.
    if any(line.startswith(('#EXT-X-KEY:', '#EXT-X-SESSION-KEY:')) and 'METHOD=NONE' not in line for line in text.splitlines()):
        raise DiscoveryError('protected_stream_unsupported', 422)
    qualities = []
    for index, playlist in enumerate(manifest.playlists):
        if playlist.is_iframe:
            continue
        info = playlist.stream_info
        if not info or not info.resolution:
            continue  # Não apresente rendições de áudio como qualidades de vídeo.
        external_audio = any(m.type == 'AUDIO' and m.uri for m in playlist.media)
        width, height = info.resolution
        qualities.append({'id': f'variant-{index}', 'label': f'{height}p', 'width': width, 'height': height,
                          'bitrate': info.bandwidth, 'fps': info.framerate, 'codecs': info.codecs,
                          'url': safe_url(playlist.uri, provider) if not external_audio else None,
                          'selectable': not external_audio,
                          'reason': 'external_audio_requires_master' if external_audio else None})
    if not manifest.is_master and not manifest.segments:
        raise DiscoveryError('invalid_playlist')
    return qualities


class Discovery:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport

    async def resolve(self, channel):
        if not CHANNEL.fullmatch(channel):
            raise DiscoveryError('invalid_channel', 400)
        channel = channel.lower()
        provider = self.settings.provider
        # Sessão efêmera: não carrega cookie jar nem credenciais em disco.
        async with httpx.AsyncClient(timeout=self.settings.timeout, follow_redirects=False, transport=self.transport,
                                     headers={'User-Agent': 'KickTV-PoC/0.2', 'Accept': 'application/json'}) as client:
            async def fetch(url):
                # Também não reutiliza cookies eventualmente recebidos na resposta anterior.
                client.cookies.clear()
                async with client.stream('GET', url) as response:
                    if response.status_code in (401, 403):
                        raise DiscoveryError('upstream_access_denied', 403)
                    if response.status_code == 429:
                        raise DiscoveryError('upstream_rate_limited', 503)
                    if response.status_code != 200:
                        raise DiscoveryError('upstream_unavailable')
                    body = bytearray()
                    async for part in response.aiter_bytes():
                        body.extend(part)
                        if len(body) > 524288:
                            raise DiscoveryError('upstream_response_too_large')
                    return body.decode('utf-8')

            if provider == 'public-test':
                if channel != 'hls-test':
                    raise DiscoveryError('test_channel_required', 400)
                url = PUBLIC_HLS
            else:
                # Endpoint observado no plugin Kick 8.6.3, NÃO API pública oficial.
                raw = await fetch(f'https://kick.com/api/v2/channels/{channel}/livestream')
                try:
                    body = json.loads(raw)
                except ValueError:
                    raise DiscoveryError('invalid_upstream_response') from None
                if not isinstance(body, dict) or 'data' not in body:
                    raise DiscoveryError('invalid_upstream_response')
                if body['data'] is None:
                    return {'channel': channel, 'online': False, 'source': provider, 'playback': None}
                if not isinstance(body['data'], dict):
                    raise DiscoveryError('invalid_upstream_response')
                url = safe_url(body['data'].get('playback_url'), provider)
            url = safe_url(url, provider)
            qualities = parse_manifest(await fetch(url), url, provider)
            return {'channel': channel, 'online': True, 'source': provider,
                    'playback': {'type': 'hls', 'url': url, 'live': provider == 'kick',
                                 'qualities': qualities, 'expires_at': None,
                                 'direct_playback': 'candidate_not_verified_on_tv'}}
