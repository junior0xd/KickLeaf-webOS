# Descoberta experimental de transmissões

A tela inicial experimental do KickLeaf tem a seção **Procurar**, com quatro cards por linha, e mantém o formulário de abertura por slug. Ela roda na mesma página da reprodução HLS e usa as interfaces anônimas observadas na investigação na LG C3. O IPK exige o parâmetro de inicialização `experimentalDiscovery: true` para exibir a grade. O player oficial e o diagnóstico HLS continuam nos seus fluxos já existentes.

```sh
npx ares-launch --device lgc3 --params '{"experimentalDiscovery":true}' com.kickleaf.client
```

O acesso técnico à interface interna da Kick não estabelece autorização para uso em produção. A integração permanece opt-in até que as condições sejam esclarecidas. Mudanças no contrato, no CORS ou na política de acesso podem indisponibilizar a grade. [Termos da Kick](https://kick.com/terms-of-service)

## Adaptador

`app/discovery-api.js` controla a consulta web a `GET https://web.kick.com/api/v1/livestreams`. A página usa `limit=24`, `sort=viewer_count_desc` e `display_language=pt`. O adaptador aceita `language` e `category_id` quando o chamador os fornece. A próxima página usa o cursor opaco retornado em `next_cursor` como `after`. IDs de transmissão e slugs deduplicam os resultados recebidos. Uma página sem itens novos com cursor ou um cursor já visto encerra a paginação. Nenhum controle de busca ou filtro está exposto nesta versão.

O transporte HTTP reutilizado por `app/direct-api.js` e pelo adaptador limita o corpo a 512 KiB, mantém TLS e CORS do navegador e omite credenciais. O timeout da grade é de 6,5 s. Erros de HTTP, transporte e contrato são tratados como indisponibilidade. A tentativa seguinte depende da pessoa usuária. O adaptador respeita o `Retry-After` que o navegador expõe, em segundos ou data HTTP. Um 429 sem cabeçalho legível bloqueia novas consultas da grade por 60 s. Uma falha de paginação mantém os cards existentes e oferece nova tentativa.

O modelo normaliza IDs, slug, nome, mídias, categoria, título, idioma, audiência, início e instante da obtenção. Campos ausentes usam `null`, e audiência zero é um valor válido. Apenas registros com slug utilizável formam cards. O status ao vivo vem do contexto das rotas de listagem e de transmissão ativa. A grade mostra audiência somente com autorização explícita do campo `show_view_count`.

Ao abrir um canal, o fluxo HLS ainda resolve e valida a URL do vídeo, lê o manifesto dentro do prazo existente e usa a conexão de chat já implementada. Após a descoberta confirmar que o canal está online, o player pode semear o card com o registro ainda válido da listagem. A resposta da reprodução complementa o registro, inclusive quando a audiência chega como `viewers` em vez de `viewer_count`. IDs de fontes diferentes usam espaços distintos. Horários de início incompatíveis impedem reaproveitar a fotografia anterior. Uma negativa de exibição da audiência também vale para as atualizações do card daquela transmissão.

## Limites de processamento

| Recurso | Limite e comportamento |
| --- | --- |
| Rede de descoberta | Uma consulta em voo. Chamadas equivalentes compartilham a requisição. Uma nova consulta invalida a anterior. Entrar no player ou ocultar o aplicativo suspende a descoberta. |
| Paginação | Até três páginas por visita, com 24 resultados por página e máximo de 72 cards. A continuação começa quando o foco entra na última linha ou a rolagem chega a 120 px do fim. |
| Cache de páginas | Seis páginas em memória, por URL parametrizada. Validade de 60 s, com descarte do registro usado há mais tempo ao atingir o limite. |
| Cache de canais | Até 144 slugs em memória e validade máxima de 60 s. Um registro parcial da mesma live conserva campos mais completos enquanto a amostra anterior é válida. |
| Imagens | Até dois espaços por card. O observador carrega as imagens até 100 px antes ou depois da área rolável e retira as fontes fora desse intervalo. Ao entrar no player, todas as fontes da grade são retiradas. O navegador gerencia o cache de bytes e a memória decodificada. |
| Resolução | Entre até oito variantes de largura validadas, a grade seleciona a menor que atenda à largura lógica do card, com fator de densidade limitado a 1,25. Usa a maior disponível quando nenhuma atinge o tamanho e o `src` quando não há variantes válidas. |
| Atualização | Nenhum cronômetro de atualização na grade. Os cards permanecem estáveis enquanto a pessoa navega. Ao voltar da reprodução, a grade conserva páginas, foco e rolagem se a primeira página ainda estiver válida. Caso contrário, refaz a primeira página. |

As três páginas limitam o custo de DOM sem reciclagem de foco ou virtualização. A validade de 60 s cobre uma ida e volta curta ao player e evita reaproveitar por muito tempo dados sujeitos a mudança. A carga de imagens acompanha a área exposta. Falhas mantêm o espaço da mídia com o placeholder, sem redimensionar o card.

## Navegação

O foco experimental começa em **Assistir**, evitando abrir o teclado virtual ao entrar. As setas descem do cabeçalho para a grade, sobem da primeira linha ao cabeçalho e mantêm o item focado visível. OK sobre o card abre o canal. Voltar da grade leva ao cabeçalho. O fluxo de Voltar durante a reprodução continua passando pelos controles e pelo modo Tela cheia antes de voltar à entrada.

`KickHomeDiagnostics.snapshot()` fornece métricas agregadas do estado da grade, primeira apresentação, contagem de páginas, elementos e imagens com fonte. O coletor experimental lê esses dados no Inspector e não faz parte do IPK.

## Validação na LG C3

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
