# Etapa A — investigação e decisão

Data: 08/11/2026. Prioridade: obter reprodução autorizada diretamente no aplicativo da TV.

**Resultado da validação posterior:** o usuário instalou e testou o aplicativo na LG OLED C3 e declarou a prova de conceito bem-sucedida. Foram confirmados teclado, reprodução de canal online em tela cheia, exibição de offline e retorno à entrada. O [relato de validação](TESTES.md) registra os canais utilizados e o comportamento de um canal inexistente. Esta atualização é somente documental; a aplicação permanece inalterada.

## Kick: metadados e acesso à mídia são interfaces diferentes

A [API de canais](https://docs.kick.com/apis/channels) documenta `GET https://api.kick.com/public/v1/channels?slug=xqc` e `stream.is_live`. Aceita App Access Token ou User Access Token com `channel:read`. Portanto, é possível consultar status oficialmente, **com autenticação**. O app entregue não faz essa consulta: não há credenciais fornecidas, e embutir um segredo no `.ipk` o exporia.

O [OAuth oficial](https://docs.kick.com/getting-started/generating-tokens-oauth2-flow) documenta Client Credentials para tokens de aplicação e exige `client_secret`. O fluxo de usuário também documenta segredo e troca de código. Implementar autenticação segura exigiria um componente confiável fora do pacote; isso não resolveria por si só a falta de uma interface HLS documentada. Não foi introduzido backend.

No [OpenAPI oficial](https://api.kick.com/swagger/doc.json), `endpoints.Stream.url` exemplifica `rtmps://stream.kick.com/1234567890`, acompanhado de `key`: são dados de envio. Não são HLS de visualização. Os contratos consultados de canais e livestreams não documentam `playback_url` nem endpoint para obter uma playlist. A conclusão é limitada à documentação disponível: não prova inexistência de acordos privados de reprodução. Um resumo dos campos, caminhos e hash do esquema consultado está em [evidence/kick-api-summary.json](evidence/kick-api-summary.json).

**Bloqueio para integração direta com `<video>`:** não foi encontrado um método oficial documentado que forneça a URL HLS e suas condições de uso a este cliente. Sem essa URL, não é possível validar codecs, assinatura, expiração, cookies, referer ou autorização de reprodução de uma live Kick diretamente. Não foram testados endpoints internos nem supostas URLs deduzidas.

## Alternativa documentada adotada

A [central oficial da Kick](https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream) permite incorporar `https://player.kick.com/USERNAME` em iframe e documenta `autoplay`, `muted` e fullscreen. A PoC usa esse caminho dentro da aplicação instalada. Não depende de navegador externo. A documentação é voltada a websites; **não certifica execução em pacote `file://` do webOS**.

Não exige fornecer token ao iframe na integração documentada. Isso não significa ausência de tokens ou cookies dentro do player: sua gestão pertence à Kick. Não há, nessa página, SDK documentado para o pai consultar online/offline, observar falhas, controlar o vídeo ou desativar a interface interna. Nenhum protocolo `postMessage` foi inventado.

O iframe preenche a janela do aplicativo por CSS, sem chamar a Fullscreen API. Isso evita exigir outro gesto para tela cheia, mas não controla como o player remoto apresenta proporções, avisos ou controles. O foco é mantido no pai. O usuário confirmou que o player abre e reproduz canais online em tela cheia e que o retorno à entrada funciona na C3. Login, desafios e consentimentos interativos continuam sendo limites da integração.

Alternativas se esse caminho falhar na TV: solicitar à Kick uma integração de reprodução autorizada/documentada para smart TVs; avaliar com a Kick um contexto HTTPS hospedado se o bloqueio for especificamente o esquema local. Essa segunda alternativa exige hospedagem e não foi implementada. Introduzir um backend apenas para status não fornece HLS. Ferramentas de scraping e proxies de terceiros não demonstram autorização e não foram usadas.

## Políticas HTTP e observações

A consulta de canais sem token retornou HTTP 401. Na resposta observada do embed houve HTTP 200, `Access-Control-Allow-Origin: *` e nenhum `X-Frame-Options`/CSP. Isso vale somente para aquela resposta; não garante políticas futuras nem acesso à mídia. O HTML também incluiu mecanismo Cloudflare, que não foi contornado. [Evidência filtrada](evidence/embed-policy.json).

Navegar um iframe não exige CORS como uma requisição `fetch`, mas continua sujeito a políticas de incorporação, autoplay e privacidade. A política de mesma origem impede o JavaScript do pai de inspecionar o conteúdo remoto. Não foi verificado CORS autenticado da API nem de um HLS Kick: faltam token e fonte oficialmente fornecida. Não há evidência suficiente para afirmar se `Origin: null` ou um referer específico será aceito em todas as requisições do player.

## webOS 25

A [LG documenta HLS nativo, HTTP/HTTPS e HLS versão 7](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm). Live seek é suportado desde webOS 3.0; duração dos segmentos de áudio e vídeo deve coincidir. Alterações de codec/container/PID em `EXT-X-DISCONTINUITY` não têm suporte geral. Há tags ignoradas ou parcialmente suportadas, como I-frame playlists, `EXT-X-INDEPENDENT-SEGMENTS` e `EXT-X-DATERANGE`. Por isso, um `.m3u8` válido não garante reprodução correta em qualquer TV. O diagnóstico usa HTML5 `<video>` e velocidade padrão, sem seek manual ou biblioteca MSE.

A [tabela AV do webOS 25](https://webostv.developer.lge.com/develop/specifications/video-audio-250) inclui H.264, HEVC, AAC e MPEG-TS; para Full HD lista H.264 até 1080p60, Level 4.2, 40 Mbps. A opção conservadora para uma futura URL autorizada seria H.264/AAC em HLS compatível. Não se confirmou o formato efetivo de uma live Kick.

O [motor web do webOS 25 é Chromium 120](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine). A mesma fonte alerta que apps empacotados com esquema local não suportam cookies como apps hospedados. No uso relatado pelo usuário na C3, a reprodução pelo embed funcionou sem erros identificados; isso não demonstra suporte geral a cookies nem acesso a fluxos que exijam autenticação. O teste em Chromium Linux não reproduz a pilha multimídia da LG; a validação posterior na TV está registrada separadamente.

A [LG lista TLS 1.2 e 1.3 para webOS 25](https://webostv.developer.lge.com/develop/specifications/tls). Certificados precisam ser confiáveis na TV. Foram usadas fontes HTTPS com verificação de certificados; não se desativou TLS nem se habilitou conteúdo inseguro. Uma tentativa com a antiga URL `devimages.apple.com` falhou por incompatibilidade de certificado, e não foi adotada.

O [botão Voltar usa código 461 e permite tratamento explícito com `disableBackHistoryAPI`](https://webostv.developer.lge.com/develop/guides/back-button). O app remove o player ao voltar. A [documentação do teclado virtual](https://webostv.developer.lge.com/develop/guides/virtual-keyboard) diz que o foco no campo abre o teclado; por isso, não se capturam suas setas enquanto estiver visível. O usuário confirmou o funcionamento do teclado para digitação e do botão de retorno à entrada na LG C3. O agente não inspecionou diretamente o firmware.

## Decisão por etapa

| Etapa | Resultado |
| --- | --- |
| A — investigação | HLS Kick direto bloqueado por falta de contrato público de reprodução; embed oficial adotado e validado pelo usuário na C3 |
| B — player | Diagnóstico HLS nativo e integração mínima por embed, sem extrair mídia |
| C — webOS | App empacotado com HTML/CSS/JS, manifesto e ícones |
| D — pacote | `.ipk` gerado pela CLI oficial; conteúdo inspecionado |
| E — validação | Testes locais executados; instalação, reprodução e fluxo de uso na C3 confirmados pelo usuário; PoC aceita como bem-sucedida |
