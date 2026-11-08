import asyncio
import secrets

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .discovery import Discovery, DiscoveryError, CHANNEL
from .settings import Settings, local_address


def create_app(settings: Settings, discovery=None):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    resolver = discovery or Discovery(settings)
    limit = asyncio.Semaphore(2)

    def error(code, status):
        return JSONResponse({'error': {'code': code}, 'online': None}, status_code=status)

    @app.middleware('http')
    async def guard(request: Request, call_next):
        if not request.client or not local_address(request.client.host):
            result = error('local_network_only', 403)
        elif request.method == 'OPTIONS':
            result = await call_next(request)  # Preflight não contém Authorization.
        elif not secrets.compare_digest(request.headers.get('authorization', '').encode(), f'Bearer {settings.token}'.encode()):
            result = error('unauthorized', 401)
        else:
            result = await call_next(request)
        result.headers['Cache-Control'] = 'no-store'
        result.headers['X-Content-Type-Options'] = 'nosniff'
        return result

    @app.get('/api/streams/{channel}')
    async def stream(channel: str):
        if not CHANNEL.fullmatch(channel):
            return error('invalid_channel', 400)
        acquired = False
        try:
            await asyncio.wait_for(limit.acquire(), timeout=0.1)
            acquired = True
            async with asyncio.timeout(settings.timeout):
                return await resolver.resolve(channel)
        except (TimeoutError, httpx.TimeoutException):
            return error('discovery_timeout', 504 if acquired else 503)
        except DiscoveryError as exc:
            return error(exc.code, exc.status)
        except Exception:
            # Sem traceback, corpo upstream, URL, token ou repr de exceção.
            return error('discovery_failed', 502)
        finally:
            if acquired:
                limit.release()

    # Envolve também erros de autenticação, permitindo que a TV leia os códigos.
    return CORSMiddleware(app, allow_origins=list(settings.origins), allow_methods=['GET'],
                          allow_headers=['Authorization'], allow_credentials=False)
