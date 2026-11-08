# Etapa E — testes e limites da validação

Este documento registra o aceite da PoC 0.1.0. A evolução do player 0.2.0 tem validação local própria e [roteiro de TV ainda pendente](PLAYER.md); o aceite anterior não confirma os controles ou a recuperação adicionados depois.

**Resultado: prova de conceito bem-sucedida na LG OLED C3, conforme validação realizada e relatada pelo usuário.** A instalação, o teclado, a reprodução de canais online em tela cheia, a indicação de offline e o retorno à entrada funcionaram. Não foram identificados erros durante o uso relatado.

Os testes locais foram executados em 08/11/2026, Ubuntu Linux, Node 22.22.3, CLI oficial `@webos-tools/cli` 3.2.6 e Playwright 1.65.0. Nessa execução, o agente não conectou uma TV. A validação no dispositivo foi feita posteriormente pelo usuário; não foi uma execução remota pelo agente. O ambiente de destino informado é LG OLED55C3PSA, webOS 25, versão 10.3.1-3006; o agente não inspecionou o firmware.

## Validação na TV relatada pelo usuário

| Verificação | Resultado relatado |
| --- | --- |
| Instalação na LG OLED C3 | Bem-sucedida |
| Teclado para digitar o canal | Funcionando |
| Canais utilizados | `yoda`, `xqc` e `minerva`; não foi especificado o estado individual de cada canal |
| Canal online | O player abre e reproduz a transmissão |
| Canal offline | O banner do canal e a informação de transmissão offline aparecem |
| Canal inexistente `lgiptv` | O player apresenta a mensagem "This embed seems to be misconfigured" |
| Tela cheia | Vídeo reproduzido em tela cheia como previsto |
| Botão de retorno | Retorna à tela de entrada como previsto |
| Erros durante o uso | Nenhum identificado; a mensagem esperada para o canal inexistente foi registrada acima |
| Entrada por URL completa | Não testada; considerada desnecessária pelo usuário para o aceite da PoC |

O usuário declarou a prova de conceito bem-sucedida e solicitou somente a atualização da documentação, sem modificações na aplicação. A data e a duração da sessão de teste na TV não foram informadas. O diagnóstico HLS Apple, a perda de conectividade, a saída pelo Home e a verificação isolada de áudio não foram relatados; não são registrados como testes executados.

Online/offline e a mensagem de canal inexistente são apresentados pelo embed oficial. A validação confirma esse comportamento na TV testada; não significa que o app passou a consultar a API ou a inspecionar o estado interno do iframe.

## Resultados locais

| Verificação | Resultado | O que comprova |
| --- | --- | --- |
| Consulta API oficial sem token, `slug=xqc` | HTTP 401 Unauthorized | API exige autenticação; não indica se o canal está offline |
| Inspeção OpenAPI oficial | `is_live` disponível; sem `playback_url` no esquema consultado | Há status autenticado, mas não foi encontrado contrato público HLS |
| Amostra Apple HLS | Manifesto acessível; H.264 640×360 e áudio AAC identificados por FFprobe | Disponibilidade e formato da amostra |
| Decodificação FFmpeg | Um quadro de vídeo e um segundo de áudio decodificados, saída 0 | A mídia de teste é decodificável em Linux; não prova reprodução LG nem som audível |
| Testes de normalização e URL | 3 testes passaram | Nome/URL válidos e rejeição de origens/caminhos indevidos |
| Testes de interface em Chromium | 8 testes passaram | Navegação, formulário, dimensão 1920×1080, Voltar e tratamento de falhas observáveis |
| Teste real do embed `xqc` | Texto compatível com offline; nenhum `<video>` observado | Resultado pontual do player oficial no desktop |
| Teste real do embed `roshtein` | Texto compatível com offline; nenhum `<video>` observado | Resultado pontual; não é consulta autenticada de status |
| Teste real do embed `sxb` | Vídeo presente, `paused=false`, `readyState=4`, sem erro de mídia, tempo de reprodução positivo | Reprodução real da Kick observada em Chromium Linux a partir de página local |
| Empacotamento | `.ipk` gerado; manifesto e arquivo `data.tar.gz` inspecionados | Estrutura produzida pela CLI oficial, sem dependências de desenvolvimento no pacote |
| Instalação/reprodução na C3 pelo agente | Não executadas nessa sessão local | A validação posterior pelo usuário está registrada acima |

A amostra HLS foi verificada antes da integração do embed. A captura inicial foi revisada visualmente. O formulário tem fundo preto, campo e botão centralizados. [Captura](evidence/tela-inicial.png).

Na segunda observação de `sxb`, o tempo de mídia avançou de **16,304662 para 19,308093 segundos** em aproximadamente três segundos. O foco permaneceu no documento pai e um evento sintético de tecla 461 retornou ao formulário, removendo o iframe. A captura da live foi inspecionada visualmente. Não houve verificação de som audível nem teste de controle físico. [Dados da observação](evidence/embed-browser-sxb.json).

Os oito testes de navegador usam um documento simulado no iframe, salvo os diagnósticos de rede explicitamente separados. Eles cobrem o código do app; não simulam a pilha multimídia LG. O erro do iframe é disparado sinteticamente para testar recuperação, pois navegadores não garantem esse evento para uma falha HTTP. O teste de HLS com rede interrompida verifica mensagem e liberação de mídia; não valida playback positivo no navegador.

A inspeção do iframe no script de diagnóstico usa capacidades de automação do navegador. O JavaScript da aplicação continua sujeito à política de mesma origem. Nenhuma leitura do DOM remoto foi incorporada ao funcionamento do app.

Evidências: [API](evidence/kick-api-summary.json), [H.264](evidence/apple-ffprobe.json), [AAC](evidence/apple-audio-ffprobe.json), [embed xqc](evidence/embed-browser.json), [embed roshtein](evidence/embed-browser-roshtein.json), [embed sxb](evidence/embed-browser-sxb.json), [captura da live no desktop](evidence/embed-sxb.png). Não há URLs HLS assinadas nem cookies nesses arquivos.

## Situação dos critérios de sucesso

| Critério | Estado |
| --- | --- |
| Instalável na OLED C3 | Confirmado pelo usuário na TV |
| Campo de canal | Digitação pelo teclado confirmada pelo usuário na TV |
| Identificar online/offline | Exibição do estado pelo embed confirmada na TV; não há consulta própria à API |
| Reproduzir live Kick | Reprodução de canal online confirmada pelo usuário na C3 |
| Vídeo em tela cheia | Confirmado pelo usuário na TV |
| Voltar retorna à entrada | Confirmado pelo usuário na TV |
| Erros sem travamento | Nenhum erro de uso identificado; canal inexistente apresenta mensagem do embed; falhas internas cross-origin continuam sem observação própria pelo app |

**Aceite da PoC concluído pelo usuário no hardware de destino, com a reprodução via embed oficial.** O resultado não valida obtenção direta de HLS da Kick nem altera as limitações de observação do iframe. Não foram necessárias alterações na aplicação após esse relato.

## Roteiro de referência para repetição e verificações complementares

O aceite acima já foi concluído. O roteiro abaixo permanece como referência para repetir a validação ou investigar problemas futuros; não representa uma lista de testes integralmente executados. A entrada por URL completa é opcional e foi dispensada pelo usuário no aceite.

1. Instalar o `.ipk` seguindo o README. Registrar modelo, versão webOS, firmware e resultado da instalação.
2. Abrir com `mode=hls-test`, confirmar com OK e verificar imagem **e som**. Deixar tocar por alguns minutos. Voltar deve parar a mídia e permitir repetir. Registrar erros do Console e Network se houver.
3. Fechar e abrir normalmente. Digitar um canal, conferir teclado virtual e navegação com setas e OK. Opcionalmente, verificar uma URL completa.
4. Usar um canal confirmado ao vivo no momento do teste. `xqc` é apenas exemplo e pode estar offline; `sxb` estava reproduzindo durante a observação de desenvolvimento, sem garantia futura.
5. Confirmar imagem, áudio, autoplay, ocupação da tela e estabilidade por pelo menos dez minutos. Não considerar `iframe_load` como sucesso.
6. Pressionar Voltar no controle físico. Confirmar que a tela inicial retorna e o áudio cessa. Abrir outro canal e repetir.
7. Testar um canal offline e um inexistente. Registrar exatamente a mensagem do player oficial; o app não consegue traduzi-la ou confirmar seu significado por API.
8. Testar perda de conectividade, retorno à tela inicial e nova tentativa. Se o embed exigir interação ou ficar em branco, registrar a falha e interromper a validação desse caminho.
9. Abrir Home da LG durante playback e voltar ao app. A mídia deve ter sido removida, sem áudio residual. Na entrada, dois toques em Voltar devem encerrar o app.

Se falhar apenas no webOS, comparar o diagnóstico HLS nativo com o embed: HLS funcionando isola parte da pilha de mídia; não resolve políticas, cookies ou dependências do player remoto. Não trocar para endpoints privados ou alterar cabeçalhos para evitar restrições.

## Comandos de mídia reproduzíveis

```bash
ffprobe -v error -rw_timeout 15000000 \
  -show_entries stream=codec_name,codec_type,width,height -of json \
  https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/v3/prog_index.m3u8

ffmpeg -v error -rw_timeout 15000000 \
  -i https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/v3/prog_index.m3u8 \
  -frames:v 1 -f null -
```

Os comandos não desabilitam verificação TLS, não modificam cabeçalhos e não acessam mídia da Kick fora do embed.
