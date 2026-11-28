# Chat do KickLeaf

O chat público, somente leitura, abre ao selecionar **Teatro** na barra do player HLS. Ele ocupa 25% da tela. Entrar em **Tela cheia**, trocar de canal ou sair encerra a sessão e drena as mensagens já admitidas. Voltar a **Teatro** abre uma sessão de chat.

## Arquitetura e renovação

A página chama o serviço JavaScript local `com.kickleaf.client.service` pelo barramento Luna. O serviço empacota `ws` 8.22.2 e usa `webos-service` do runtime da TV. Ele negocia uma credencial de convidado, abre um WebSocket Centrifugo, assina a sala do canal e normaliza as publicações. A reprodução de vídeo tem seu próprio ciclo de vida. O chat funciona sem proxy ou backend remoto do KickLeaf.

Desde v0.2.8, quando o servidor informa TTL, o protocolo calcula a expiração e mantém um prazo interno com margem de 5 s. Em autorizações longas, o serviço tenta renovar cerca de 60 s antes da expiração. Solicita outra credencial de convidado para o mesmo ID de cliente e envia `refresh` no WebSocket já aberto. O novo prazo só passa a valer após resposta válida. Erro temporário pode ter uma retentativa se houver tempo, respeitando `Retry-After` quando aplicável. Recusa definitiva ou falta de tempo leva a fechamento e drenagem. A renovação preserva a assinatura e o contexto da FIFO.

Os eventos `lease_refresh_started`, `lease_refresh_retry`, `lease_refresh_confirmed` e `lease_refresh_failed` permitem distinguir tentativa, confirmação e falha. Os testes automatizados simulam o servidor e as credenciais. A confirmação de uma renovação real exige observar o evento correspondente e o novo TTL em coleta identificada por hash do pacote. Veja [telemetria](TELEMETRIA-FASE-2.md).

## Entrega FIFO e ACK

1. O serviço admite texto, Unicode e emotes na mesma FIFO. Cada evento mantém seu ID original e recebe uma sequência interna de entrega. A camada Luna oferece lotes a cada 100 ms, conforme o crédito da interface, e retém as mensagens até a confirmação.
2. A UI agenda o trabalho sob demanda em `requestAnimationFrame`, com fallback de 50 ms. Cada lote prepara até 64 linhas com orçamento de 8 ms. A UI insere em ordem, poda as linhas antigas após a inserção e mantém até 60 linhas visíveis.
3. O ACK cumulativo confirma **inserção no DOM**. Identidade da sessão, contexto e ticket restringem o reconhecimento, e o maior número confirmado evita reinserção em retransmissões. Esse ACK é independente das respostas e do heartbeat de Centrifugo. Decodificação de imagens e pintura física ocorrem fora dessa confirmação.

Serviço e interface limitam a fila a 512 itens e 1 MiB de payload, com teto individual de 8 KiB. A FIFO do serviço também limita a sequência a 60.000. A v0.2.7 retirou o prazo fixo de sessão e antigos tetos cumulativos do transporte. Permanecem limites de recursos e de entrega, incluindo a guarda de RSS do serviço acima de 128 MiB.

Um lote sem ACK pode ser retransmitido após 2 s, até três vezes. Uma recusa de capacidade fecha a admissão e encerra a fonte, mantendo o que foi admitido para drenagem. Cancelamento do consumidor Luna também encerra a fonte. No mesmo contexto, uma tentativa de recuperação local pode drenar sem abrir novo WebSocket. O prazo de drenagem é de até 60 s no relógio monotônico, sujeito à proteção de pendência com mais de 30 s e a outros abortos. O saldo que não puder ser entregue é contado como descarte no encerramento.

## Renderização CSS e emotes

Texto remoto entra como texto inerte. Nomes e mensagens têm limites de 80 e 2.000 unidades UTF-16, com remoção de high surrogate isolado no fim do corte. O campo auxiliar registra até 24 ocorrências de emote. O renderizador analisa todo o texto já limitado, independentemente desse campo.

Emotes usam caixas de 28 × 28 px e uma regra CSS de fundo compartilhada por ID decimal. As imagens originais carregam sob demanda, com até dois carregamentos simultâneos, prazo de 15 s e dimensões naturais até 1024 × 1024. Os arquivos animados continuam podendo animar. Enquanto a imagem carrega ou se falhar, a caixa exibe o nome do emote. Uma nova ocorrência após 60 s pode voltar a tentar um ID que falhou. O registro mantém até 192 IDs e remove entradas elegíveis sem referências para abrir espaço. Podar linhas libera referências. Encerrar o chat limpa o registro e cancela trabalho pendente. Cache HTTP e memória decodificada pertencem ao navegador.

Os distintivos usam caixas CSS de 20 × 20 px, regras compartilhadas e fallback local. A seleção, a procedência e a validação de imagens remotas estão em [distintivos](BADGE-ASSETS.md).

## Verificação

Use o [roteiro de coleta na LG C3](TESTES-DE-CHAT-NA-TV.md) para conferir fluxo e encerramento e o [changelog](../CHANGELOG.md) para os resultados por versão. Os [relatórios de laboratório](../experiments/reports/README.md) preservam escopo e limites próprios.
