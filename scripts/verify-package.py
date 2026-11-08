"""Confere o IPK sem extrair arquivos: conteúdo permitido, versão e bytes do app."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile


def verify(package, root):
    manifest = json.loads((root / 'app/appinfo.json').read_text())
    files = json.loads((root / 'packaging.json').read_text())['files']
    expected_name = f"{manifest['id']}_{manifest['version']}_all.ipk"
    if package.name != expected_name:
        raise ValueError(f'Nome inesperado do pacote: esperado {expected_name}')
    members = subprocess.check_output(['ar', 't', str(package)]).decode().splitlines()
    if sorted(members) != ['control.tar.gz', 'data.tar.gz', 'debian-binary']:
        raise ValueError('Membros inesperados no arquivo IPK.')
    if subprocess.check_output(['ar', 'p', str(package), 'debian-binary']) != b'2.0\n':
        raise ValueError('Formato Debian inesperado.')

    def archive(name):
        data = subprocess.check_output(['ar', 'p', str(package), name])
        return tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')

    prefix = f"usr/palm/applications/{manifest['id']}/"
    metadata = f"usr/palm/packages/{manifest['id']}/packageinfo.json"
    expected = {prefix + name for name in files} | {metadata}
    with archive('data.tar.gz') as data:
        actual = {}
        for member in data.getmembers():
            if member.isdir():
                continue
            name = member.name.removeprefix('./')
            if not member.isfile() or name not in expected or name in actual:
                raise ValueError(f'Conteúdo inesperado no IPK: {member.name}')
            actual[name] = data.extractfile(member).read()
        if set(actual) != expected:
            raise ValueError(f'Arquivos ausentes no IPK: {sorted(expected - set(actual))}')
        for name in files:
            if actual[prefix + name] != (root / 'app' / name).read_bytes():
                raise ValueError(f'Conteúdo diverge da origem: {name}')
        info = json.loads(actual[metadata])
        if any(info.get(key) != value for key, value in {
            'id': manifest['id'], 'app': manifest['id'], 'version': manifest['version']
        }.items()):
            raise ValueError('packageinfo.json diverge do manifesto.')
    with archive('control.tar.gz') as control:
        if any(not member.isdir() and (not member.isfile() or member.name.removeprefix('./') != 'control') for member in control.getmembers()):
            raise ValueError('Conteúdo extra no arquivo de controle do IPK.')
        entries = [member for member in control.getmembers() if member.name.removeprefix('./') == 'control']
        if len(entries) != 1 or not entries[0].isfile():
            raise ValueError('Metadados Debian ausentes ou inválidos.')
        fields = dict(line.split(': ', 1) for line in control.extractfile(entries[0]).read().decode().splitlines() if ': ' in line)
        if fields.get('Package') != manifest['id'] or fields.get('Version') != manifest['version'] or fields.get('Architecture') != 'all':
            raise ValueError('Identidade, versão ou arquitetura divergem no control do IPK.')
    print(f'IPK conferido: {len(files)} arquivos de execução; versão {manifest["version"]}.')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Uso: python3 scripts/verify-package.py arquivo.ipk')
        verify(Path(sys.argv[1]).resolve(), Path(__file__).resolve().parents[1])
    except (ValueError, OSError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f'Falha na validação do IPK: {error}', file=sys.stderr)
        sys.exit(1)
