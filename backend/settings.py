from dataclasses import dataclass
import ipaddress
import os
import re


def local_address(value):
    try:
        address = ipaddress.ip_address(value)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        networks = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7')
        return address.is_loopback or any(address in ipaddress.ip_network(n) for n in networks)
    except ValueError:
        return False


@dataclass(frozen=True)
class Settings:
    token: str
    provider: str = 'public-test'
    timeout: float = 10
    origins: tuple = ('null',)
    host: str = '127.0.0.1'
    port: int = 8766

    def __post_init__(self):
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', self.token):
            raise ValueError('Configure KICKTV_API_TOKEN com 32 a 128 caracteres aleatórios alfanuméricos, _ ou -.')
        if self.provider not in ('public-test', 'kick') or not 0 < self.timeout <= 30:
            raise ValueError('Provider ou timeout inválido.')
        if not local_address(self.host) or not 1024 <= self.port <= 65535:
            raise ValueError('Use bind em loopback ou um endereço LAN específico e porta não privilegiada.')
        if not self.origins or '*' in self.origins:
            raise ValueError('Declare origens CORS específicas; não use *.')

    @classmethod
    def from_env(cls):
        return cls(token=os.getenv('KICKTV_API_TOKEN', ''), provider=os.getenv('KICKTV_PROVIDER', 'public-test'),
                   timeout=float(os.getenv('KICKTV_TIMEOUT', '10')), host=os.getenv('KICKTV_HOST', '127.0.0.1'),
                   port=int(os.getenv('KICKTV_PORT', '8766')),
                   origins=tuple(o.strip() for o in os.getenv('KICKTV_ORIGINS', 'null').split(',') if o.strip()))
