# Chat somente leitura, FIFO/ACK e emotes — v0.2.5

Durante a reprodução HLS, abra os controles com OK, selecione o botão de modo teatro e confirme. Vídeo ocupa 75% da tela; chat ocupa 25%. Tela cheia oculta o chat e encerra a conexão. Voltar fecha menus/controles, depois o chat e depois retorna ao formulário. Abertura do aplicativo e HLS isolado não iniciam chat. Não há login, envio de mensagens, histórico nem reconexão automática.

O serviço local `com.kicktv.poc.service` é a integração do serviço experimental validado, sem proxy/backend externo. `ws` permanece fixado em 8.22.2; `webos-service` vem do runtime webOS. Alvo validado: LG C3, Node 16.20.2. A sessão é limitada a **20 minutos**, ao lease negociado e aos orçamentos existentes; encerra sem renovar ou tentar reconectar. Ocultar/trocar canal/sair encerra consumidores, socket e imagens. Não há garantia de chat ilimitado.

A UI mantém até 60 linhas. Texto, Unicode e emotes entram na mesma FIFO, sem prioridades por conteúdo. Serviço e UI têm limites de 512 mensagens e 1 MiB de payload; cada item tem limite de 8 KiB. O serviço entrega a cada 100 ms, respeitando o crédito da UI. A UI insere até 32 mensagens por disparo do timer de 50 ms; esse limite é uma escolha inicial de lote, não capacidade máxima demonstrada da TV. Remoção das linhas antigas ocorre depois da inserção, liberando as referências dos emotes. Fontes e nomes continuam com 18px, badges com 20×20.

O ACK cumulativo de inserção no DOM pertence ao contrato local Luna. O serviço retém as mensagens até esse ACK; duplicatas de retransmissão são suprimidas por sequência e watermark. Sessão, contexto e ticket delimitam a validade das confirmações. O ACK de protocolo Centrifugo, correlação, assinatura e heartbeat permanecem na camada de transporte original. O ACK local não comprova pintura física nem espera o carregamento das imagens.

Uma entrega sem ACK pode ser retransmitida após 2 s, até três vezes. A primeira recusa por capacidade fecha a admissão nessa sessão e encerra a fonte, preservando as admitidas para drenagem. Cancelamento/falha do consumidor Luna também encerra a fonte; uma recuperação local, limitada a uma tentativa e ao mesmo contexto, pode drenar a sessão sem abrir outro WebSocket. Parar/trocar/ocultar chat tenta drenar antes de limpar. A drenagem tem prazo de até 60 s, sujeito à proteção de idade de pendência >30 s; o que não puder ser preservado ao final é contado como descarte explícito. O vídeo permanece independente. Sem consumidor recuperável ou com página encerrada, não se promete a inserção das pendências.

Os emotes são montados em elementos de imagem nativos 28×28, usando somente a resolução por ID decimal validado na CDN de emotes. Texto não vira HTML. Tokens inválidos/incompletos permanecem literais. O registro guarda metadados de até 192 IDs, protege os ativos e expulsa inativos por recência; não guarda blobs ou bitmaps próprios. Falha, timeout de 15 s ou falta de capacidade gera fallback textual. Ocultar/remover linhas limpa referências, handlers e timers. Cache de rede e imagens decodificadas pertencem ao navegador; a referência histórica de bytes não é limite de RAM.

O normalizador mantém limites de 80 unidades UTF-16 para nomes e 2.000 para mensagens, evitando high surrogate terminal isolado após truncamento/limpeza. O array auxiliar tem até 24 ocorrências de emotes; o renderer interpreta o texto limitado inteiro, sem depender desse array para encontrar as ocorrências. Badges legadas e badgeSet v1 preservam seu contrato anterior.

URLs originais passam pela validação estrita preexistente. Para `ext.cdn.kick.com/chat/badges/[A-Za-z0-9_-]+.png`, somente o endereço de transporte recebe `?width=72,format=webp,quality=50`, com limite de 65.536 bytes. Demais URLs aceitas usam o original e 131.072 bytes. Queries/fragmentos/credenciais externos continuam recusados. Não se ampliou a elegibilidade para outros caminhos ou formatos sem evidências.

MIME e assinatura binária devem concordar; SVG mantém as restrições existentes e todas as imagens passam pelo decoder, com dimensões naturais até 512×512. Não se presume WebP. Timeout de rede 8s e decode/associação 2s, concorrência duas, orçamento de sessão 2MiB. Cache guarda no máximo 64 entradas pela URL original, incluindo falhas, com Promise compartilhada; não há eviction/retry ou download do original após falha. URLs novas após esgotamento usam fallback local. Fechar chat limpa o cache e revoga objectURLs.

## Evidências e limites da validação

A integração 0.2.5 foi validada localmente com rede/mídia simuladas, inclusive protocolo real, serviço, JSON Luna, interface, emotes, conteúdo misturado, falhas e limpeza. Não houve nova instalação ou sessão na TV nesta entrega. Resultados históricos da LG C3 abaixo e dos laboratórios não certificam automaticamente a nova combinação ou uso por horas. Consulte [o relatório da versão](RELEASE-v0.2.5.md).

### Referência histórica da 0.2.4

Após aprovação explícita do usuário, foi integrado o candidato ensaiado em `baianotv` por **1.200,187s contínuos** na LG C3: HLS em 1080p, uma conexão WSS, zero reconexões, 4.601 mensagens normalizadas, 3.975 recebidas/apresentadas pela UI, 626 descartadas pela fila preexistente do serviço sob rajadas. Não houve descarte adicional na UI.

**61 imagens distintas aceitas/exibidas, zero rejeitadas**, 2.131 element_loaded e 129 badges legadas locais. Todas as respostas foram PNG, 1.073–4.041 bytes, 91.949 bytes totais. Cache: 2.070 hits, incluindo duas deduplicações em andamento; pico de 61 entradas e duas cargas. Zero falhas de rede, limite, decode ou JavaScript nesta amostra. Não se provocaram downloads reais para testar falhas; testes controlados cobrem essas condições e os tetos inclusivos 64/128KiB. Isso não valida todas as badges da Kick ou todas as redes/TVs.

Houve seleção Auto→1080p com substituição do elemento de vídeo aos aproximadamente 10s, sem reiniciar chat ou registrar erro de mídia. Os eventos de buffering ficaram restritos à inicialização/mudança; 0,0837s medidos na instância final. O usuário confirmou ausência de problemas. As capturas do Inspector mostram chat/badges, mas não o plano nativo do vídeo. Não foram medidos bytes HLS, áudio ou CPU/RSS total da televisão.

[Resumo sanitizado](evidence/cdn-badges-v024/summary.json), [resultados por imagem](evidence/cdn-badges-v024/images.json), [limpeza do serviço](evidence/cdn-badges-v024/stopped-service.json), [preservação da TV](evidence/cdn-badges-v024/preservation.json). Os relatórios públicos sanitizados estão em [experiments/reports](../experiments/reports/README.md); a telemetria e os originais permanecem somente no workspace. Nenhum experimental está instalado; 90 arquivos dos aplicativos preexistentes mantiveram hashes idênticos. A versão principal integrada foi validada localmente; não substituiu o aplicativo da TV durante esse ensaio.

## Desenvolvimento

Instale os locks de ferramentas e do serviço: `npm ci` e `npm ci --prefix service --omit=dev --ignore-scripts --no-audit --no-fund`. Execute `npm test`, `npm run validate -- --tag v0.2.5` e `npm run package`. A lista explícita em packaging.json controla app e serviço; a auditoria do IPK confere caminhos, conteúdo e identidade de ambos, incluindo ws sem addons nativos. O workflow existente publica somente após aprovação dos testes e empacotamento da tag.
