# Consolidação OLED Premium na v0.3.2

O pacote principal `com.kickleaf.client` abre na inicial OLED Premium. O cabeçalho aceita slug ou URL, o histórico registra os canais abertos na sessão e o retorno do player restaura a posição e o foco. A navegação da listagem conserva grupos de cinco, paginação de rede independente, cache, deduplicação e imagens sob demanda.

Na primeira abertura, **Ao vivo** habilita a listagem e salva a escolha para as próximas sessões. O parâmetro `experimentalDiscovery` foi removido do código de abertura. A integração continua experimental, com ativação inicial explícita. A seção 1.4 dos Termos da Kick estabelece restrições a acesso automatizado e a meios de acesso não autorizados. [Descoberta e condições de uso](DESCOBERTA.md) · [Termos da Kick](https://kick.com/terms-of-service)

## Incorporação e limpeza

A comparação do último IPK aprovado, de `dist/osd-idle/`, com os arquivos do aplicativo encontrou correspondência byte a byte antes da consolidação. A comparação com o IPK v0.3.2 confirma que estilos, tokens, ícones, lógica de temporização do OSD, adaptador de listagem, transporte de chat e módulos do pipeline HLS correspondem à base aprovada. As mudanças no serviço se limitam à versão dos metadados npm.

O HLS inicia em Tela cheia. Teatro abre o chat, e a troca de modo mantém o vídeo. A aprovação do OSD superior inclui os gradientes de 60% e 15% da altura, o círculo de foco de 18%, a disposição em três regiões e a ocultação após dois segundos de inatividade nos controles.

O formulário independente e seu tratamento duplicado de teclas foram removidos. O manifesto aponta diretamente para a inicial OLED, cujo cabeçalho e estilos já estão presentes na primeira renderização. O campo do cabeçalho atende ao HLS e ao player oficial. A alternativa por iframe abre e volta da mesma inicial. O modo Completo já estava ausente do pacote aprovado. As menções históricas a esse modo e as evidências dos experimentos foram preservadas. O diagnóstico Apple continua disponível no código de desenvolvimento, fora do IPK principal.

## Validação

- **Automatizada.** Passaram 51 testes unitários, 148 de chat e 95 de navegador. A suíte cobre abertura sem parâmetros, renderização do cabeçalho antes da execução do JavaScript, habilitação e persistência de **Ao vivo**, falhas da listagem, seleção de card, restauração de grupo, reprodução em Tela cheia, alternância com Teatro, OSD e preferência persistida.
- **LG OLED C3, abertura normal.** A tela OLED iniciou com foco em **Início** e zero requisições da listagem antes da habilitação. Uma URL abriu HLS em Tela cheia. Teatro conectou o chat. Voltar a Tela cheia encerrou o chat e preservou o mesmo vídeo. As interações prolongaram o OSD, que ocultou após inatividade e reapareceu na navegação. O botão respeitou a desativação, e a saída restaurou o foco e o histórico.
- **LG OLED C3, listagem.** As setas e OK habilitaram **Ao vivo**. Fechar e abrir o app sem parâmetros carregou cinco cards. Avançar ao segundo grupo reaproveitou a consulta inicial. Selecionar um card iniciou Tela cheia e, na volta, grupo e foco foram restaurados. A preferência de desativação do OSD sobreviveu ao reinício e o botão o reativou.
- **LG OLED C3, falha simulada.** Uma resposta HTTP 503 injetada apenas na segunda página manteve os cinco cards do quarto grupo, preservou a opção de nova tentativa e permitiu abrir um canal por slug. Nenhuma nova tentativa da listagem foi disparada automaticamente nesse percurso.
- **Limites da validação.** Os ensaios na TV foram curtos. Avaliações prolongadas de performance e renovação WebSocket continuam pendentes. Banners e eventos, login e personalização, navegação por categorias, filtros, animação de inicialização e refinamentos visuais futuros continuam fora desta entrega.

## Pacote e repositório

- IPK local `dist/releases/com.kickleaf.client_0.3.2_all.ipk`, versão 0.3.2, com 187 arquivos de execução auditados.
- SHA-256 `cd8a75ed8a344f1f87382acf0645c4861d59f347bbfcf2268ac5aa6bdc39ba71`.
- A consolidação parte do commit `b7b8504` da v0.3.1. Os relatórios e as evidências anteriores permanecem no workspace.
