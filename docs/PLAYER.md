# Player do KickLeaf

Referência funcional: v0.2.9. O [manifesto](../app/appinfo.json) define o ID `com.kickleaf.client` e a resolução lógica de 1920 × 1080. O alvo dos ensaios físicos é a LG OLED C3 com webOS 25. Veja [instalação e verificação na TV](TESTES.md).

## Modos de reprodução

| Modo de abertura | Descoberta e reprodução | Uso |
| --- | --- | --- |
| `direct-hls` | O app consulta a Kick e entrega a URL ao elemento `<video>` nativo. A TV recebe mídia da CDN. | Padrão quando nenhum modo é informado. |
| `native-hls` | Um backend Python local fornece metadados HLS ao mesmo player nativo. A TV recebe mídia da CDN. | Explicitamente configurado com origem e token da API local. |
| `iframe` | O documento pai incorpora o player oficial da Kick. | Parâmetro de abertura ou opção **Usar player oficial** durante o HLS. |
| `hls-test` | Página de diagnóstico com a amostra pública Apple Bip Bop. | Verificação independente de áudio, vídeo e decodificação HLS. |

O app aceita nome de canal ou URL da Kick e normaliza a entrada. `app.js` direciona a abertura e `native-hls.js` coordena os dois modos HLS. A reprodução usa o pipeline nativo do webOS, sem hls.js, MSE ou retransmissão de mídia pelo KickLeaf. A reprodução HLS começa no modo **Completo**, com o card abaixo do vídeo e 25% da tela reservados ao chat. **Teatro** recolhe o card e mantém o chat. **Tela cheia** amplia a área do player e encerra o chat. Os três modos usam a mesma instância do vídeo e preservam sua proporção. [Chat](CHAT.md)

O card usa os dados disponíveis na descoberta HLS direta e na resolução da sala do chat. A contagem de espectadores recebe atualizações pela consulta de canal, em intervalos de pelo menos 60 s enquanto o chat está ativo. O tempo decorrido é calculado localmente a partir do horário de início fornecido pela Kick. Campos indisponíveis ficam ocultos.

## Direct HLS

[`direct-api.js`](../app/direct-api.js) consulta o endpoint interno `/api/v2/channels/{canal}/livestream` em `kick.com` sem credenciais. `data: null` indica ausência de transmissão e uma resposta online precisa ter `data.playback_url`. O código recusa redirecionamentos, limita as respostas a 512 KiB e usa prazos de 8 s para descoberta e 3 s para o manifesto, dentro do prazo externo de 12 s. Erros HTTP observáveis têm mensagens específicas. Uma falha genérica de `fetch` pode decorrer de rede, DNS, TLS ou CORS. A descoberta direta depende do contrato interno e da política HTTP da origem da TV. A implementação atual não executa desafios JavaScript nem contorna recusas de acesso.

[`hls-manifest.js`](../app/hls-manifest.js) aceita HTTPS em `stream.kick.com` e subdomínios de `live-video.net`, dentro dos limites de URL definidos no parser. Lê até 64 variantes e resolve as URIs relativas contra o manifesto. Variantes com grupos externos ou não resolvidos de áudio/vídeo e variantes com URL inválida ficam desabilitadas. **Auto** entrega a URL principal ao player nativo, inclusive quando a leitura auxiliar do manifesto falha. A análise serve para seleção e exibição de metadados. Segmentos, adaptação e decodificação ficam a cargo do pipeline da TV.

## Native HLS com backend local

Use este modo somente quando precisar da descoberta pelo [backend opcional](../backend/run.py). A API `GET /api/streams/{canal}` requer Bearer local, atende clientes em redes locais e devolve estado online, URL HTTPS e variantes. A operação usa duas vagas de descoberta simultâneas, prazo padrão de 10 s e origens CORS explícitas. O padrão `null` atende ao contexto local do app. O launcher aceita bind HTTP em loopback e exige TLS com certificado e chave para bind LAN. Use um certificado em que a TV confie.

Na raiz do projeto, prepare as cópias locais uma vez. Para a suíte Python, use `backend/requirements-dev.txt` e o roteiro de [testes](TESTES.md).

```bash
mkdir -p .tools
python3 -m venv .tools/backend-venv
.tools/backend-venv/bin/python -m pip install -r backend/requirements.txt
cp -n backend/.env.example .tools/native-backend.local.env
cp -n config/native-hls.example.json .tools/native-hls.local.json
chmod 600 .tools/native-backend.local.env .tools/native-hls.local.json
```

Defina `KICKTV_API_TOKEN` e `apiToken` com o mesmo segredo local aleatório, de 32 a 128 caracteres alfanuméricos, `_` ou `-`. Para acesso pela TV, preencha `KICKTV_HOST` com o endereço LAN específico do servidor, configure `KICKTV_TLS_CERT` e `KICKTV_TLS_KEY` e informe uma origem HTTPS acessível pela TV em `backendURL`, sem caminho, query ou credenciais. Mantenha as cópias preenchidas fora do Git.

```bash
set -a
. .tools/native-backend.local.env
set +a
.tools/backend-venv/bin/python -m backend.run
```

O provedor `public-test` aceita somente `hls-test` e retorna a amostra Apple como mídia não ao vivo. Após esse teste, use `KICKTV_PROVIDER=kick` e reinicie o processo para testar a descoberta experimental de lives. Com o KickLeaf instalado e fechado, inicie o app e use o canal correspondente ao provedor:

```bash
npx ares-launch --device lgc3 --params "$(cat .tools/native-hls.local.json)" com.kickleaf.client
```

O backend valida a origem da mídia. O cliente também valida o contrato da resposta e exige HTTPS nas URLs usadas. O token pertence à API local. O backend fica fora do IPK e roda em primeiro plano até Ctrl+C.

## Player oficial em iframe

**Usar player oficial** libera o HLS, encerra o chat e abre o formulário do iframe com o canal preenchido. Confirme **Assistir**. O pai mantém o foco e usa CSS para ocupar a área do app. O embed decide disponibilidade da live, qualidade e controles internos. O pai consegue observar navegação e erros do elemento, sem acesso ao estado de mídia, buffering ou qualidade.

Depois de 25 s sem confirmação de navegação, o app orienta a recarga manual. Um `error` observável permite até três recargas automáticas, após 2, 4 e 8 s, aguardando a rede se o navegador indicar offline. Cada recarga manual reinicia esse orçamento. Um evento `load` indica fim da navegação, inclusive para algumas páginas de erro. `embed_requested` só indica que o iframe foi solicitado.

## Controles, foco e ciclo de vida

- OK ou as setas abrem a barra, com foco inicial em **Configurações**. As setas navegam pelos controles visíveis e pulam opções desabilitadas. Com o teclado virtual aberto na entrada, ele recebe as teclas.
- No HLS, a barra oferece reprodução/pausa, teatro, configurações e tela cheia. Configurações reúne qualidade, recarga, player oficial e estatísticas. Trocar qualidade recria o vídeo com os metadados atuais. Recarregar refaz a descoberta e volta a Auto. Uma recarga bem-sucedida do mesmo canal preserva o chat ativo. O botão Teatro alterna entre Completo e Teatro e, em Tela cheia, abre Teatro diretamente. O botão Tela cheia volta ao modo anterior ao sair. A TV controla o volume.
- A barra e o gradiente somem após 5 s sem interação quando os menus estão fechados. Voltar fecha nesta ordem: submenu de qualidade, configurações e barra. Na reprodução sem controles abertos, Voltar entra em Tela cheia e, se já estiver nesse modo, retorna ao formulário. Voltar na entrada HLS leva ao formulário do iframe, onde um segundo Voltar confirmado sai do app. No iframe, Voltar fecha submenu, configurações, barra e reprodução antes da confirmação de saída.
- Troca de canal, saída e perda de visibilidade encerram a reprodução anterior. Falha de mídia ou espera de 25 s na partida ou durante buffering pode retornar à entrada com aviso. O player oficial pode ser escolhido explicitamente.

## Pausa e retomada em HLS

O botão da barra e as teclas de mídia atuam sobre o elemento nativo. A pausa guarda `currentTime`. A retomada tenta preservar a posição e confirma reprodução sem busca pendente, com tolerância de 0,5 s. Se a posição expirou e `seekable` permite concluir isso, busca uma vez o ponto acessível mais próximo em `seekable` ou `buffered` e exibe um aviso. Um deslocamento do pipeline pode levar a uma tentativa de correção da posição. A espera tem prazo de 25 s e pode ganhar mais um prazo após a recuperação. Se a retomada falhar, o vídeo fica pausado com orientação para tentar novamente ou recarregar. A presença e extensão das janelas dependem da transmissão e do dispositivo.

**Recurso futuro em avaliação:** busca manual na janela da live ou DVR. Na v0.2.9 o usuário pode pausar e retomar dentro da janela que o pipeline expõe.

## Estatísticas do vídeo

Ative em **Configurações → Estatísticas do vídeo** nos modos HLS. O painel atualiza a cada segundo enquanto visível, permanece após a barra sumir e não captura foco. Trocar qualidade preserva sua visibilidade e reinicia métricas da instância. Recarregar, trocar canal, voltar à entrada ou sair desativa o painel. [`video-stats.js`](../app/video-stats.js) acompanha eventos do vídeo e expõe leituras sob demanda em `KickNativeDiagnostics.snapshot()`. [`video-stats-panel.js`](../app/video-stats-panel.js) formata a exibição.

| Métrica | Fonte e interpretação |
| --- | --- |
| Resolução efetiva e quadros totais/perdidos | `videoWidth` × `videoHeight` e `getVideoPlaybackQuality()`, quando disponíveis e válidos. |
| FPS apresentados | Estimativa pelo delta de quadros totais menos perdidos, dividido pelo tempo monotônico entre amostras de pelo menos 1 s. |
| FPS, bitrate nominal e codecs | Declarações da variante manual. Em Auto a variante é desconhecida. Bitrate nominal não mede tráfego recebido. |
| Buffer à frente e distância da borda acessível | Fim do intervalo contíguo em `buffered` menos a posição atual, e fim de `seekable` menos a posição em live, respectivamente. |
| Interrupções e tempo em buffering | Episódios de `waiting` após início da reprodução, com deduplicação e encerramento em retomada, pausa, busca, erro ou fim. `stalled` isolado fica fora. |
| Latência absoluta da live, throughput e decoder efetivo | Indisponíveis nesta arquitetura. A borda acessível é relativa à timeline exposta pelo player. |

Valores indisponíveis aparecem como **N/D**. Os contadores valem para a instância atual do vídeo. Veja [roteiro de regressão e evidências históricas](TESTES.md).
