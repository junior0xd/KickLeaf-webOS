# Evolução do player — versão 0.2.0

## Mecanismo preservado e limite da integração

Na modalidade `iframe`, as lives da Kick continuam em um iframe de `https://player.kick.com/<canal>?autoplay=true&muted=false`. `channel.js`, a normalização de canais e o formulário de entrada foram preservados. O elemento `<video>` diretamente acessível em `native-player.js` pertence somente ao diagnóstico Apple HLS; ele não reproduz as lives Kick. As modalidades opcionais usam outro controlador compartilhado, `native-hls.js`: [Native HLS com backend](NATIVE-HLS.md), já validado fisicamente pelo usuário, e [Direct HLS experimental](DIRECT-HLS.md), também validado pelo usuário na C3 com imagem e áudio, troca para 1080p e backend desligado. Os limites de iframe descritos neste documento se referem à modalidade `iframe`, que pode ser selecionada explicitamente. Desde 0.2.1, o modo padrão é Direct HLS.

A [documentação oficial do embed Kick](https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream) fornece URL de incorporação e parâmetros de autoplay, mute e fullscreen. A interface documentada consultada não fornece eventos de mídia, seleção de variantes, lista de resoluções, métricas de buffer ou controle de latência. A mesma origem impede que o app inspecione o vídeo remoto. Não foi adotado protocolo `postMessage` não documentado nem extração de playlists.

| Recurso | Implementação e limite |
| --- | --- |
| Qualidade | O menu informa que é gerenciada pela Kick. Não há lista fictícia de resoluções, seleção manual ou confirmação de modo Auto no app. O comportamento original do embed é preservado. |
| Preferência de qualidade | Não armazenada: não há uma preferência aplicável pela API documentada. Recargas usam a mesma URL oficial, sem acrescentar parâmetros de qualidade. |
| Carregamento inicial | Aviso discreto de abertura, encerrado pelo `load` do iframe ou após seis segundos. Não representa início de vídeo confirmado. |
| Buffering, pausa, resolução efetiva e erros do vídeo remoto | Não observáveis pelo app. A UI própria não transforma ausência de eventos, pausa ou um timeout em buffering. Indicadores internos continuam sob controle da Kick. |
| Recuperação | Limitada a erros observáveis de navegação do iframe; não detecta vídeo congelado, falha de segmento ou erro HTTP oculto pelo navegador. |
| Recarga manual | Disponível pelo controle, inclusive se o vídeo remoto estiver travado; substitui o iframe sem fechar o aplicativo. |
| Offline/canal inexistente | Continuam apresentados pelo player oficial. Não há reconexão baseada em suposto status de canal. |

Uma integração futura com SDK/API oficial que exponha eventos e qualidade permitiria controlar esses recursos sem substituir a reprodução. Outra alternativa dependeria de a Kick fornecer oficialmente uma URL HLS autorizada para um `<video>` próprio. Isso permitiria observar `waiting`, `playing`, `pause`, `error` e variantes reais, mas exigiria resolver autorização, expiração, CORS, codecs e compatibilidade na C3. Introduzir outra biblioteca por si só não resolve essas condições. Não foi executada essa mudança arquitetural.

## Controles de televisão

- **OK:** revela os controles; com o painel focado, outro OK os oculta. As setas selecionam uma ação e OK a executa.
- **Setas:** alternam entre Qualidade e Recarregar transmissão. Dentro do diálogo informativo de qualidade, mantêm foco em Fechar.
- **Voltar:** fecha primeiro o diálogo de qualidade, depois o painel de controles; sem sobreposição aberta, retorna à entrada e remove o player.
- **Recarregar transmissão:** encerra a instância anterior e abre novamente o mesmo canal. A recarga manual inicia um novo orçamento de recuperação, por ser uma ação explícita do usuário.
- **Volume/mute/Home:** não são interceptados pelos controles do player.

O painel desaparece após cinco segundos sem interação, exceto enquanto o diálogo estiver aberto. Foco e eventos de teclado permanecem no documento pai, como na PoC; o iframe continua sem receber cliques ou foco. Fluxos que exijam login, consentimento ou intervenção no player remoto continuam fora dessa integração.

## Recuperação conservadora

Um `error` do iframe agenda até **três recargas automáticas**, com esperas de **2, 4 e 8 segundos**, além da abertura inicial. Eventos duplicados não criam tentativas paralelas. O evento `load` não restaura o orçamento: ele não comprova reprodução saudável. Após esgotar as tentativas, o iframe é removido e a entrada apresenta uma mensagem compreensível.

Os eventos `offline` e `online` do navegador são tratados como indícios de conectividade, sem promessa de alcance à Kick. Uma tentativa pendente aguarda a rede se ela parecer indisponível. Ao voltar a conectividade, a tentativa só é agendada se já houver uma falha observável pendente. Uma live carregada não é reinicializada apenas porque houve um evento de rede: pode haver buffer ou recuperação interna do player. Se o vídeo não retomar internamente, a alternativa disponível é Recarregar transmissão.

Um iframe sem `load` após 25 segundos produz um aviso temporário e log de navegação não confirmada; não aciona recarga automática, porque o timeout não comprova erro de mídia. Os avisos locais desaparecem em até seis segundos. Erros HTTP no frame frequentemente não emitem `error`; por isso, a recuperação automática não cobre todas as falhas internas.

Ao recarregar, os callbacks da instância anterior são desligados antes de removê-la. Há no máximo um iframe ativo. Ao sair, todos os timers locais e listeners de rede são removidos. Retornos tardios verificam a identidade da instância e não alteram a nova sessão. Os handlers dos botões são registrados uma única vez.

## Diagnóstico e latência

Os logs `[KickTV player]` registram abertura, fechamento, recarga manual, erro observável do frame, indícios de rede, agendamento/esgotamento de tentativas e capacidades indisponíveis. `navigation_ms` mede somente o tempo até `load` do iframe, não o tempo até imagem/som ou a latência ponta a ponta. Não há logs próprios de `playing`, buffering ou qualidade efetiva sem evidência. Os logs locais não contêm URL, canal, cookies, credenciais, tokens ou conteúdo de mensagens remotas.

A [LG documenta HLS nativo, HLS versão 7 no webOS 25 e live seek](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm), mas isso não demonstra suporte completo a todas as extensões de baixa latência. Duração dos segmentos, atualização da playlist, CDN, rede e buffer do player influenciam o atraso. Não há acesso ao live edge ou ao buffer do vídeo remoto para medi-los ou ajustá-los.

Os [parâmetros mediaOption da LG](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter) aplicam-se a fontes de um elemento de mídia próprio; não são um controle do iframe da Kick. O bitrate inicial documentado não deve ser confundido com uma configuração de buffer ou de latência. Nenhum ajuste de buffer, salto ao live edge, aceleração de playback ou modo LL-HLS foi aplicado. Reduzir buffer sem testes pode aumentar rebuffering e interrupções; qualquer futura otimização exige medição na TV e comparação de estabilidade.

## OLED

O vídeo permanece em toda a janela, com proporção controlada pelo player oficial. Controles e avisos locais usam fundo escuro, texto de brilho moderado e desaparecem durante a reprodução normal. Não há animação contínua nem indicador local permanente. O diálogo só permanece visível quando aberto pelo usuário. Avisos/banners internos de um canal offline são da Kick e não podem ser administrados pelo app.

Nenhuma proteção da televisão foi desabilitada. Não foram implementados protetor de tela, deslocamento de pixels ou escurecimento automático. Chat, barras laterais, logotipos ou informações persistentes futuros precisam levar em conta esse uso em OLED.

## Verificações e aceite da versão

O aceite da PoC anterior na C3 continua válido como histórico, mas **não é um teste desta versão**. A evolução requer o roteiro abaixo no hardware. Os testes de UI usam iframe simulado, eventos sintéticos e relógio controlado; não equivalem a falha real de rede ou reprodução na TV.

Foram exercitados navegação, precedência de Voltar, expiração dos controles, recargas repetidas, limite/backoff de tentativas mesmo após `load`, saída durante reconexão, espera pela rede, mensagens não documentadas ignoradas, teclas de volume livres, avisos com prazo e ausência de acúmulo de listeners de rede. Esses testes verificam invariantes de recursos; não provam ausência de vazamento em reprodução prolongada.

Resultado local: **10 testes unitários e 19 testes de navegador passaram**. A CLI oficial 3.2.6, no perfil `tv`, gerou o IPK 0.2.0; a auditoria confirmou os dez arquivos de execução e seus bytes contra a origem, sem dependências de desenvolvimento. O [registro da validação](evidence/player-validation.json) inclui o hash do pacote e distingue eventos simulados dos testes reais de embed. Nenhuma tag ou Release foi criada para essa entrega.

Uma observação real do embed em Chromium Linux com o código novo reproduziu `yoda` e `minerva`, com avanço de tempo e retorno à entrada. [Dados de yoda](evidence/embed-browser-yoda.json) e [dados de minerva](evidence/embed-browser-minerva.json). Não houve validação desta versão em uma televisão pelo agente.

## Roteiro real na LG OLED C3 — pendente

1. Instalar o IPK 0.2.0. Confirmar modelo/firmware e repetir a abertura de `yoda` e `minerva` quando online. Verificar vídeo, áudio, tela cheia e que os avisos locais somem. Registrar tempo de abertura observado, sem confundi-lo com o tempo de navegação do log.
2. Abrir Qualidade com OK/setas. Confirmar a informação de gerenciamento pela Kick e a ausência de resoluções inventadas. A troca manual de qualidade não está disponível nessa arquitetura; não marcar esse item como implementado ou testado.
3. Verificar OK para abrir/ocultar, setas para navegar, OK para executar, Voltar para fechar diálogo/painel antes de retornar à entrada e volume/mute da TV sem interferência. Esperar cinco segundos para confirmar o desaparecimento dos controles; o diálogo aberto deve permanecer operável.
4. Interromper a rede temporariamente, observar a reação real do player e restabelecer. Ele pode se recuperar internamente; o app só tenta recarregar automaticamente se recebeu erro observável do iframe. Se não retomar, usar Recarregar transmissão. Registrar mensagens e logs; não classificar uma falha interna como detectada pelo app sem evento correspondente.
5. Executar Recarregar transmissão várias vezes. Confirmar retomada, ausência de áudio duplicado, no máximo um iframe no Inspector e nenhuma instância anterior conectada. Testar também Voltar enquanto uma recuperação estiver pendente.
6. Retornar à entrada, conferir que o áudio cessa, abrir outro canal e repetir. Testar canal offline e inexistente; confirmar que o player oficial continua apresentando os estados originais.
7. Reproduzir continuamente por pelo menos uma hora e realizar vinte ciclos de recarga/retorno. Observar travamentos, crescimento continuado de memória no Inspector, quantidade de frames, logs e comportamento dos controles. Registrar duração, versão e resultado, sem anexar HAR/URLs de mídia com tokens. Verificar as proteções OLED configuradas na própria TV.

Somente após esse roteiro, com evidência de execução no dispositivo, avaliar a evolução como adequada para uso diário. A reprodução prolongada e a recuperação em rede real permanecem pendentes.
