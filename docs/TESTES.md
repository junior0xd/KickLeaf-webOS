# Testes e validação do KickLeaf

Referência funcional: v0.2.9. Registre commit, versão, dispositivo, firmware, modo de reprodução e cenários executados. Identifique separadamente resultados simulados, observações de mídia pública e testes físicos.

## Verificações locais

Na raiz do projeto, com Node.js 22, npm, Python 3 e `ar` do pacote Ubuntu `binutils`:

```bash
npm ci
npm ci --prefix service --omit=dev --ignore-scripts --no-audit --no-fund
npx --no-install playwright install chromium
npm run validate -- --tag v0.2.9
npm test
npm run package
npm run package:info
```

Use `npm run validate` sem o argumento de tag para uma versão em desenvolvimento. `npm test` executa unitários, chat e Playwright. A suíte cobre contratos das APIs e do barramento local, ordem e ACK da FIFO, renovação simulada, decodificação de imagens, controles, métricas e limpeza. Testes de navegador simulam a mídia Kick e suas respostas de rede quando necessário. O [CI](CI.md) repete esses passos e guarda o IPK auditado.

Para testar o backend opcional, instale `backend/requirements-dev.txt` em um virtualenv na raiz do projeto e execute `python -m pytest backend/tests` com o ambiente ativo. Os testes Python cobrem autenticação, CORS, formatos de resposta, validação e falhas de descoberta. Consulte [configuração do backend](PLAYER.md#native-hls-com-backend-local).

Os scripts `scripts/probe-embed.cjs`, `scripts/probe-direct-hls.cjs` e `scripts/probe-video-statistics.cjs` são diagnósticos de desenvolvimento. Podem fazer requisições reais ou gerar arquivos em `docs/evidence/` e `.build/`. Execute-os só para investigar o cenário correspondente e revise os arquivos gerados antes de versionar. O smoke test de estatísticas usa mídia Apple real com descoberta simulada e não valida a pilha da LG.

## Instalar e testar na LG C3

Use o Developer Mode com a TV pareada na CLI como `lgc3`. Consulte o [pareamento no README](../README.md#conectar-instalar-e-executar-na-lg-c3). A partir do checkout a testar, empacote e instale o caminho informado pelo empacotador. Os comandos abaixo derivam ID e versão do manifesto:

```bash
npm run package
APP_ID=$(node -p "require('./app/appinfo.json').id")
APP_VERSION=$(node -p "require('./app/appinfo.json').version")
npx ares-install --device lgc3 "dist/releases/${APP_ID}_${APP_VERSION}_all.ipk"
npx ares-launch --device lgc3 "$APP_ID"
```

O IPK instala `com.kickleaf.client` ao lado de uma instalação existente de `com.kicktv.alpha`. Canal, qualidade e layout são mantidos em memória durante a sessão, e o serviço guarda o estado do chat em memória. A preferência de exibir as informações da transmissão é persistida em `localStorage` no contexto do aplicativo. Os arquivos de configuração do backend opcional ficam no computador que hospeda o backend e continuam usando as variáveis `KICKTV_*`.

Feche o app antes de reabrir com parâmetros diferentes. O diagnóstico Apple fica fora do IPK principal. Para desenvolvimento, sirva a pasta `app/` localmente, abra `hls-test.html` e confirme **Iniciar teste HLS**. Para o player oficial, use `--params '{"mode":"iframe"}'` ou a ação durante HLS. O [guia do player](PLAYER.md#native-hls-com-backend-local) descreve os parâmetros do backend local. Para observar logs use `npx ares-inspect --device lgc3 --app "$APP_ID"`.

| Roteiro físico | O que registrar |
| --- | --- |
| Diagnóstico Apple | Imagem, áudio, avanço e liberação ao voltar. A amostra isola a reprodução HLS sem acesso à Kick. |
| Direct HLS | Teclado e entrada, imagem e áudio de canal ao vivo, estado de canal offline, Auto e uma variante disponível. Registre a qualidade selecionada e a resolução efetiva. |
| Navegação e layout | Setas, OK, Voltar, foco nas opções visíveis e ocultação após inatividade. Iniciar em Tela cheia e alternar com Teatro preservando o vídeo. Conferir o OSD de dois segundos, renovação durante as interações na barra, ausência de sobreposição com os botões, desativação e persistência após reiniciar. |
| Pausa e recuperação | Retomar em pausa breve, testar ponto expirado se a janela permitir, observar avisos e reação a falha. Anotar quando o dispositivo não expõe uma janela confiável. |
| Estatísticas | Ativar/desativar, conferir valores indisponíveis, observar atualização e reset em troca de qualidade. Observar buffering separadamente da partida, pausa e busca. |
| Chat e limpeza | Verificar texto, emotes e distintivos, fila e ACK, preservação do chat na recarga bem-sucedida da mesma live e encerramento em troca de canal, Voltar e saída. Em sessão longa, confirmar se houve renovação e novo TTL. Use o [guia de coleta](TESTES-DE-CHAT-NA-TV.md). |
| Alternativas e rede | Comparar iframe, Direct HLS e backend local conforme o cenário. Registrar interrupções de rede, retorno à entrada e ausência de áudio residual. O evento de navegação do iframe não confirma reprodução. |

Registre duração, momento, resultado e motivo de encerramento. Publique somente evidências revisadas, sem segredos, URLs assinadas, mensagens brutas ou capturas identificáveis.

## Avaliação da primeira versão do player OLED Premium

No IPK local de avaliação sobre a v0.3.1, a LG OLED55C3PSA com firmware 33.31.68 iniciou uma live em Teatro e conectou o chat. O Inspector registrou 2,02 s entre a apresentação automática do OSD e o início da ocultação. Abrir a barra reapresentou as informações acima dos botões. Uma atualização de audiência com o OSD oculto manteve esse estado. A alternância Teatro → Tela cheia → Teatro preservou a instância do vídeo e o tempo de reprodução. Ao voltar, o app liberou o vídeo e restaurou o grupo e o card selecionados.

O teste de persistência desabilitou o OSD pelo controle de informações, fechou e abriu novamente o aplicativo. A preferência permaneceu desabilitada na partida e ao abrir a barra. Em seguida o controle reativou as informações. Nenhuma consulta adicional de metadados do canal foi observada ao usar o OSD.

Com vídeo simulado no Chromium, o OSD foi comparado sobre fundo branco e preto. O contraste sRGB teórico no trecho menos opaco do gradiente foi de 8,8:1 sobre branco e 17:1 sobre preto. A avaliação presencial da legibilidade em cenas reais e da percepção de brilho na OLED permanece pendente.

## Evidências históricas

- **PoC v0.1.0, LG C3.** O usuário confirmou instalação, teclado, tela cheia, reprodução online, aviso offline e retorno à entrada. Foram usados `yoda`, `xqc`, `minerva` e o canal inexistente `lgiptv`, que exibiu um aviso de configuração do embed. URL completa e som isolado não constam desse relato. [Investigação](INVESTIGACAO.md)
- **PoC v0.1.0, Linux.** FFprobe identificou H.264 e AAC na amostra Apple e FFmpeg decodificou mídia. No Chromium, o embed de `sxb` avançou aproximadamente três segundos em uma observação. Oito testes de interface passaram com embed simulado. [Vídeo Apple](evidence/apple-ffprobe.json) · [Áudio Apple](evidence/apple-audio-ffprobe.json) · [Decodificação](evidence/hls-decode.json) · [Embed](evidence/embed-browser-sxb.json)
- **Direct HLS e Native HLS, LG C3.** Na versão histórica de Direct HLS, `yetz` e `baianotv` reproduziram imagem e som, com seleção de 1080p e backend desligado. Também foi relatada reprodução básica via backend HTTPS em Native HLS. As evidências são pontuais. [Direct HLS na TV](evidence/direct-hls-tv-user-validation.json) · [Native HLS](evidence/native-hls-validation.json)

Veja o [changelog](../CHANGELOG.md) para resultados por versão. Os arquivos em [evidências](evidence/) contêm registros históricos e os [relatórios R001–R040](../experiments/reports/README.md) mantêm o contexto experimental.
