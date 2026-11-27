<div align="center">

# KickLeaf

<img src="app/kickleaf-icon-transparent.png" alt="Ícone do KickLeaf" width="130">

A lightweight, unofficial Kick client for webOS.<br>
Built for the big screen.

</div>

<p align="center">Português | <a href="README.en.md">English</a></p>

KickLeaf é um aplicativo independente para assistir a transmissões da Kick em TVs LG. A reprodução usa HLS nativo por padrão. Você pode assistir em tela cheia ou usar o modo teatro com chat público somente leitura. O alvo do projeto é a LG OLED C3 com webOS 25.

## Aviso importante

KickLeaf é um projeto independente, não oficial e de código aberto. Não possui afiliação, parceria, autorização formal ou endosso da Kick Streaming ou da LG Electronics.

O aplicativo utiliza mecanismos não oficiais para descobrir e reproduzir transmissões públicas da Kick e para acompanhar mensagens do chat em modo somente leitura. Essas integrações não são garantidas pela plataforma e podem deixar de funcionar caso seus serviços, protocolos ou mecanismos de acesso sejam modificados.

O objetivo do projeto é oferecer uma experiência de reprodução de transmissões da Kick diretamente em televisores LG com webOS, sem depender de espelhamento de tela ou servidores externos de retransmissão.

O desenvolvimento prioriza o uso responsável da infraestrutura da Kick, procurando minimizar requisições desnecessárias, evitar tráfego excessivo e não impor carga indevida aos serviços da plataforma.

Este projeto é disponibilizado para fins pessoais, educacionais e experimentais. Seu funcionamento não é garantido, e o usuário é responsável por observar os termos aplicáveis aos serviços acessados.

## Conectar, instalar e executar na LG C3

### Windows

1. Baixe e instale o [webOS Dev Manager para Windows](https://github.com/webosbrew/dev-manager-desktop/releases/latest).
2. Ative o **Developer Mode** e o **Key Server** na TV. No Dev Manager, adicione a TV usando o IP e a senha exibidos na tela. O PC e a TV precisam estar na mesma rede.
3. Obtenha o IPK do KickLeaf em [Releases](https://github.com/junior0xd/KickLeaf-webOS/releases), se disponível, ou gere-o seguindo os passos do Ubuntu abaixo. No Dev Manager, selecione a TV, instale o arquivo `.ipk` e abra o KickLeaf na TV.

### Ubuntu

Em um computador Ubuntu na mesma rede da TV, use Node.js 22, npm, Python 3 e `ar` (pacote `binutils`). Na raiz do projeto, instale as dependências e gere o IPK.

```bash
npm ci
npm ci --prefix service --omit=dev --ignore-scripts --no-audit --no-fund
npm run package
```

Na TV, ative o **Developer Mode** e ligue o **Key Server**. Substitua `IP_DA_TV` pelo IP da TV e informe a senha exibida na tela quando o comando `--getkey` pedir. Se o dispositivo `lgc3` já estiver cadastrado na CLI, use `--modify` no lugar de `--add`.

```bash
npx ares-config --profile tv
npx ares-setup-device --add lgc3 --info '{"host":"IP_DA_TV","port":"9922","username":"prisoner"}'
npx ares-novacom --device lgc3 --getkey

APP_ID=$(node -p "require('./app/appinfo.json').id")
APP_VERSION=$(node -p "require('./app/appinfo.json').version")
npx ares-install --device lgc3 "dist/releases/${APP_ID}_${APP_VERSION}_all.ipk"
npx ares-launch --device lgc3 "$APP_ID"
```

No app, digite o nome ou a URL do canal e selecione **Assistir**. Durante a reprodução, pressione **OK** para abrir os controles.

Se você já tem o KickTV Alpha instalado, o webOS instala o KickLeaf (`com.kickleaf.client`) como outro aplicativo. O KickLeaf começa com as configurações padrão.

Para experimentar a tela inicial OLED Premium, use o parâmetro de abertura `experimentalDiscovery: true`. Veja [como habilitar e reverter o experimento](docs/DESCOBERTA.md).

## Executar os testes

Depois de instalar as dependências acima, prepare o Chromium do Playwright e execute a suíte.

```bash
npx playwright install --with-deps chromium
npm test
```

A suíte roda testes unitários, de chat e de navegador. Para o roteiro na TV e os testes do backend opcional, consulte o [guia de testes](docs/TESTES.md).
