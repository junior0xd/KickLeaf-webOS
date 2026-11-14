# Play/Pause no HLS nativo

## Investigação e alcance

`direct-hls` usa `direct-api.js` para descoberta e análise opcional de variantes em `hls-manifest.js`. `native-hls.js` cria um `<video>` em `#native-video-host`, atribui a URL principal ou a variante diretamente a `src` e chama `load()`/`play()`. O mecanismo é **HLS nativo do webOS**, sem hls.js, MSE próprio, gravação ou retransmissão. `native-player.js` pertence ao teste Apple e não ao fluxo Kick. O modo opcional `native-hls` compartilha o controlador; a descoberta não mudou. O iframe oficial continua sem Play/Pause local.

A aplicação não configura live-sync, playbackRate, live-edge seek, tamanho de buffer ou atualização de segmentos. A atualização das playlists e a retenção do buffer ficam com a implementação nativa. Antes desta mudança, `waiting` armava um limite de 25 segundos; erros e término liberavam o vídeo e retornavam à entrada. Não havia reconexão automática nesse controlador. Qualidade e recarga explícitas recriam o vídeo e continuam com esse comportamento.

A [LG documenta suporte a Live Seek](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm). Isso não comprova duração de histórico ou precisão para esta transmissão. O [modelo HTML de mídia](https://html.spec.whatwg.org/multipage/media.html#earliest-possible-position) prevê que o navegador avance a posição quando o início disponível avança. Não há uma opção padronizada que desative esse comportamento no HLS nativo. Não foi observada nem medida nesta tarefa a política interna da C3.

## Comportamento implementado

- O botão existente pausa áudio/vídeo com `pause()` e salva `currentTime` antes da chamada, preservando esse valor mesmo se a TV deslocar a posição enquanto pausada. Pausas externas também são observadas.
- A retomada usa o mesmo elemento e `src`, sem `load()`, nova descoberta ou recarga de manifesto pela aplicação. O motor nativo continua responsável por suas requisições normais de playlist/segmentos.
- São consultados snapshots de todos os intervalos de `seekable` e `buffered`, incluindo lacunas. Buffer que ainda contenha o ponto original tem prioridade sobre uma janela seekable que já avançou. Intervalos vazios ou APIs que falhem são tratados como ausência de informação; não comprovam expiração.
- Se o ponto permanece acessível, a aplicação tenta preservá-lo/restaurá-lo. Um salto observado na retomada recebe no máximo uma correção. A confirmação usa `playing` e, quando necessário, `seeked`/`timeupdate`; tolera diferença de até 0,5 segundo para avanço e precisão do motor. Isso não constitui garantia de busca exata por frame.
- Se uma janela seekable conhecida exclui o ponto e nenhum buffer o contém, tenta uma única recuperação no ponto acessível mais próximo, 0,25 segundo para dentro do intervalo (ou metade do intervalo se menor). Não escolhe o live edge como padrão. Um aviso informa a perda do ponto e permanece por oito segundos após retomar.
- Uma retomada pendente tem 25 segundos. Se o ponto expirar durante a espera, uma única recuperação pode acrescentar até 25 segundos. Falha final pausa, preserva o ponto original para nova tentativa e apresenta instruções. Não há loop de recarga/reconexão. Erros terminais de mídia continuam retornando à entrada com mensagem; não são ocultados ou repetidos.
- Promessas rejeitadas e exceções de `play()` são tratadas. Operações pendentes ignoram acionamentos adicionais; respostas tardias de elementos liberados são descartadas. Um `playing` tardio após timeout volta a pausar.
- O ícone/label vêm de `video.paused` em eventos reais de mídia. `aria-busy` representa inicialização/retomada/buffering. Os SVGs oficiais Phosphor Play e [Pause Fill](https://github.com/phosphor-icons/core/blob/main/assets/fill/pause-fill.svg) são locais, com a licença existente e cor branca, como os demais assets.
- OK revela os controles com foco em Configurações, preservando a entrada existente. Setas/Tab navegam entre os controles habilitados da barra. OK no botão alterna reprodução; Back mantém a hierarquia existente. As teclas de mídia Play (415), Pause (19) e Play/Pause (463/179) também funcionam, sem revelar uma barra persistente; repetição de tecla é ignorada. Volume não foi alterado. Gradiente, dimensões, demais controles e ocultação após cinco segundos foram preservados.

**Suporte condicional:** a retomada do ponto pausado foi implementada enquanto o motor disponibilizar esse ponto. Não se presume manifesto com histórico completo, DVR de cinco minutos ou buffer retido por toda a pausa. Segmentos removidos, URLs expiradas, falta de rede, lacunas, mudança de timeline e limitações do motor podem impedir a retomada. Busca aceita em `currentTime` não prova que os bytes continuarão disponíveis. O tempo-limite contém essas falhas. Mudança de qualidade, recarga, saída do app e troca de canal encerram o contexto de pausa.

Não foi necessária mudança arquitetural para essa tentativa condicional. Caso a C3 insista em sincronizar com o ao vivo ou não retenha/exponha os trechos, uma garantia mais forte exigiria investigar outro mecanismo de reprodução compatível com a TV e uma janela HLS oferecida pelo provedor. Nenhuma dessas alternativas foi introduzida; não há gravação local ou servidor intermediário.

## Validação automatizada

Os testes de navegador usam mídia, eventos, rede e relógio simulados: verificam a lógica da aplicação, sem decodificar uma live nem representar o comportamento interno do webOS. `tests/browser/direct-hls.spec.js` cobre pausas de 5, 30, 120 e 300 segundos com ponto acessível; mudança nativa de posição durante pausa; mesmo elemento/sem `load()`; janela expirada e múltiplos intervalos; buffer anterior à janela; ausência de intervalos; correção de salto nativo; acionamentos rápidos; rejeição de `play()` e nova tentativa; espera de rede e retorno; timeout; expiração durante espera; eventos tardios; teclas de mídia e ícones. Os testes da barra verificam foco, OK/Back/Tab, ocultação, ações desabilitadas, SVGs e gradiente de 720p a 4K.

Validação executada em 11/11/2026: `npm run validate` passou; `npm test` passou com **23 testes unitários e 82 testes de navegador**. `git diff --check` passou. A suíte completa inclui descoberta, inicialização, troca/recarga, erros, limpeza, iframe, estatísticas e empacotamento. Nenhuma live real, televisão ou instalação do IPK foi testada nesta tarefa.

## Roteiro manual — pendente na LG C3/webOS 25

**Nenhum teste desta seção foi executado nesta tarefa.** Usar uma transmissão confirmadamente ao vivo e imagem/áudio reais. Repetir cada caso com sessão nova; anotar canal, versão do app/TV, duração da pausa, posição original e intervalos antes/depois, resultado e aviso. Não compartilhar URL assinada, cookies, tokens ou HAR bruto.

No Inspector, ler apenas a timeline com o trecho abaixo antes de pausar e antes/depois de retomar. Registrar também a primeira imagem/som retomados para detectar saltos. `duration` infinito é normal em live e não prova DVR.

```js
var v = document.querySelector('#native-video-host video');
function intervals(r) {
  return Array.from({ length: r.length }, function (_, i) { return [r.start(i), r.end(i)]; });
}
({ currentTime: v.currentTime, paused: v.paused, seeking: v.seeking,
   readyState: v.readyState, networkState: v.networkState, duration: v.duration,
   seekable: intervals(v.seekable), buffered: intervals(v.buffered) });
```

| Caso | Procedimento e resultado esperado |
| --- | --- |
| Pausa de 5 segundos | OK, seta até Pause, OK. Confirmar imagem parada/áudio silencioso. Aguardar 5s, revelar controles e Play. Se o ponto ainda existir, continuar dali sem salto ao vivo. |
| Pausa de 30 segundos | Repetir com 30s; comparar posição e intervalos, sem assumir a mesma janela do caso anterior. |
| Pausa de 2 minutos | Repetir com 120s; distinguir ponto preservado em buffer, disponível por seekable ou expirado. |
| Pausa de 5 minutos | Repetir com 300s; não considerar expiração automática só pelo tempo decorrido. |
| Acionamentos rápidos | Repetir OK e segurar a tecla no botão, usar teclas de mídia, inclusive durante carregamento. Sem plays sobrepostos, reinicialização ou foco perdido; ícone segue `paused`. |
| Rede temporária | Pausar, interromper rede, tentar Play, restaurar em menos de 25s. Se houver recuperação nativa e ponto acessível, retomar dali. Repetir sem restaurar: após até 50s, deve haver falha limitada, nunca recarga infinita. Erro terminal pode retornar à entrada com mensagem. |
| Posição disponível | Registrar o ponto salvo e comprovar que pertence a seekable ou buffered na retomada. Conferir conteúdo e posição retomados, fonte/elemento preservados. Registrar qualquer correção/salto do motor. |
| Posição expirada | Aguardar até o ponto desaparecer tanto de seekable quanto de buffered (pode levar mais de 5min). Play deve tentar trecho acessível mais próximo com aviso. Se TV/CDN recusarem, deve falhar com limite e recuperação manual disponível. |
| Regressões | Qualidade/recarga/troca de canal, Back até entrada, retorno ao iframe e saída do app devem liberar vídeo/áudio e invalidar operações pendentes. Conferir foco e controles ocultos, sem gradiente persistente. |

Se um caso não puder ser reproduzido (por exemplo, a live nunca expõe histórico ou mantém buffer por mais tempo), registrar como não verificado e descrever os intervalos observados.
