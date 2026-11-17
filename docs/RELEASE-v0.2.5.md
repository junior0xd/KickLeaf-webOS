# KickTV v0.2.5 — integração da FIFO/ACK e emotes

O chat real usa uma FIFO limitada, com crédito, confirmação cumulativa de inserção no DOM, retransmissão e supressão de duplicatas. Mensagens normalizadas preservam seus IDs externos; a entrega local usa sequência interna própria. O ACK local não substitui o ACK de protocolo Centrifugo, que permanece no código original com sua correlação e ordenação síncrona.

A UI usa um timer de 50 ms para todo o conteúdo e insere até 32 mensagens por disparo. Esse tamanho é uma escolha inicial de lote validada funcionalmente, não uma capacidade máxima ou um orçamento de CPU demonstrado na TV. Serviço e interface têm limites de 512 itens e 1 MiB de payload, com limite individual de 8 KiB; o serviço oferece lotes a cada 100 ms conforme o crédito. A primeira recusa fecha a admissão da sessão. Não há corte silencioso para as últimas cinco mensagens nem substituição das pendências mais antigas.

O serviço retém as admitidas até confirmação. Fechamento, troca de canal e ocultação encerram a fonte e tentam drenar antes de limpar. Falha do consumidor Luna permite uma recuperação local no mesmo contexto, limitada a uma tentativa, sem abrir outro WSS. Cancelamentos tardios do handle anterior não cancelam seu substituto. Prazo de drenagem usa relógio monotônico, até 60 s, sujeito à proteção de idade de pendência >30 s; expiração/risco contabiliza descartes e erro de encerramento. Não se promete entrega de mensagens que não foram admitidas ou cujas pendências precisaram ser abortadas.

Os emotes usam imagens nativas de 28×28, parser de tokens seguro e resolvedor por ID decimal na CDN de emotes. Há registro limitado a 192 IDs, proteção das referências ativas, expulsão dos inativos por recência, fallback textual e timeout de 15 s. Remover linhas/encerrar chat libera handlers, timers, fontes e referências. Cache HTTP e memória decodificada continuam sob controle do navegador; a referência histórica de bytes não é teto de RAM. Não há cache binário próprio, proxy ou nova dependência.

O truncamento mantém os limites de 80/2.000 unidades UTF-16 para nomes/textos e remove high surrogate terminal isolado, inclusive após limpeza de controles. Texto remoto permanece inerte. As badges, contraste, fontes, modos de visualização e player existentes foram preservados. O player, protocolo Centrifugo, transporte e cliente HTTP não foram alterados nesta versão.

## Verificações realizadas

- **24 testes unitários, 130 de chat e 82 de navegador: 236 aprovados**, sem falhas ou skips.
- Os testes existentes de protocolo continuam cobrindo ACK de assinatura seguido por publicação no mesmo frame, ACK de connect seguido por ping, correlação, recusas e limpeza. Os novos testes cobrem a camada DOM separadamente.
- Testes da FIFO cobrem conteúdo misturado, ordem, crédito, limites de itens/bytes/envelope JSON, ACK inválido/antigo, ACK perdido, retransmissão sem nova inserção, contexto/ticket, falha de append/respond, prazo de drenagem e contabilidade de aborto.
- A integração exercita Protocol/normalização/Session/Controller/service/Consumers/serialização Luna e UI. Um teste liga as rotas reais do serviço à interface pelo barramento sintético e confirma 150 mensagens por ACK do DOM.
- Navegador com mídia/rede simuladas: texto/Unicode/imagens misturados, referências após poda/fechamento, recuperação local, encerramento durante rajada, foco, qualidade, troca de canal e identidade do vídeo.
- Testes de emotes: parser, mais de 24 ocorrências no texto, formatos inválidos de token, carga/erro/timeout/fallback, saturação, referências e limpeza. Testes UTF-16 cobrem pares completos e fronteiras de truncamento.
- `npm run validate -- --tag v0.2.5` e `npm run package` aprovados. A auditoria confere identidade, versão, caminhos e bytes do app/serviço/dependência, sem scripts extras no controle do IPK.

O pacote gerado tem **47 arquivos de execução do app**, serviço e dependência fixada no lockfile, com versão de runtime e manifestos sincronizados em 0.2.5.

- Artefato local: `dist/releases/com.kicktv.poc_0.2.5_all.ipk`.
- SHA-256: **e50e23d37844fbe19f47981ff6e3cc112f7c3a5507d619448ca366b8de91574c**.

## Relatórios e privacidade

[40 relatórios históricos sanitizados](../experiments/reports/README.md) foram preservados no Git. Foram removidos endereços, canais/usuários identificados, caminhos locais, exemplos de dados/código e capturas. Os relatórios conservam resultados negativos e limitações, com SHA-256 dos originais para proveniência. Arquivos brutos, fontes dos laboratórios, configurações, capturas, logs e IPKs históricos não entram no commit. Permanecem no workspace. O código e os testes selecionados para esta integração ficam nos diretórios normais da aplicação.

## Alcance

Não houve instalação ou sessão nova na TV nesta entrega. As verificações locais usam rede e mídia simuladas; não certificam comportamento em tráfego real prolongado, capacidade universal com emotes, estabilidade de memória por horas ou pintura física. Os resultados anteriores da LG C3 são evidência histórica da arquitetura experimental, com as limitações preservadas, e não foram reclassificados como testes desta versão. A falha formal histórica de S1 por inclinação de RSS continua registrada.

Os limites de segurança do coletor experimental, incluindo RSS web absoluto de 192 MiB e a política de crescimento rápido, pertencem ao host e não foram transformados silenciosamente em uma proteção interna do aplicativo. Os limites existentes do cliente real, incluindo janela de sessão, orçamento de entrada e memória Node, foram preservados. O mecanismo da FIFO acrescenta seus próprios limites de pendências e encerramento.

O commit e a tag v0.2.5 serão enviados ao remoto por solicitação do usuário. A publicação do GitHub Actions será conferida manualmente pelo usuário; esta tarefa não consulta o estado de Actions ou Releases.
