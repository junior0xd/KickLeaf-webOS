# KickTV para LG webOS — prova de conceito

**Estado: pacote experimental gerado; reprodução real da Kick na LG C3 ainda não validada.** Não há, nas fontes oficiais consultadas, um método documentado para obter HLS de visualização. A alternativa implementada é o **embed oficial dentro do aplicativo instalado**, sem abrir navegador externo. A PoC não atende ainda a todos os critérios: não consulta status pela API nem detecta falhas internas do embed.

Alvo informado: LG OLED55C3PSA, webOS 25, versão 10.3.1-3006. Investigação em 08/11/2026.

**Resultado prático:** uma live real de `sxb` iniciou no embed, em Chromium Linux com o app aberto de arquivo local. O tempo avançou de 16,30 para 19,31 segundos, sem erro de mídia, e Voltar sintético removeu o player. Isso demonstra a alternativa no desktop; imagem, som e controle físico na TV ainda precisam de validação.

## Arquivos e funcionamento

- `app/`: HTML, CSS, JavaScript puro, manifesto e ícones. Sem dependências de execução.
- `dist/com.kicktv.poc_0.1.0_all.ipk`: pacote gerado pela CLI oficial.
- [Investigação](docs/INVESTIGACAO.md): fontes, bloqueios e alternativas.
- [Testes e validação na TV](docs/TESTES.md): evidências e roteiro pendente.

O fluxo é: nome ou URL do canal → validação local → `https://player.kick.com/<canal>?autoplay=true&muted=false` em iframe de 100% da tela. **O app não obtém uma URL `.m3u8` da Kick.** O player remoto resolve e reproduz a transmissão sob controle da plataforma. Não há chamadas a endpoints privados, extração de tokens, cookies próprios ou segredos no pacote.

O campo aceita, por exemplo, `xqc`, `https://kick.com/xqc` e `https://www.kick.com/xqc/`. Setas cima/baixo alternam entre campo e botão quando o teclado virtual está fechado; esquerda/direita editam o texto; OK usa a ação nativa. O teclado virtual recebe as setas enquanto estiver aberto. Voltar durante a reprodução remove o iframe e retorna ao formulário. Na tela inicial, dois toques em Voltar encerram o app.

O iframe não recebe foco nem cliques, para que o documento pai mantenha Voltar. Isso exige que o autoplay com áudio funcione. Se o player exigir clique, login, consentimento ou verificação, esta PoC não atende esse caso. Não há API documentada do embed para encaminhar OK, remover seus controles ou receber eventos de mídia. A apresentação e as mensagens internas são da Kick.

## Preparar e empacotar no Ubuntu

Instale Node.js e npm. As dependências fixadas exigem Node >=20. A [página da LG](https://webostv.developer.lge.com/develop/tools/cli-installation) identifica `@webos-tools/cli` como CLI oficial; a versão utilizada foi 3.2.6, com Node 22.22.3. Tudo foi instalado localmente neste projeto.

Na pasta `kicktv`:

```bash
npm ci
npm run package
npm run package:info
```

O pacote contém somente `app/`; não inclui Node, ferramentas, testes ou documentação. É gerado sem minificação para facilitar a depuração. `requiredACG: []` declara que não usamos Luna APIs; não é necessário solicitar permissões adicionais.

Neste servidor, Node está fora do PATH e a pasta pessoal é somente leitura. Os comandos equivalentes usados foram:

```bash
PATH=/opt/node/v22.22.3/bin:$PATH npm --cache /tmp/kicktv-npm-cache ci
PATH=/opt/node/v22.22.3/bin:$PATH APPDATA="$PWD/.tools" npm --cache /tmp/kicktv-npm-cache run package
```

`APPDATA` é uma opção reconhecida pela própria CLI para seus arquivos de configuração. Não foi necessário alterar serviços do servidor.

## Conectar, instalar e executar na LG C3

Execute estes comandos em um Ubuntu que alcance a TV pela rede local. Mantenha o Developer Mode ativo e ligue **Key Server** no aplicativo Developer Mode. Troque `192.168.1.100` pelo IP real da TV.

```bash
npx ares-config --profile tv
npx ares-setup-device --add lgc3 --info '{"host":"192.168.1.100","port":"9922","username":"prisoner"}'
npx ares-novacom --device lgc3 --getkey
```

Digite a passphrase exibida na TV quando solicitada pela CLI. Não a grave no código. Se `lgc3` já existir, use `--modify` em vez de `--add`. Em seguida:

```bash
npx ares-install --device lgc3 dist/com.kicktv.poc_0.1.0_all.ipk
npx ares-launch --device lgc3 com.kicktv.poc
```

A [LG documenta esse pareamento e a sessão do Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app). Quando o modo expira e é desabilitado, aplicativos de desenvolvimento podem ser removidos pela TV.

## Validar HLS nativo antes da Kick

O diagnóstico usa `<video>` diretamente, sem biblioteca, com a amostra pública Apple Bip Bop. Ele não aparece como funcionalidade na tela principal. Feche o aplicativo antes de alterar o modo de abertura:

```bash
npx ares-launch --device lgc3 --close com.kicktv.poc
npx ares-launch --device lgc3 --params '{"mode":"hls-test"}' com.kicktv.poc
```

Selecione **Iniciar teste HLS** com OK. Verifique imagem e som. Voltar interrompe e libera o vídeo; outro Voltar retorna à tela inicial. Para voltar ao lançamento normal:

```bash
npx ares-launch --device lgc3 --close com.kicktv.poc
npx ares-launch --device lgc3 com.kicktv.poc
```

A fonte de teste é `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8`, disponibilizada nos [exemplos HLS da Apple](https://developer.apple.com/streaming/examples/). Essa amostra testa mídia HLS; não comprova uma live Kick nem seu comportamento de longa duração.

## Logs e depuração na TV

Com o app aberto:

```bash
npx ares-inspect --device lgc3 --app com.kicktv.poc
```

Abra no Chrome o endereço que a CLI fornecer. A opção `--open` também pode abrir o navegador automaticamente no seu Ubuntu. No Web Inspector, acompanhe **Console** e **Network**. Os logs locais usam os prefixos `[KickTV]` e `[KickTV HLS]`. Não registramos URL de mídia, cookies ou tokens. Evite compartilhar um HAR bruto do player remoto, pois ele pode conter credenciais temporárias.

`embed_requested` significa apenas que o iframe foi solicitado. `iframe_load` significa apenas que a navegação do frame terminou: pode ser uma página de erro ou de canal offline. Apenas o diagnóstico nativo registra `playing`. A [LG descreve o Web Inspector e os comandos](https://webostv.developer.lge.com/develop/tools/cli-dev-guide).

## Erros e limites

- Entrada inválida gera mensagem em português e mantém o formulário utilizável.
- O player HLS de diagnóstico trata falhas de rede, decodificação, formato, rejeição de `play()` e 30 segundos sem avanço.
- No embed, `error` do iframe é tratado quando emitido, mas navegadores frequentemente não o emitem para erros HTTP. Um aviso aparece se `load` não chegar em 25 segundos; isso não detecta vídeo travado.
- Offline, canal inexistente e erros internos ficam com o player Kick. O app não inventa um status a partir de `load`, timeout ou mensagens cross-origin não documentadas.
- Se CORS, `frame-ancestors`, cookies, autoplay ou proteção de acesso impedirem a execução, a próxima ação é registrar o erro e consultar a Kick. Não há fallback com proxy, falsificação de origem/referer ou contorno de controles.

## Testes locais

```bash
npx playwright install chromium
npm test
```

No servidor desta entrega, acrescente `PATH=/opt/node/v22.22.3/bin:$PATH` e `PLAYWRIGHT_BROWSERS_PATH=/tmp/kicktv-browsers` aos comandos, e `--cache /tmp/kicktv-npm-cache` ao npm. Os testes de interface simulam o documento remoto: **não são testes de reprodução Kick**.

Para repetir uma observação de rede real do embed, opcionalmente:

```bash
node scripts/probe-embed.cjs xqc
```

O script abre o player oficial normalmente, observa o resultado em Chromium desktop e salva metadados sem URLs de mídia. A observação por automação de um frame remoto não é uma capacidade do app instalado.
