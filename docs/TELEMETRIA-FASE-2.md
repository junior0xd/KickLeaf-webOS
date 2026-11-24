# Telemetria do KickLeaf na LG C3

Referência funcional: v0.2.9. O [coletor](../scripts/collect-tv.cjs) observa o app e o serviço via Web Inspector. Por padrão, mede o player a cada 5 s e lê diagnósticos detalhados a cada 30 s. O monitor da página também registra eventos e agrega janelas opcionais de rAF. Veja [como iniciar a coleta e verificar o pacote](TESTES-DE-CHAT-NA-TV.md).

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

Para avaliar o impacto do Inspector, compare coletas com carga e qualidade semelhantes, com o painel do navegador fechado e aberto. A influência sobre rAF na LG C3 não foi quantificada nessa fase. A URL do Inspector é específica do ambiente local.

## Arquivos e reprocessamento

Em uma nova coleta, os JSONs individuais são gravados durante a execução e são consolidados em `samples.jsonl` ao final. Os individuais só são retirados após verificar a consolidação. Use `--keep-samples` para preservar também os individuais. `events.jsonl` e `eventos.jsonl` apontam para o mesmo arquivo. A pasta em `coletas/` também mantém `execucao.json`, `summary.json`, `anomalies.json`, `resumo.md` e `graficos.html`. O HTML é local e usa um cursor de tempo compartilhado. `--summarize` aceita os formatos antigos e o consolidado.

### Autorização WebSocket e capturas opcionais

A seção de autorização informa o TTL da última autorização observada, se a renovação era necessária, se houve tentativa, o resultado e o horário estimado de expiração, em UTC. O IPK instrumentado calcula esse horário a partir do recebimento do TTL e o separa da margem usada pelo temporizador local. Em relatórios antigos, campos ausentes aparecem como indisponíveis.

```bash
node scripts/collect-tv.cjs --device=lgc3 --length=10 --screenshots=true
```

A opção salva JPEGs do painel do chat, incluindo cabeçalho e mensagens, em `screenshots/`. A captura via Inspector usa o tamanho original do painel para preservar a leitura do texto. Mantenha o chat aberto no modo teatro. Quando o painel está oculto, o coletor registra a captura como indisponível e tenta novamente nos próximos checkpoints elegíveis. A cadência é de aproximadamente uma vez por minuto e no próximo checkpoint disponível após eventos importantes. Gatilhos próximos são agrupados, com pelo menos 10 s entre capturas extras. `events.jsonl` preserva o arquivo, os gatilhos, a duração e o motivo de falha, quando houver. A galeria de `graficos.html` abre os JPEGs originais e posiciona o cursor no instante de cada captura. Mantenha o HTML junto da pasta `screenshots/`. Consultas de captura são serializadas com as leituras. Erros de captura desativam a opção sem descartar amostras. Se o Inspector deixar de responder, aplica-se a interrupção segura da coleta.

```bash
node scripts/collect-tv.cjs --summarize CAMINHO_DA_EXECUCAO --thresholds=limiares.json
```

Mantenha coletas brutas, mensagens, identificadores, URLs assinadas e capturas fora do Git. Para publicar uma evidência, registre versão, hash do pacote, duração, cenário e limitações, e revise o conteúdo antes do commit.
