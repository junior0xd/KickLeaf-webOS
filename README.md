# KickTV para LG webOS — prova de conceito

**Versão 0.2.3:** barra compacta com ícones Phosphor locais de 37px, gradiente inferior e painel transitório com as ações existentes. Ícone de volume removido: o áudio é controlado pela TV. Aparência aprovada pelo usuário na LG C3. Veja [controles, navegação e validação](docs/PLAYER-CONTROLS.md).

**Versão 0.2.1: Direct HLS é o modo padrão.** Ao abrir o app normalmente, a TV consulta a Kick e reproduz o HLS no player nativo, sem backend, Caddy ou token. `iframe` e `native-hls` continuam disponíveis por parâmetros de abertura. Consulte [arquitetura, CORS e validação](docs/DIRECT-HLS.md) e a [documentação do backend opcional](docs/NATIVE-HLS.md).

**Validação física pelo usuário na LG C3:** `yetz` e `baianotv` reproduziram imagem e áudio no Direct HLS, a troca para 1080p funcionou e o backend permaneceu desligado durante todo o teste. O Native HLS com backend HTTPS também foi validado. Esses relatos não substituem os testes pendentes de estabilidade prolongada e interrupção de rede. A descoberta usa um endpoint interno, sem garantia oficial de estabilidade; não incorpora contorno de restrições.

Alvo informado: LG OLED55C3PSA, webOS 25, versão 10.3.1-3006. Investigação em 08/11/2026.

**Histórico 0.2.0 — iframe:** controles por OK/setas/Voltar, recarga manual e recuperação limitada de falhas observáveis do iframe. O menu de qualidade informa o limite da integração: seleção manual e detecção de buffering do vídeo remoto não estão disponíveis pela API documentada. A validação ampliada desses controles do iframe continua documentada separadamente. Veja [player: implementação, limites e roteiro de teste](docs/PLAYER.md).

**Resultado histórico da PoC por iframe:** após os testes locais, o usuário confirmou instalação, teclado, reprodução de canais online em tela cheia, indicação de offline e retorno à entrada na C3, sem erros de uso identificados. Foram utilizados `yoda`, `xqc` e `minerva`, além do canal inexistente `lgiptv`. O [relato completo](docs/TESTES.md) distingue os testes na TV das verificações locais.

**Chat, emotes e fila (v0.2.5):** chat público somente leitura no modo teatro, com fila FIFO/ACK de inserção no DOM, crédito e emotes nativos. O ACK do Centrifugo permanece independente. Badges CDN mantêm limites de 64/128 KiB e cache de 64 entradas. [Uso e limites](docs/CHAT.md), [integração e validação da versão](docs/RELEASE-v0.2.5.md) e [relatórios históricos sanitizados](experiments/reports/README.md).

**Play/Pause no HLS nativo:** botão da barra compacta com retomada do ponto pausado enquanto disponível, recuperação limitada e aviso quando expira. Veja [investigação, limites e testes manuais na TV](docs/PLAY-PAUSE.md). Não há garantia de DVR completo.

**Estatísticas do vídeo (desde 0.2.2):** painel opcional no player nativo, com métricas locais atualizadas a cada segundo enquanto visível. Veja [classificação das métricas, controles e roteiro na LG](docs/VIDEO-STATS.md). Incluído nas versões atuais; não integra o pacote histórico da Release 0.2.1.

## Arquivos e funcionamento

- `app/`: HTML, CSS, JavaScript puro, manifesto e ícones. Sem dependências de execução.
- `assets/kick-512.png`: ícone original enviado em 512×512; `app/icon.png` e `app/largeIcon.png` são versões em 80×80 e 130×130 para o webOS.
- `dist/releases/<id>_<versão>_all.ipk`: saída atual da CLI oficial, gerada localmente ou pelo CI. Os arquivos antigos já versionados na raiz de `dist/` são históricos e não são usados pelos workflows.
- [Investigação](docs/INVESTIGACAO.md): fontes, bloqueios e alternativas.
- [Testes e validação na TV](docs/TESTES.md): evidências, aceite na C3 e verificações complementares.

O fluxo padrão é: nome ou URL de canal → normalização → `https://kick.com/api/v2/channels/{canal}/livestream` → validação de `data.playback_url` → `<video>` nativo com HLS diretamente da CDN. A análise opcional do manifesto oferece apenas variantes seguras; se falhar, a reprodução tenta Auto com a playlist principal. Não há retransmissão de vídeo ou credenciais Kick no app.

O campo aceita, por exemplo, `xqc`, `https://kick.com/xqc` e `https://www.kick.com/xqc/`. OK abre os controles; setas navegam por Qualidade, Recarregar transmissão e Usar player oficial. Voltar fecha primeiro menus/painéis e depois retorna à entrada. A troca/recarga libera os recursos anteriores. Controles e indicadores desaparecem durante a reprodução normal; não são alteradas as proteções OLED.

A alternativa `iframe` usa o embed oficial `player.kick.com`; seus eventos internos, qualidades e buffering não são acessíveis ao documento pai. O modo `native-hls` usa o mesmo player nativo com descoberta pelo backend local autenticado. Para o comportamento detalhado de cada modalidade, veja [Direct HLS](docs/DIRECT-HLS.md), [Native HLS](docs/NATIVE-HLS.md) e [iframe](docs/PLAYER.md).

## Preparar e empacotar no Ubuntu

Instale Node.js, npm, Python 3 e `ar` (pacote Ubuntu `binutils`). O CI utiliza Node 22.22.3 e Ubuntu 24.04. A [página da LG](https://webostv.developer.lge.com/develop/tools/cli-installation) identifica `@webos-tools/cli` como CLI oficial; a versão 3.2.6 está fixada no projeto e é instalada localmente por `npm ci`.

Na pasta `kicktv`:

```bash
npm ci
npm ci --prefix service --omit=dev --ignore-scripts
npm run validate
npm run package
npm run package:info
```

Não há compilação ou bundler: a aplicação é HTML/CSS/JavaScript puro. `npm run package` valida o projeto, seleciona o perfil `tv` na CLI oficial, copia somente os arquivos de execução listados em `packaging.json` para `.build/webos-app/` e gera o `.ipk` em `dist/releases/`, sem minificação. O diagnóstico HLS existente é mantido, preservando o comportamento do app.

Arquivos fora dessa lista são excluídos, inclusive se estiverem dentro de `app/`. Dependências, testes, documentação, configurações locais, credenciais, arquivos temporários e o PNG original de desenvolvimento não são copiados. A auditoria final abre o IPK sem extrair seus arquivos e compara conteúdo, versão e metadados com a origem; conteúdo extra, ausente, alterado ou links causam falha. Ao adicionar um arquivo de execução no futuro, atualize também `packaging.json`. `requiredACG: []` declara que não usamos Luna APIs.

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
npx ares-install --device lgc3 dist/releases/com.kicktv.poc_0.2.1_all.ipk
npx ares-launch --device lgc3 com.kicktv.poc
```

A abertura sem parâmetros usa Direct HLS. Para usar o player oficial, feche e reabra explicitamente:

```bash
npx ares-launch --device lgc3 --close com.kicktv.poc
npx ares-launch --device lgc3 --params '{"mode":"iframe"}' com.kicktv.poc
```

`{"mode":"direct-hls"}` continua válido. Para `native-hls`, use os parâmetros de backend descritos em [Native HLS](docs/NATIVE-HLS.md).

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
- No embed, `error` observável do iframe permite até três recargas com backoff de 2/4/8 segundos. Navegadores frequentemente não emitem esse evento para erros HTTP. Um aviso temporário aparece se `load` não chegar em 25 segundos; isso não detecta vídeo travado nem aciona recarga automática.
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


## GitHub Actions e publicação de versões

Os workflows usam ações oficiais do GitHub fixadas por SHA e ferramentas de desenvolvimento fixadas pelo `package-lock.json`.

O [relatório de preparação do CI](docs/CI.md) descreve a estrutura analisada, as validações locais e os limites dessa validação.

| Workflow | Disparo | Resultado |
| --- | --- | --- |
| `.github/workflows/validate.yml` — Validate webOS app | Push em qualquer branch e pull requests | Valida metadados, executa testes unitários e de navegador, empacota e audita o IPK; guarda o artefato por 7 dias, sem publicar Release |
| `.github/workflows/release.yml` — Release webOS IPK | Push de tags `v*` | Exige tag igual à versão do manifesto, repete os testes e o empacotamento, guarda o artefato por 14 dias e publica o IPK em uma Release com notas automáticas |

O job de build tem somente `contents: read`. Apenas o job separado de publicação recebe `contents: write`; ele baixa o pacote validado da mesma execução e usa o `GITHUB_TOKEN` automático como `GH_TOKEN`, sem instalar dependências ou executar scripts do projeto. Não é necessário criar PAT, credenciais Kick, chave SSH da TV ou secret adicional. A [documentação do GitHub explica essas permissões](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).

### Criar uma versão

Exemplo para uma futura `v0.2.2` (os comandos abaixo publicam quando executados; não são executados pela preparação do CI):

A versão atual é 0.2.5. Se a versão seguinte desejada já estiver sincronizada nos três arquivos, pule os passos 1 e 2. A atualização do número não cria uma tag nem uma Release.

1. Altere `version` em `app/appinfo.json` para `0.2.2`. Use três inteiros, sem zeros à esquerda ou sufixos (`-beta`, `+build`), com até nove dígitos por componente, conforme o formato webOS.
2. Atualize os metadados npm, sem criar tag automaticamente:

   ```bash
   npm version 0.2.2 --no-git-tag-version
   ```

3. Valide e teste localmente:

   ```bash
   npm ci
npm ci --prefix service --omit=dev --ignore-scripts
   npm run validate -- --tag v0.2.2
   npx --no-install playwright install chromium
   npm test
   npm run package
   npm run package:info
   ```

4. Faça commit das mudanças, revise e integre na branch desejada. Garanta que os workflows e scripts de empacotamento também estejam nesse commit. Com o envio autorizado, publique o commit e depois a tag correspondente:

   ```bash
   git push origin main
   git tag -a v0.2.2 -m 'KickTV v0.2.2'
   git push origin v0.2.2
   ```

A tag deve apontar para o commit com `appinfo.json`, `package.json` e as duas entradas de versão do `package-lock.json` sincronizados. Não há alteração automática da versão pelo workflow. Tags como `v1`, `v0.2.2-beta` ou uma tag divergente disparam o filtro `v*`, mas falham na validação antes de publicar. O fluxo atual publica somente versões estáveis no formato `vX.Y.Z`.

### Acompanhar e baixar

No repositório, abra **Actions → Validate webOS app** para commits/PRs ou **Actions → Release webOS IPK** para tags. Confira os logs dos passos de metadados, testes, empacotamento e publicação. Um pacote só é publicado se todos os passos do build passarem. Na validação, o IPK fica em **Artifacts → kicktv-ipk-validation**; na execução de tag, em **Artifacts → kicktv-ipk** e, após a publicação, em **Releases → vX.Y.Z → Assets**. As notas são geradas pela API do GitHub usando [`gh release create --generate-notes`](https://cli.github.com/manual/gh_release_create).

No Ubuntu runner, `gh` já está disponível. O comando usa `--verify-tag`, portanto não cria tags implicitamente. Para acompanhar pelo seu computador, se tiver GitHub CLI autenticada, use `gh run list`, `gh run watch <ID>` e `gh run view <ID> --log-failed`.

Se o build falhar, nenhuma Release é criada. Se a publicação falhar, examine os logs e os artefatos antes de usar **Re-run failed jobs**. Releases existentes não são sobrescritas: uma repetição após publicação bem-sucedida falha ao tentar recriar a mesma Release. Se um envio parcial de assets tiver deixado um rascunho, revise-o no GitHub antes de decidir como recuperar. Para uma nova versão pública, prefira uma nova versão/tag.

A integração precisa de Actions habilitado no repositório e políticas que permitam as ações oficiais utilizadas e `contents: write` no job de publicação. Os testes de CI não substituem a validação de reprodução na televisão.
