# Barra do player — etapa 1

A barra usa HTML/CSS e SVGs locais Phosphor, sem dependências de execução.
Os grupos de reprodução e visualização ficam nas extremidades de um contêiner
fluido, com margens de 4%. Os ícones têm 37px (cerca de 33% maiores) e os botões, áreas de foco de 72px.
O gradiente inferior existente continua atrás do conteúdo, com os mesmos quatro
pontos de opacidade e altura base de 220px. Seu pseudo-elemento pertence aos
controles, não recebe eventos e desaparece junto com o atributo `hidden`.
A ocultação existente é imediata; esta etapa não acrescenta animações.

## Ações e foco

- OK ou uma seta revela a barra e foca Configurações.
- Play/Pause, Teatro e Tela cheia são reservas visuais desabilitadas,
  fora da navegação. Não há novas ações de mídia nem uso da Fullscreen API.
  O controle de volume foi removido da barra: as teclas de volume/mudo da TV continuam sem interceptação.
- Configurações abre um painel transitório simples. Os mesmos botões, IDs e
  listeners existentes oferecem qualidade, recarga, player oficial e estatísticas
  no player nativo. Não há submenus novos, switches ou radios.
- Setas percorrem as ações disponíveis em ordem; Tab e Shift+Tab seguem o mesmo
  conjunto, sem alcançar elementos ocultos ou reservas desabilitadas.
- Voltar fecha a seleção de qualidade e restaura o foco em Qualidade; outro
  Voltar fecha o painel e foca Configurações; depois oculta a barra e retorna
  o foco ao documento. O próximo Voltar mantém a saída existente para a entrada.
- O prazo de cinco segundos pausa enquanto um painel está aberto e recomeça
  ao retornar à barra. Ações de recarga/troca mantêm a liberação de mídia existente.
- Estatísticas fecha o painel de ações e devolve o foco a Configurações. O painel
  de estatísticas mantém seu comportamento independente e pode ser desligado
  pela mesma ação, sem recriar o vídeo.

O iframe recebe a mesma apresentação compacta e mantém suas duas ações atuais:
informação sobre qualidade gerenciada pela Kick e recarga. Seu indicador diz
“KICK”, pois não há API documentada para confirmar o estado ao vivo do embed.
No player nativo, “AO VIVO” aparece quando os metadados identificam uma live;
fica oculto durante a descoberta de um novo canal.

## SVGs Phosphor

Origem: <https://github.com/phosphor-icons/core>

Commit: `2b75f3ad12b420c9504ef05df8d2564a28f8500e`.

| Arquivo local em `app/` | Caminho oficial |
| --- | --- |
| `phosphor-play-fill.svg` | `assets/fill/play-fill.svg` |
| `phosphor-broadcast-fill.svg` | `assets/fill/broadcast-fill.svg` |
| `phosphor-rectangle.svg` | `assets/regular/rectangle.svg` |
| `phosphor-gear-six.svg` | `assets/regular/gear-six.svg` |
| `phosphor-corners-out.svg` | `assets/regular/corners-out.svg` |

Os SVGs mantêm os paths oficiais. A única adaptação é `fill="currentColor"`
para `fill="#ffffff"`, pois imagens externas não herdam a cor do documento.
A licença MIT original é distribuída em `app/phosphor-license.txt`.
Os cinco SVGs e a licença estão na lista explícita de `packaging.json`.
O validador aceita essas extensões mantendo a restrição a arquivos sem diretórios.

## Validação

Executar `npm run validate`, `npm test` e `npm run package`.
Os testes existentes usam o novo acesso pelo painel para verificar qualidade,
recarga, fallback e estatísticas. `tests/browser/controls.spec.js` verifica os
estados de foco, Voltar LG (461), pausa/retomada do prazo de ocultação, ações
desabilitadas, carregamento local dos ícones e layout em 720p, 1080p e 2160p.
Capturas com mídia simulada clara/escura ficam em `.build/controls-*.png`.
O empacotamento confere os bytes dos ícones e da licença dentro do IPK.

No navegador, a mídia é simulada: esses testes não comprovam codecs, reprodução
HLS real nem comportamento do controle físico. Conferir na LG C3/webOS 25 a
legibilidade à distância, o destaque de foco, os quatro fluxos preservados e
o desaparecimento completo da barra/gradiente após cinco segundos sem painel.
Chat, teatro funcional e o menu definitivo permanecem para etapas futuras.

## Arquivos desta entrega

- Estrutura e estilo: `app/native-hls.html`, `app/index.html`, `app/style.css`.
- Painéis, foco e navegação: `app/native-hls.js`, `app/embed-player.js`.
- Recursos locais: os cinco `app/phosphor-*.svg` listados acima e
  `app/phosphor-license.txt`.
- Empacotamento: `packaging.json`, `scripts/project.cjs`.
- Testes: `tests/browser/controls.spec.js`, `tests/browser/helpers/controls.js`,
  `tests/browser/direct-hls.spec.js`, `tests/browser/native-hls.spec.js`,
  `tests/browser/player.spec.js`, `tests/browser/video-stats.spec.js`.
- Documentação: `docs/PLAYER-CONTROLS.md`.

Validação local desta entrega: 23 testes unitários e 69 testes de navegador
aprovados; `npm run validate`, `git diff --check` e `npm run package` aprovados.
Versão desta entrega: **0.2.3** (tag `v0.2.3`). A revisão visual foi instalada
na LG OLED C3 e aprovada pelo usuário: ícones ampliados para 37px e remoção do
controle de volume. O volume permanece sob controle da própria TV.
Essa aprovação visual não substitui testes prolongados de estabilidade HLS.
