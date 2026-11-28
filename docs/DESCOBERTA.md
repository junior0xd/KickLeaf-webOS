# Descoberta experimental de transmissões

A tela inicial OLED Premium abre sempre e permite acesso direto por slug ou URL. Ela registra os últimos cinco canais resolvidos com sucesso na sessão. Quando a listagem está habilitada, cada grupo exibe até cinco transmissões e recupera a posição ao retornar do player.

Em uma instalação nova, selecione **Ao vivo** com o controle remoto para ativar a listagem. A escolha fica salva no aplicativo e a lista é carregada nas próximas aberturas, sem parâmetros de lançamento. Se a consulta falhar, a inicial mantém o acesso pelo cabeçalho e oferece nova tentativa da listagem.

A seção 1.4 dos Termos da Kick estabelece restrições a acesso automatizado e a meios de acesso não autorizados. A aprovação da interface do KickLeaf é uma decisão do projeto. Uma resposta bem-sucedida da interface interna não estabelece autorização da Kick. A habilitação inicial continua explícita e seu uso depende das condições aplicáveis. [Termos da Kick](https://kick.com/terms-of-service)

## Adaptador

`app/discovery-api.js` controla a consulta web a `GET https://web.kick.com/api/v1/livestreams`. A página usa `limit=24`, `sort=viewer_count_desc` e `display_language=pt`. O adaptador aceita `language` e `category_id` quando o chamador os fornece. A próxima página usa o cursor opaco retornado em `next_cursor` como `after`. IDs de transmissão e slugs deduplicam os resultados recebidos. Uma página sem itens novos com cursor ou um cursor já visto encerra a paginação. Nenhum controle de busca ou filtro está exposto nesta versão.

O transporte HTTP reutilizado por `app/direct-api.js` e pelo adaptador limita o corpo a 512 KiB, mantém TLS e CORS do navegador e omite credenciais. O timeout da grade é de 6,5 s. Erros de HTTP, transporte e contrato são tratados como indisponibilidade. A tentativa seguinte depende da pessoa usuária. O adaptador respeita o `Retry-After` que o navegador expõe, em segundos ou data HTTP. Um 429 sem cabeçalho legível bloqueia novas consultas da grade por 60 s. Uma falha de paginação mantém os cards existentes e oferece nova tentativa.

O modelo normaliza IDs, slug, nome, mídias, categoria, título, idioma, audiência, início e instante da obtenção. Campos ausentes usam `null`, e audiência zero é um valor válido. Apenas registros com slug utilizável formam cards. O status ao vivo vem do contexto das rotas de listagem e de transmissão ativa. A grade mostra audiência somente com autorização explícita do campo `show_view_count`.

As URLs de thumbnail observadas na LG C3 usam `web.kick.com/api/v1/channels/<id>/thumbnail.jpeg` com o único parâmetro opcional `height` nos valores 160, 360, 480, 720 ou 1080. O adaptador aceita esses parâmetros somente nas URLs de thumbnail. O limite de tamanho de URL e as regras de HTTPS e de origem continuam válidos.

Ao abrir um canal, o fluxo HLS ainda resolve e valida a URL do vídeo, lê o manifesto dentro do prazo existente e usa a conexão de chat já implementada. Após a descoberta confirmar que o canal está online, o player pode semear o card com o registro ainda válido da listagem. A resposta da reprodução complementa o registro, inclusive quando a audiência chega como `viewers` em vez de `viewer_count`. IDs de fontes diferentes usam espaços distintos. Horários de início incompatíveis impedem reaproveitar a fotografia anterior. Uma negativa de exibição da audiência também vale para as atualizações do card daquela transmissão.

## Paginação visual e tráfego

| Recurso | Comportamento |
| --- | --- |
| Metadados | Uma consulta em voo. Avançar por dados já recebidos e voltar para um grupo anterior reutilizam o catálogo em memória. A próxima consulta só sai quando o avanço precisa de mais itens para completar o grupo. |
| Limites | Até três consultas bem-sucedidas de 24 resultados, com máximo de 72 registros antes de deduplicar. Só o grupo atual fica no DOM. O grupo final pode conter menos de cinco cards. |
| Recência | O catálogo da sessão permanece disponível para restaurar a posição mesmo depois de 60 s. Os campos exibem a fotografia da última consulta. O cache de páginas e de metadados usado pelo player conserva a validade de 60 s e a abertura continua consultando o canal. |
| Falhas | O grupo atual e os dados recebidos ficam disponíveis. A próxima tentativa é explícita. Fim da lista ou cursor repetido encerra o avanço. |
| Imagens | Thumbnails e avatares recebem URL somente quando o card do grupo montado entra na área visível. A grade usa a menor variante adequada, com fator de densidade limitado a 1,25. Ao abrir o player, o componente suspende a consulta em voo e retira as fontes da grade. O navegador administra a reutilização de bytes e imagens decodificadas. |
| Frequência | A tela inicial inicia uma consulta ao abrir a descoberta. Não há atualização periódica ou prefetch de outros grupos. |

**Navegação por controle remoto.** As setas laterais percorrem o grupo. Ultrapassar a última ou a primeira posição troca de grupo. Cima e baixo percorrem as seções com ações disponíveis. OK abre o item focado. Voltar na tela inicial retorna ao cabeçalho antes de oferecer a saída. O foco inicial é **Início**, fora do campo que aciona o teclado virtual.

`KickHomeDiagnostics.snapshot()` informa os cards montados em `cards`, os registros recebidos em `loaded`, o grupo atual, as páginas aceitas, as imagens com fonte, os nós da tela e o tempo até a primeira fileira. A paleta, o brilho de foco e a duração da transição usam os mesmos valores aprovados, agora em `app/oled-tokens.css`. A composição e a tipografia da inicial ficam em `app/discovery-home.css`.

## Banners e eventos ativos

O site oficial publica listas de eventos ao vivo e futuros em `/events`. A página pública observada inclui nomes, imagens de `content.kick.com`, categorias e vínculos com canais. O índice do Kick Dev documenta a listagem pública de lives e eventos de webhook, sem expor um catálogo público documentado de eventos editoriais ou dos banners da inicial. [Página de eventos](https://kick.com/events) · [Guia oficial para espectadores](https://help.kick.com/en/articles/17574493-kick-events-a-viewer-s-guide) · [Índice da documentação do Kick Dev](https://docs.kick.com/llms.txt)

Uma consulta HTTP comum a cada URL (`kick.com/`, `kick.com/events` e a URL inicial em `web.kick.com/api/v1/livestreams`) retornou HTTP 403 no ambiente de desenvolvimento. O HTML bruto e os dados de hidratação ficaram indisponíveis. Na LG C3 a mesma listagem retornou HTTP 200. A amostra de 24 registros trouxe somente `data.livestreams` e `data.pagination.next_cursor` no objeto `data`, sem metadados de promoções ou eventos.

O componente está preparado para receber um banner e até dois eventos ativos em `setHighlights({banner, activeEvents})`, com título, imagem da lista de origens permitidas, descrição, período e slug de uma live quando disponíveis. Nesta entrega as duas seções ficam ocultas. O app faz **zero consultas adicionais** e baixa **zero imagens de promoções ou eventos**. Não há integração de autenticação, raspagem de HTML ou recursos promocionais. A autenticação e o custo de uma eventual fonte adicional dependem de um contrato permitido. Qualquer origem de mídia nova também requer validação.

## Validação da tela inicial OLED Premium na v0.3.1

No Chromium, com respostas simuladas, a ida do grupo 1 ao 6 e a volta ao 5 produziram duas consultas de listagem e 54 solicitações de imagens. Ao voltar do player ao grupo 5, o navegador reaproveitou essas imagens e nenhum GET de listagem adicional foi feito. Também foram verificados o fim da lista, falha e tentativa explícita, foco, retorno após o TTL de metadados, altura constante dos cards e as resoluções de 1920 × 1080 e de 3840 × 2160.

Na OLED55C3PSA com firmware 33.31.68, o Inspector confirmou o viewport lógico de 1920 × 1080 com densidade de pixel 2. A ida do grupo 1 ao 5 e a volta ao 4 registraram duas requisições de listagem HTTP 200 e 50 solicitações de imagens no Resource Timing, sendo 25 thumbnails e 25 avatares. Os grupos 1 a 4 usaram a consulta inicial. O grupo 5 acrescentou a segunda. A volta ao grupo 4 não gerou novas solicitações nesse ensaio. Cada grupo exibiu cinco thumbnails e cinco avatares decodificados. O DOM da tela inicial permaneceu em 84 elementos durante esse percurso. A medição não estima bytes transferidos nem comprova redução de tráfego total.

Em um teste curto na TV, OK sobre o primeiro card iniciou HLS em Completo com informações da transmissão. O chat conectou em Teatro. Tela cheia ocultou o chat e conservou a instância do vídeo. Ao voltar, o aplicativo liberou o vídeo e restaurou o grupo e o foco. A avaliação de brilho, contraste e conforto visual fica para a inspeção presencial.

## Referência histórica na LG C3

Os resultados a seguir correspondem à grade anterior de quatro colunas.

A prova usou um IPK com ID separado, na OLED55C3PSA com firmware 33.31.68, resolução lógica de 1920 × 1080 e densidade de pixel 2. O Inspector enviou teclas para navegar e selecionar um canal real. Os resultados abaixo correspondem a uma execução curta. O ensaio não comparou a cadência com uma versão anterior.

| Medição | Resultado |
| --- | --- |
| Primeira grade | 24 cards em 369 ms a partir da inicialização do componente. Um GET, 6.474 bytes codificados. |
| Imagens iniciais | 24 requisições nas linhas visíveis e próximas, com 371.840 bytes codificados. Na amostra de 23 imagens concluídas, os recursos levaram de 6 a 171 ms. |
| Paginação por foco | 48 cards após o segundo GET, de 6.784 bytes. Durante o deslocamento, 32 requisições de imagem observadas, 357.168 bytes concluídos e uma requisição interrompida. |
| Cadência de rAF | 56 intervalos no repouso, média de 18,2 ms. Na amostra de navegação com paginação, 33 intervalos, média de 30,3 ms e pico de 100 ms. |
| DOM e memória | 444 nós na primeira grade e 755 após a segunda página, contando todo o documento. `performance.memory` permaneceu em 10.000.000 bytes, sem resolução suficiente para estimar a variação. O RSS do processo web ficou indisponível no alvo do Inspector. |
| Reprodução | Abriu em Completo com o card preenchido. O chat conectou em Teatro. Teatro e Tela cheia preservaram a instância do vídeo e a posição avançou. A tela cheia ocultou o chat. |
| Suspensão e retorno | Zero imagens com fonte ativa e zero consultas de listagem em voo durante a reprodução. Na volta, 48 cards preservados, foco no 21º card e rolagem restaurada em 1.331 px. Nenhum GET adicional de listagem. |

Os primeiros ensaios revelaram dois problemas de foco por teclado. A abertura experimental passou a focar **Assistir**, evitando o estado de edição inicial na TV. O botão OK passou a ativar explicitamente o card focado. O último ensaio confirmou a correção. A queda pontual de cadência durante rolagem e carregamento de imagens fica registrada para a avaliação visual com o Magic Remote.
