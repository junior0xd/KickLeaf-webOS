"""Execução em primeiro plano; sem systemd, proxy ou alterações no servidor."""
import os
import uvicorn
from .app import create_app
from .settings import Settings


def main():
    settings = Settings.from_env()
    cert, key = os.getenv('KICKTV_TLS_CERT'), os.getenv('KICKTV_TLS_KEY')
    if bool(cert) != bool(key):
        raise ValueError('Configure certificado e chave TLS juntos.')
    if not cert and settings.host not in ('127.0.0.1', '::1'):
        raise ValueError('Para bind LAN, configure KICKTV_TLS_CERT e KICKTV_TLS_KEY; HTTP é apenas para loopback.')
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, access_log=False,
                proxy_headers=False, ssl_certfile=cert, ssl_keyfile=key)


if __name__ == '__main__':
    main()
