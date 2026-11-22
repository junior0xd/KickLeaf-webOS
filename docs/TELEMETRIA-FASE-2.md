# Telemetria do KickTV na LG C3

## Auditoria e escopo

A análise partiu do coletor da v0.2.7 e das duas pastas locais de `renatogarcia`. Na rodada de 30 minutos, havia 361 amostras de player com buffer e contadores nativos de quadros, 359 com rAF e 61 diagnósticos com long tasks e DOM. A medição de heap também estava disponível. A observação visual do usuário registrou reprodução fluida. O mínimo de rAF descreve a menor estimativa da interface naquela amostragem.

| Fonte | Escopo e unidade | Uso |
| --- | --- | --- |
| `app/video-stats.js` | Buffer e posição em segundos. Contagens de buffering e quadros por instância de vídeo. Quadros vêm de `getVideoPlaybackQuality()` quando os valores são válidos. | Deltas apenas dentro do mesmo vídeo. O FPS derivado usa os contadores de mídia disponíveis. |
| `app/joint-telemetry.js` | Long tasks e atraso do event loop acumulados desde a abertura da página. Heap JS e nós DOM são instantâneos. | Reutiliza o observador da página. A nova trilha guarda até 120 tarefas e informa quantas foram sobrescritas antes da leitura. |
| `service/session.js`, `service/delivery.js` | Contadores cumulativos do serviço por sessão. RSS é a memória residente do processo Node em bytes. `item_ms` integra a fila no tempo em item·ms. | Deltas são calculados entre leituras da mesma sessão e instância. Picos da origem podem incluir o período de preparação. |
| `app/fifo-ui.js`, `app/chat-ui.js` | Espera da UI em ms monotônicos, por consumidor. Ofertas do serviço, recebimentos únicos, inserções e confirmações medem etapas diferentes. Apresentações na UI acumulam no contexto da página. | Uma sessão nova reinicia histogramas e contadores locais. Enquanto o mesmo consumidor sobreviver a uma troca de ticket, sua série mantém a continuidade. Uma sessão nova observada com uma única amostra não fornece delta. As leituras da UI e do serviço não são atômicas, então mensagens em trânsito nas bordas podem produzir deltas diferentes entre etapas. |
| Web Inspector / Ubuntu | Latência de cada consulta, horários de observação e atrasos entre amostras. | Leituras são serializadas. Um timeout do protocolo fecha a conexão para que um pedido pendente não seja seguido por outra consulta ao mesmo alvo. |

A LG identifica Chromium 120 como motor do webOS TV 25 e indica que a disponibilidade de APIs pode variar nos recursos da plataforma. A disponibilidade observada refere-se ao firmware usado nas coletas locais. A fase atual usa detecção de capacidade e preserva valores ausentes. [Motor web do webOS](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)

## Metodologia

### rAF e vídeo

A janela padrão registra intervalos entre callbacks durante uma rajada nominal de **1 s**, iniciada após uma leitura rápida do player. O tempo realmente observado é o intervalo entre o primeiro e o último callback. O FPS de cada janela é o número de intervalos válidos dividido pelo tempo observado. P50/P95/P99 usam o método do posto mais próximo. Sequências contíguas acima de 33,33 ms são medidas dentro da janela. Lacunas entre janelas e páginas ocultas ficam fora dessa medição.

`--raf-window=5` usa rajadas nominais de 5 s e também agrega intervalos que cabem nos subintervalos de 1 s. O recrutamento das rajadas fica limitado a aproximadamente 20% do tempo, respeitando a cadência do player. `--raf-window=0` desativa a medição adicional de rAF. O coletor registra os eventos do player e os contadores de vídeo em paralelo lógico, por consultas sequenciais. Uma queda de rAF descreve a cadência da interface. [Especificação dos callbacks de animação](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames)

### Latência do chat

A recepção local começa quando o serviço recebe a publicação já despachada pelo parser de protocolo. O relógio monotônico desse processo mede recepção→normalização, recepção→admissão, admissão→primeira oferta e recepção→ACK de cada mensagem coberta pela confirmação cumulativa. No contexto da página, usa-se o histograma existente de chegada à UI→inserção no DOM. A cópia de diagnóstico detalhada sai por `status` e os envelopes FIFO/ACK mantêm o seu contrato.

O coletor exporta oferta do serviço→callback na UI e última inserção do lote→ACK aceito usando o relógio de parede da TV. A primeira medida inclui a entrega Luna e a espera para executar o callback. A segunda tem uma observação por ACK cumulativo. Recepção na UI→DOM e recepção no serviço→ACK usam relógios monotônicos locais. A inserção no DOM antecede a apresentação física. O tempo de preparação e de inserção do fragmento, a duração total e o número de mensagens efetivamente inseridas são medidos por lote. Os histogramas de agendamento distinguem a espera pelo quadro do atraso além de 50 ms no fallback e do atraso além de 100 ms no timer do serviço com fila pendente.

Percentis dos histogramas são faixas. A média usa soma e contagem. O máximo exato da janela aparece quando pode ser recuperado do máximo cumulativo. Nos demais casos, o JSON traz o limite superior do último bucket ocupado, quando finito. O campo `latency_by_interval` em `summary.json` permite cruzar essas etapas com a ocupação e a idade do item mais antigo em cada fila.

### Carga, filas e memória

O serviço mantém o segundo em curso e os 30 segundos completos anteriores e máximos cumulativos das somas de 1, 5 e 30 segundos alinhadas por segundo. As colunas são mensagens normalizadas, primeiras ofertas e confirmações. O diagnóstico exporta os segundos completos disponíveis, numerados no relógio monotônico da sessão do serviço. O relatório deduplica segundos que aparecerem em duas leituras. O custo em memória fica constante e cada incremento atualiza três somas. O coletor deriva as taxas por segundo da diferença dos contadores em intervalos com duas leituras válidas. Essas taxas são médias por intervalo, com grupo e cobertura explícitos.

A fila usa média ponderada pela integral do serviço, máximo de sessão e P95 das profundidades amostradas. O tempo elevado é estimado apenas entre duas leituras próximas da mesma sessão que estejam acima do limiar. Um pico breve entre leituras pode ficar fora da estimativa. Lotes de inserção têm histograma de tamanho e tempo de processamento. O custo por mil mensagens divide o tempo observado de processamento pelo número de itens dos lotes observados.

O relatório registra heap JS, RSS do serviço, DOM, imagens de emotes e entradas de emotes e distintivos. A tendência é uma regressão linear por hora sobre as leituras, acompanhada da duração e das médias no primeiro e último terços. Reinício identificado do processo invalida a tendência de RSS conjunta. Aquecimento, garbage collection e variações de carga afetam a estimativa. CPU total da TV, RSS exclusivo do processo web, memória do decodificador e latência absoluta da live permanecem indisponíveis.

### Anomalias e cronologia

| Critério padrão | Chave no JSON de configuração |
| --- | --- |
| Intervalo rAF maior que 33,33 ms por sequência de pelo menos 250 ms | `slow_interval_ms`, `raf_episode_ms` |
| Long task de pelo menos 100 ms | `long_task_ms` |
| Fila observada com pelo menos 64 itens | `fifo_items` |
| Limite inferior do bucket P95 de espera da UI de pelo menos 120 ms | `ui_latency_p95_ms` |
| Tendência superior a 20 MiB/h em pelo menos 5 min, com média maior no último terço | `memory_growth_mib_per_hour`, `memory_min_window_ms` |
| Eventos e consultas próximos de uma ocorrência em até 2 s | `nearby_ms` |

Ocorrências de reprodução e conexão usam eventos observados, com fallback de buffering pelo delta do contador. Horários exatos dentro da página são monotônicos no contexto da UI. Para eventos de outros processos, a análise usa o instante de observação no host e conserva a origem, sem subtrair os relógios da TV, do serviço e do Ubuntu como se fossem sincronizados. O relatório mostra métricas antes, durante e depois e identifica as consultas do Inspector próximas. A coincidência temporal orienta investigação. A precisão de eventos do serviço recuperados das leituras depende da cadência.

`summary.json` preserva o último `service.reason`, inclusive `null`, a última razão preenchida, o último estado, a fonte da observação e se houve registro de `stopped`. Mudanças do chat tentam capturar o status conhecido na UI, mesmo entre consultas. Fechar a página pode impedir que o último evento seja recebido. Assim, um fechamento sem motivo observado fica explícito no resultado.

### Impacto esperado e limites

No serviço, há relógio e contadores adicionais nos pontos já visitados pela recepção, admissão, oferta e pelo ACK. Não há timer por mensagem nem histórico de mensagens. Na página, há rajadas limitadas de rAF e reutilização do observador de long tasks. As consultas de diagnóstico continuam em 5 s/30 s por padrão e o tempo gasto pelo Inspector é registrado. Metadados históricos continuam legíveis. A coleta desta fase não consulta a API da Kick.

A avaliação de impacto no hardware exige uma rodada autorizada. Para investigar a influência do Inspector, é possível manter canal, horário e qualidade próximos, observar ciclos com o painel do navegador fechado e aberto e conferir atrasos do Inspector ao redor das anomalias. A influência sobre rAF não foi medida na C3 nesta fase. O coletor imprime a URL do Inspector em uma linha própria, com o IP do servidor `192.168.3.8` e a porta da execução. No PuTTY, selecione a URL para copiá-la e cole-a no navegador enquanto o coletor mantém o túnel aberto.

## Uso manual e arquivos

Em Ubuntu, com Node.js 22 e o app inicialmente fechado:

```bash
node scripts/collect-tv.cjs --device=lgc3 --length=30
```

Antes de pedir que você abra o app, o coletor valida o IPK local contra o código atual e compara os arquivos instalados na TV por SHA-256. Isso detecta builds diferentes com a mesma versão. Gere o IPK com `npm run package` e instale-o pelo fluxo do Developer Mode. Use `--check-package` para rodar somente a verificação. Aguarde a confirmação do pacote e a mensagem para abrir o KickTV antes de escolher o canal.

```bash
node scripts/collect-tv.cjs --device=lgc3 --length=30 --player-interval=5 --chat-interval=30 --raf-window=5
node scripts/collect-tv.cjs --summarize CAMINHO_DA_EXECUCAO --thresholds=limiares.json
```

O modo automático anterior continua disponível quando escolhido explicitamente. Em uma nova coleta, os JSONs individuais são gravados durante a execução e são consolidados em `samples.jsonl` ao final. Os individuais só são retirados após verificar a consolidação. Use `--keep-samples` para preservar também os individuais. `events.jsonl` e `eventos.jsonl` apontam para o mesmo arquivo. A pasta em `coletas/` também mantém `execucao.json`, `summary.json`, `anomalies.json`, `resumo.md` e `graficos.html`. O HTML é local e usa um cursor de tempo compartilhado. `--summarize` aceita os formatos antigos e o consolidado.

### Autorização WebSocket e capturas opcionais

A seção de autorização informa o TTL da última autorização observada, se a renovação era necessária, se houve tentativa, o resultado e o horário estimado de expiração, em UTC. O IPK instrumentado calcula esse horário a partir do recebimento do TTL e o separa da margem usada pelo temporizador local. Em relatórios antigos, campos ausentes aparecem como indisponíveis.

```bash
node scripts/collect-tv.cjs --device=lgc3 --length=60 --screenshots=true
```

A opção salva JPEGs do painel do chat, incluindo cabeçalho e mensagens, em `screenshots/`. A captura via Inspector usa o tamanho original do painel para preservar a leitura do texto. Mantenha o chat aberto no modo teatro. Quando o painel está oculto, o coletor registra a captura como indisponível e tenta novamente nos próximos checkpoints elegíveis. A cadência é de aproximadamente uma vez por minuto e no próximo checkpoint disponível após eventos importantes. Gatilhos próximos são agrupados, com pelo menos 10 s entre capturas extras. `events.jsonl` preserva o arquivo, os gatilhos, a duração e o motivo de falha, quando houver. A galeria de `graficos.html` abre os JPEGs originais e posiciona o cursor no instante de cada captura. Mantenha o HTML junto da pasta `screenshots/`. Consultas de captura são serializadas com as leituras. Erros de captura desativam a opção sem descartar amostras. Se o Inspector deixar de responder, aplica-se a interrupção segura da coleta.

A conexão simultânea pelo navegador foi validada em uma coleta real na LG C3. A última coleta também confirmou que o Web Inspector gera capturas com a tela apagada. Essa rodada usou o recorte anterior, na área do player.

## Sequência de implementação

1. Auditar a coleta anterior, os relógios, os resets e as capacidades observadas.
2. Estender a captura no coletor e os agregados existentes do app e do serviço.
3. Gerar análises, gráficos e arquivos consolidados no Ubuntu.
4. Validar percentis, relógios, resets, filas, eventos, preservação do motivo e compatibilidade usando fixtures e dados históricos.
