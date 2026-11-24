# Changelog do KickLeaf para webOS

Os resultados abaixo pertencem às versões, aos dispositivos e aos cenários descritos. Os [relatórios experimentais sanitizados](experiments/reports/README.md) guardam os hashes dos originais e incluem resultados negativos. Os pacotes experimentais 0.3.x citados nesses relatórios têm identidades próprias. Os documentos completos anteriores à consolidação permanecem disponíveis na árvore da tag `v0.2.8`.

## v0.2.9 (em desenvolvimento)

- KickTV Alpha passa a se chamar **KickLeaf**, com novo ícone. O IPK usa `com.kickleaf.client` e inclui o serviço Luna `com.kickleaf.client.service`. O webOS instala o KickLeaf como um aplicativo separado.

## v0.2.8

- Renderização CSS compartilhada para emotes animados e distintivos locais e remotos. Emotes carregam sob demanda. A UI passou a agendar inserções sob demanda via rAF, com fallback e limites por lote. O ACK cumulativo continua associado à inserção no DOM. [Chat](docs/CHAT.md) · [Distintivos](docs/BADGE-ASSETS.md)
- Renovação da autorização no WebSocket ativo. O serviço solicita outra credencial de convidado para o mesmo cliente e aplica o novo TTL após confirmação de `refresh`. A cobertura automatizada simula a resposta do servidor. [Renovação](docs/CHAT.md#arquitetura-e-renovação)
- Telemetria híbrida com verificação por hash do IPK e da instalação, coleta manual ou automática, relatório de anomalias e captura opcional do chat. [Telemetria](docs/TELEMETRIA-FASE-2.md)

## v0.2.7

- Remoção do prazo fixo de sessão e de antigos tetos cumulativos do transporte, incluindo mensagens WebSocket, bytes recebidos, publicações, requisições HTTP e comandos. Permaneceram as proteções de memória e os limites da FIFO. A autorização ainda podia expirar sem renovação no socket ativo.

## v0.2.6

- Nome **KickTV Alpha**. Mudança de identidade de `com.kicktv.poc` para `com.kicktv.alpha`, com serviço `com.kicktv.alpha.service` e sem migração automática de preferências. A entrada passou a oferecer somente **Assistir**. O player oficial continuou no menu durante HLS.
- Distintivos locais oficiais e derivados, Founder sólido, seleção de Sub Gifter por quantidade, tipos adicionais e níveis v2 locais de 1 a 99. Os demais distintivos v2 mantiveram o fluxo CDN. [Associações e procedência](docs/BADGE-ASSETS.md) · [Hashes dos SVGs](docs/BADGE-ASSETS.json)
- Validação registrada: 24 testes unitários, 134 de chat e 83 de navegador, total de 241 aprovados. O navegador decodificou os 139 SVGs alcançáveis pelo seletor em caixas de 20 × 20. Validação de tag, empacotamento e auditoria do IPK aprovados. Mídia e rede simuladas, sem instalação nova na TV.
- Artefato histórico `com.kicktv.alpha_0.2.6_all.ipk`, 136.506 bytes, 177 arquivos de execução. SHA-256 `b22a96d717f2e4376b762146ee6ad61233f7a7df9bee7df2be3bde833b6b8969`.

## v0.2.5

- Integração da FIFO com crédito, ACK cumulativo no DOM, retransmissão, supressão de duplicatas e drenagem. A UI dessa versão usava um timer de 50 ms e lotes de até 32. O transporte Centrifugo manteve seu próprio protocolo.
- Emotes de 28 × 28 via elementos de imagem nativos e registro limitado. Normalização com truncamento seguro de UTF-16, inclusive em fronteiras de pares substitutos.
- Validação registrada: 24 testes unitários, 130 de chat e 82 de navegador, total de 236 aprovados. Incluiu 150 mensagens confirmadas via barramento sintético, testes de pressão/limpeza, validação de tag e auditoria do IPK. Sem nova instalação ou coleta prolongada na LG C3 para essa integração.
- Artefato histórico `com.kicktv.poc_0.2.5_all.ipk`, com 47 arquivos de execução do app, além do serviço e de sua dependência. SHA-256 `e50e23d37844fbe19f47981ff6e3cc112f7c3a5507d619448ca366b8de91574c`. O limite experimental de 192 MiB de RSS web e a política de crescimento rápido pertenciam ao coletor do laboratório. O resultado negativo da série S1 está preservado no [arquivo experimental](experiments/reports/README.md).

## v0.2.4

- Pausa e retomada no vídeo nativo com recuperação limitada pela janela acessível.
- Chat de convidado somente leitura, layout teatro e distintivos CDN com limites de corpo e cache. A [validação sanitizada](docs/evidence/cdn-badges-v024/summary.json) registra 1.200,187 s na LG C3, HLS em 1080p, um WebSocket, zero reconexões, 4.601 mensagens normalizadas, 3.975 recebidas/apresentadas e 626 descartadas pela fila do serviço daquela versão, sem descarte adicional na UI.
- 61 imagens distintas aceitas/exibidas, zero rejeições e 91.949 bytes recebidos. A troca Auto → 1080p manteve o chat conectado. O teste cobriu aquele canal e período. As capturas do Inspector mostram a camada web e não documentam o plano nativo de vídeo. [Imagens](docs/evidence/cdn-badges-v024/images.json) · [Encerramento do serviço](docs/evidence/cdn-badges-v024/stopped-service.json) · [Preservação da TV](docs/evidence/cdn-badges-v024/preservation.json)

## v0.2.3

- Barra compacta com ícones locais Phosphor de 37 px, gradiente inferior e painel de configurações. A TV assume o controle de volume. Aparência aprovada pelo usuário na LG C3. Foram registrados 23 testes unitários e 69 de navegador aprovados, além da validação e do empacotamento.

## v0.2.2

- Painel opcional de estatísticas HLS, resolução efetiva, quadros, FPS estimados, buffer, estado e metadados declarados da variante. O nome **Distância da borda acessível** descreve a medida relativa à timeline.
- O usuário confirmou ter testado o IPK experimental na LG C3. O registro local desse precursor aponta 23 testes unitários e 63 de navegador aprovados. O smoke test Apple no Chromium Linux usou mídia real e resposta de descoberta simulada. [Validação do precursor](docs/evidence/video-statistics-validation.json) · [Smoke test](docs/evidence/video-statistics-public-hls.json)

## v0.2.1

- Direct HLS passou a ser o padrão. Native HLS com backend local e o iframe permaneceram disponíveis por seleção explícita.
- O usuário relatou imagem e som com Direct HLS, seleção de 1080p e backend desligado na LG C3. Também houve validação básica de imagem e áudio via Native HLS com backend HTTPS. [Direct HLS na TV](docs/evidence/direct-hls-tv-user-validation.json) · [Native HLS](docs/evidence/native-hls-validation.json)

## v0.2.0 — marco de desenvolvimento

- Evolução dos controles do iframe, menu de qualidade informativo, recarga manual e recuperação limitada para falhas observáveis pelo pai. As verificações locais registraram 10 testes unitários e 19 de navegador aprovados. [Validação do player](docs/evidence/player-validation.json)

## v0.1.0

- PoC instalável para LG webOS com embed oficial e diagnóstico HLS Apple. O usuário confirmou instalação, teclado, reprodução de canais online, tela cheia, apresentação do estado offline e retorno à entrada na LG OLED C3. O embed exibiu aviso de configuração para um canal inexistente. URL completa, áudio isolado e estabilidade prolongada ficaram fora do relato. [Investigação da PoC](docs/INVESTIGACAO.md) · [Teste do embed no desktop](docs/evidence/embed-browser-sxb.json)
- A preparação inicial do CI registrou 10 testes unitários, 8 de navegador e aprovação no actionlint. A auditoria rejeitou IPKs com arquivo extra, ausente, alterado ou link. A execução inicial foi local. [Auditoria do pacote](docs/evidence/package-audit.json) · [Fluxo atual de CI](docs/CI.md)
