import asyncio
import json
import pytest
import httpx
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.settings import Settings
from backend.discovery import Discovery, DiscoveryError, parse_manifest

TOKEN = 'test-token-' + 'x' * 32
AUTH = {'Authorization': 'Bearer ' + TOKEN}
CDN = 'https://test.playback.live-video.net/master.m3u8?token=FAKE_PRIVATE_TOKEN'
MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,FRAME-RATE=60,CODECS="avc1.4d401f,mp4a.40.2"\n720.m3u8\n'


def client(handler, provider='kick', timeout=1, remote='127.0.0.1'):
    settings = Settings(token=TOKEN, provider=provider, timeout=timeout)
    resolver = Discovery(settings, httpx.MockTransport(handler))
    return TestClient(create_app(settings, resolver), client=(remote, 50000))


def live(request):
    assert 'authorization' not in request.headers  # Token local nunca vai à Kick/CDN.
    if request.url.host == 'kick.com':
        assert not request.headers.get('cookie')
        assert 'sec-ch-ua' not in request.headers
        return httpx.Response(200, json={'data': {'playback_url': CDN}}, headers={'set-cookie': 'never=forward-this'})
    assert not request.headers.get('cookie')
    return httpx.Response(200, text=MASTER)


def test_live_metadata_and_no_cache():
    response = client(live).get('/api/streams/Yoda', headers=AUTH)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    data = response.json()
    assert data['channel'] == 'yoda' and data['online'] is True
    assert data['playback']['url'] == CDN
    assert data['playback']['qualities'][0]['height'] == 720
    assert data['playback']['qualities'][0]['bitrate'] == 2000000
    assert data['playback']['qualities'][0]['selectable'] is True


@pytest.mark.parametrize('channel', ['bad.name', 'a'*26, 'with space', '<script>'])
def test_invalid_channel(channel):
    def no_network(request):
        pytest.fail('Entrada inválida não deve consultar upstream')
    assert client(no_network).get('/api/streams/' + channel, headers=AUTH).status_code == 400


def test_offline_is_explicit_null_not_network_failure():
    response = client(lambda r: httpx.Response(200, json={'data': None})).get('/api/streams/minerva', headers=AUTH)
    assert response.json()['online'] is False and response.json()['playback'] is None


@pytest.mark.parametrize('status, expected', [(403, 403), (401, 403), (429, 503), (500, 502), (302, 502)])
def test_access_errors_are_not_offline_or_challenge_retried(status, expected):
    calls = []
    def denied(request):
        calls.append(request)
        return httpx.Response(status, text='FAKE_PRIVATE_TOKEN')
    response = client(denied).get('/api/streams/yoda', headers=AUTH)
    assert response.status_code == expected
    assert response.json()['online'] is None and len(calls) == 1
    assert 'FAKE_PRIVATE_TOKEN' not in response.text


def test_auth_and_local_network():
    c = client(live)
    assert c.get('/api/streams/yoda').status_code == 401
    assert c.get('/api/streams/yoda', headers={'Authorization':'Bearer wrong'}).status_code == 401
    assert client(live, remote='8.8.8.8').get('/api/streams/yoda', headers=AUTH).status_code == 403


def test_cors_preflight_and_authenticated_error():
    c = client(live)
    response = c.options('/api/streams/yoda', headers={'Origin':'null','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'})
    assert response.status_code == 200 and response.headers['access-control-allow-origin'] == 'null'
    response = c.get('/api/streams/yoda', headers={'Origin':'null'})
    assert response.status_code == 401 and response.headers['access-control-allow-origin'] == 'null'
    assert 'access-control-allow-origin' not in c.get('/api/streams/yoda', headers={**AUTH,'Origin':'https://untrusted.test'}).headers


def test_timeout_and_unknown_errors_redacted():
    class Slow:
        async def resolve(self, channel): await asyncio.sleep(1)
    settings = Settings(token=TOKEN, timeout=0.01)
    c = TestClient(create_app(settings, Slow()), client=('127.0.0.1',50000))
    assert c.get('/api/streams/yoda', headers=AUTH).status_code == 504
    class Broken:
        async def resolve(self, channel): raise RuntimeError(CDN)
    response = TestClient(create_app(settings, Broken()), client=('127.0.0.1',50000)).get('/api/streams/yoda', headers=AUTH)
    assert response.status_code == 502 and 'FAKE_PRIVATE_TOKEN' not in response.text


def test_upstream_shape_and_origin_validation():
    for body in [{}, {'data':{}}, {'data':{'playback_url':'https://untrusted.test/private'}}, {'data':{'playback_url':'http://127.0.0.1/secret'}}]:
        assert client(lambda r: httpx.Response(200,json=body)).get('/api/streams/yoda',headers=AUTH).status_code == 502


def test_separate_audio_cannot_be_selected_as_video_only_variant():
    master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="en",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="audio"\n720.m3u8\n'
    q = parse_manifest(master,CDN,'kick')[0]
    assert q['selectable'] is False and q['url'] is None


def test_public_source_is_not_a_kick_channel_and_parsing_does_not_log_urls(caplog):
    c = client(lambda r: httpx.Response(200,text=MASTER), provider='public-test')
    assert c.get('/api/streams/yoda',headers=AUTH).status_code == 400
    response = c.get('/api/streams/hls-test',headers=AUTH)
    assert response.json()['source'] == 'public-test' and response.json()['playback']['live'] is False
    assert 'FAKE_PRIVATE_TOKEN' not in caplog.text


@pytest.mark.parametrize('host', ['0.0.0.0', '::', '8.8.8.8', 'example.com'])
def test_bind_cannot_be_public(host):
    with pytest.raises(ValueError): Settings(token=TOKEN,host=host)


def test_no_credentials_redirects_or_drm_in_stream_urls():
    with pytest.raises(DiscoveryError): parse_manifest('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="https://secret.test/key"\n#EXTINF:5,\nx.ts\n',CDN,'kick')
    response = client(lambda r: httpx.Response(200,text='not a playlist'), provider='public-test').get('/api/streams/hls-test',headers=AUTH)
    assert response.status_code == 502 and response.json()['error']['code'] == 'invalid_playlist'
