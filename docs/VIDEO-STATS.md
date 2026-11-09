# Estatísticas do vídeo

Implementação na branch `feat/video-statistics`, sobre `main` no commit `2bab0fc` (0.2.1). Painel opt-in no canto superior direito, nos modos Direct HLS e Native HLS. Sem bibliotecas, novas requisições, telemetria, mudanças no buffer ou mecanismo de reconexão. O iframe permanece preservado; suas métricas internas não estão disponíveis ao documento pai.

## Arquitetura encontrada

`app/native-hls.js` cria um `<video>` com HLS nativo. Não há hls.js, MSE ou downloader próprio. `direct-api.js` descobre o stream na Kick; `native-api.js` consulta o backend opcional. `hls-manifest.js` identifica variantes e declarações de bitrate, FPS e codecs. O modo Auto mantém a playlist principal; variantes com áudio externo não são selecionáveis individualmente.

A revisão disponível não contém módulo explícito de execução de desafio JavaScript. Os arquivos de descoberta, parsing, autenticação e rede ficaram inalterados; esta entrega não introduz nem remove tratamento de desafios. A indicação de versão/dispositivo do contexto não substitui inspeção do código disponível.

A [LG documenta Chromium 120 para webOS 25](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), mas o pipeline de mídia da TV pode expor apenas parte das APIs. As leituras abaixo verificam disponibilidade e validade dos valores. A [especificação Media Playback Quality](https://w3c.github.io/media-playback-quality/) define os contadores de quadros; os [eventos e TimeRanges HTML](https://html.spec.whatwg.org/multipage/media.html) definem as observações usadas para estados e buffer.

`video-stats.js` é o coletor, sem DOM visual, timers ou rede. Recebe o vídeo e apenas os metadados necessários da variante selecionada; nunca guarda URLs. Eventos acompanham o estado e contabilizam buffering mesmo enquanto o painel está desligado. `snapshot()` lê métricas sob demanda e substitui a implementação anterior de `KickNativeDiagnostics.snapshot()`, preservando seus campos existentes e acrescentando os novos.

`video-stats-panel.js` só formata/apresenta snapshots. Liga um único intervalo de 1 segundo enquanto visível e só altera textos que mudaram. Desligar o painel cancela o intervalo e invalida a amostra FPS; não encerra o vídeo. Listeners leves de estado permanecem enquanto o vídeo existir, para contabilizar corretamente interrupções da instância inteira. Não há polling oculto.

## Métricas e interpretação

| Métrica | Classificação | Fonte / limite |
| --- | --- | --- |
| Resolução efetiva | Medida, informada pelo navegador | `videoWidth` × `videoHeight`; não é a resolução da TV nem a declaração do manifesto; dimensões zero/ausentes viram N/D. |
| FPS apresentados | Estimativa de medição | Delta de `totalVideoFrames - droppedVideoFrames` dividido pelo tempo monotônico entre amostras de pelo menos 1 s. É uma média observada, não FPS nominal ou medida independente do painel da TV. |
| FPS declarados | Declarada | `FRAME-RATE` da variante manual. Auto: N/D, porque a variante efetiva é desconhecida. |
| Bitrate declarado | Declarada | `BANDWIDTH` da variante manual, em Mbps decimais; banda nominal agregada HLS, não throughput ou bitrate medido. Auto: N/D. |
| Buffer à frente | Medida, informada pelo navegador | Final do intervalo contíguo em `buffered` que contém `currentTime`, menos a posição atual. Não soma intervalos após lacunas e não representa latência. |
| Frames perdidos / totais | Medida, informada pelo navegador | `getVideoPlaybackQuality()`. Total inclui apresentados e descartados; não é exclusivamente número de quadros decodificados. API ausente, exceção ou valores inconsistentes: N/D. |
| Codecs de vídeo e áudio | Declarados | Identificadores `CODECS` da variante manual, separados por famílias conhecidas. Não comprova o decoder ativo; valores desconhecidos e Auto: N/D. |
| Qualidade selecionada | Estado do aplicativo | Rótulo da variante manual ou `Auto (variante N/D)`; não deduz variante pela resolução. |
| Distância da borda acessível | Medida relativa | Fim de `seekable` menos `currentTime`, somente para streams live e borda válida. É a borda exposta pelo player, não atraso câmera-tela. |
| Latência real | Indisponível | N/D: não há referência temporal confiável vinculando o vídeo à origem ao vivo. Não se usa buffer ou borda como substituto. |
| Interrupções e tempo | Medida por eventos / relógio monotônico | Episódios `waiting` após a primeira reprodução; eventos repetidos no mesmo episódio contam uma vez. Termina em `playing`, pausa, busca, erro ou fim. |
| Estado | Observado | Descobrindo, carregando, reproduzindo, buffering, pausado, buscando posição, erro ou encerrado. A interface de erro/retorno existente encerra o painel. |
| Throughput e codec efetivo | Indisponíveis | Nenhum acesso ao downloader nativo/decoder que permita medi-los com segurança nesta arquitetura. |

Buffering não inclui carregamento inicial, pausa intencional ou espera durante busca. `stalled` não conta sozinho: ausência de novos downloads pode coexistir com reprodução pelo buffer. Um evento `waiting` é um indício do player, não uma medição externa de cada interrupção perceptível.

Contadores e tempo de buffering valem para **a instância atual do vídeo**. Trocar qualidade ou recarregar cria outra instância e zera essa contagem, FPS e contadores de quadros. Não há histórico acumulado entre canais. Valores inválidos, infinitos ou negativos não são substituídos por exemplos. APIs que retornem contadores zero válidos serão exibidas como zero; FPS permanece N/D enquanto o contador total for zero. É necessário verificar a utilidade desses contadores no hardware.

## Controle remoto e ciclo de vida

1. Abrir uma transmissão. O painel inicia desativado.
2. OK abre os controles. Setas selecionam **Estatísticas do vídeo**; OK ativa/desativa. O botão indica o estado por `aria-pressed`.
3. O painel permanece visível após os controles sumirem e não recebe foco, cliques ou eventos do controle. Voltar mantém a prioridade existente: menu, painel de controles, entrada. Estatísticas não criam uma nova etapa de Voltar.
4. Trocar qualidade preserva a visibilidade do painel e limpa as métricas anteriores. Voltar à entrada, trocar canal, recarregar, usar iframe, erro, fim ou saída do aplicativo desativa o painel e libera intervalo/listeners da instância anterior.
5. É possível ativar durante uma descoberta pendente pelos mesmos controles. Nesse estado, dimensões e metadados aparecem como N/D e o estado informa descoberta, sem reaproveitar valores antigos.

Não há preferência persistida entre sessões. Fundo escuro semitransparente, cores moderadas e ausência de animação; o vídeo não muda de tamanho. O painel permanece estático apenas por ativação explícita do usuário e pode ser desligado a qualquer momento. Proteções OLED não são alteradas.

## Arquivos desta entrega

- Criados: `app/video-stats.js` (coletor), `app/video-stats-panel.js` (apresentação), `tests/video-stats.test.js`, `tests/browser/video-stats.spec.js`, `scripts/probe-video-statistics.cjs`, este documento e os registros `docs/evidence/video-statistics-validation.json` e `docs/evidence/video-statistics-public-hls.json`.
- Modificados: `app/native-hls.js` (integração/ciclo de vida), `app/native-hls.html` (painel e botão), `app/style.css` (layout), `packaging.json` (allowlist), `README.md` e `docs/PLAYER.md` (referências).
- Sem alterações: resolução/descoberta de canais, parser HLS, backend, iframe, dependências e workflows de publicação.

## Verificações locais

```bash
npm run validate
npm test
npm run package
```

Testes unitários usam um vídeo simulado e relógio monotônico controlado: valores e classificações, contagem de buffering, pausa/busca, reset de contadores, APIs ausentes/exceções e remoção de listeners. Playwright simula mídia e HTTP: controle remoto, atualização, painel independente dos controles, nenhuma requisição extra, polling desligado, limpeza, estados, qualidade/canal/recarga e layout 1920×1080. Toda a suíte anterior continua sendo executada. Testes simulados não demonstram decodificação, desempenho ou disponibilidade de métricas na LG.

Resultado local: **23 testes unitários JavaScript e 63 testes de navegador passaram**, incluindo todos os testes anteriores. O pacote foi gerado e auditado com dezessete arquivos de execução.

Um smoke test adicional usou **mídia HLS real da amostra pública Apple no Chromium Linux**, sem sobrescrever métodos ou eventos do vídeo. Apenas a resposta da API local de descoberta foi simulada; mídia veio diretamente da CDN. O painel exibiu resolução, FPS estimado, buffer e contadores, o vídeo avançou com o painel ativo, continuou após desativá-lo e foi liberado ao retornar. [Observações reais desse teste](evidence/video-statistics-public-hls.json) não comprovam comportamento na TV nem acesso à Kick. Para repetir, com navegador Playwright instalado e acesso à CDN Apple:

```bash
node scripts/probe-video-statistics.cjs
```

O comando grava um JSON sanitizado em `docs/evidence/video-statistics-public-hls.json` e uma captura local em `.build/video-statistics-public-preview.png`. Não requer backend real e não consulta a Kick.

A [evidência desta entrega](evidence/video-statistics-validation.json) registra resultados e hash do IPK. Esse registro corresponde ao pacote experimental 0.2.1. A versão 0.2.2 integra as estatísticas e renomeia a métrica para “Distância da borda acessível”, sem alterar seu cálculo. O pacote da Release 0.2.1 publicada anteriormente não contém esta evolução. O empacotamento usa a CLI oficial no perfil `tv`, com allowlist de dezessete arquivos de execução.

## Validação física e roteiro de regressão

O usuário confirmou ter testado o IPK experimental e autorizou a integração e publicação da versão 0.2.2. Não foram fornecidos resultados individuais de cada cenário abaixo; eles permanecem como roteiro de regressão.

Para empacotar e instalar:

```bash
npm run package
npx ares-launch --device lgc3 --close com.kicktv.poc
npx ares-install --device lgc3 dist/releases/com.kicktv.poc_0.2.2_all.ipk
npx ares-launch --device lgc3 com.kicktv.poc
npx ares-inspect --device lgc3 --app com.kicktv.poc
```

1. Registrar firmware e abrir `yetz` ou `baianotv` quando ao vivo, no modo padrão Direct HLS. Confirmar imagem/áudio antes de ativar estatísticas.
2. Ativar pelo Magic Remote. Conferir legibilidade à distância e ausência de recorte, mudança no vídeo ou captura de foco. Confirmar que permanece visível após 5 s e pode ser desligado pelo mesmo botão.
3. Em Auto, verificar resolução efetiva, buffer e contadores quando disponíveis; bitrate/FPS nominal/codecs devem ficar N/D. Aguardar pelo menos duas atualizações para FPS estimado. Comparar a indicação de valores com `KickNativeDiagnostics.snapshot()` no Inspector, sem publicar URLs ou credenciais.
4. Selecionar uma qualidade manual disponível. Conferir rótulo, declarações de bitrate/FPS/codecs e resolução efetiva separadamente; confirmar reset de contadores e ausência de perda de áudio.
5. Observar um episódio real de buffering por interrupção temporária de rede. Contar uma interrupção contínua e conferir tempo acumulado após retomar. Fazer pausa apenas se disponível; ela não deve aumentar o contador. A funcionalidade não introduz reconexão automática.
6. Trocar canal, recarregar, voltar, sair do app e comparar Native HLS opcional/iframe. Verificar encerramento do painel, nenhuma atualização de vídeo anterior e funcionamento dos controles. Repetir ciclos e observar recursos no Inspector.
7. Comparar reprodução prolongada com painel ligado/desligado: fluidez, áudio, buffer, quadros descartados e responsividade. Não declarar impacto nulo no decoder sem esse teste no hardware.

A confirmação física anterior de Direct HLS/1080p continua válida como referência. O teste do IPK experimental foi confirmado pelo usuário; não há medição detalhada de desempenho ou de reprodução prolongada no hardware nesta entrega.
