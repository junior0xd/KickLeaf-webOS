# Distintivos do chat

Os SVGs foram extraídos estaticamente dos três arquivos de frontend fornecidos pelo usuário; esses bundles não são executados ou incluídos no app. O registro [BADGE-ASSETS.json](BADGE-ASSETS.json) documenta hashes, componentes e módulos de origem para cada um dos 140 SVGs incorporados. Os desenhos são ativos de marca da Kick; a licença MIT preservada em `app/badge-icons/LICENSE` corresponde apenas ao fallback Phosphor `question.svg`. Os controles do player continuam usando Phosphor.

## Associação por identificador

| Tipo legado | SVG |
|---|---|
| founder | FounderBadge (variante sólida aprovada) |
| broadcaster | HostBadge |
| moderator | ModeratorBadge |
| vip | VIPBadge |
| staff | StaffBadge |
| verified | VerifiedBadge |
| bot | BotBadge |
| og | OGBadge |
| subscriber | SubscriberBadge padrão |
| sub_gifter | Gift por quantidade; tabela abaixo |
| sidekick | SidekickBadge |
| chat_identity | IdentityBadge |
| trainwreckstv | TrainwreckstvBadge |

O serviço mantém `count` validado no badgeSet; o seletor usa esse campo para os presentes. Valor ausente, inválido ou zero usa Gift1, como o fallback `count || 1` do frontend. Tipos desconhecidos continuam com o fallback, sem criar caminhos a partir de texto remoto.

| Quantidade | SVG |
|---|---|
| 1–4 | Gift1 |
| 5–9 | Gift5 |
| 10–24 | Gift10 |
| 25–49 | Gift25 |
| 50–99 | Gift50 |
| 100–149 | Gift100 |
| 150–199 | Gift150 |
| 200–249 | Gift200 |
| 250–299 | Gift250 |
| 300–349 | Gift300 |
| 350–399 | Gift350 |
| 400–449 | Gift400 |
| 450–499 | Gift450 |
| 500–549 | Gift500 |
| 550–599 | Gift550 |
| 600–649 | Gift600 |
| 650–699 | Gift650 |
| 700–749 | Gift700 |
| 750–799 | Gift750 |
| 800–849 | Gift800 |
| 850–899 | Gift850 |
| 900–949 | Gift900 |
| 950–999 | Gift950 |
| 1000–1999 | Gift1000 |
| 2000–2999 | Gift2000 |
| 3000–3999 | Gift3000 |
| 4000–4999 | Gift4000 |
| 5000 ou mais | Gift5000 |

Badges v2 selecionadas cujo nome exato é `level` e metadata.level é inteiro validado entre 1 e 99 usam Level1–Level99 locais. Outros nomes, níveis fora da faixa e demais badges v2 continuam no fluxo de image_url com as validações, limites e limpeza existentes. A imagem CDN não é substituída com base em semelhança visual ou nome parcial. As imagens personalizadas de assinatura não foram acrescentadas sem seus dados específicos; o legado subscriber usa o distintivo padrão.

O Founder usa o SVG sólido escolhido pelo usuário: 987 bytes, numeral #3b2a08, sem PNG embutido e sem filtro. É uma derivação intencional do desenho original, preservado no workspace de análise. IdentityBadge recebe color=#fff no elemento raiz para resolver os paths currentColor no contexto escuro. Os demais bodies permanecem como extraídos. SubGifterBadge básico também é preservado como ativo de referência, mas a renderização normal usa as 28 faixas Gift.

## Renderização CSS na v0.2.8

A interface usa caixas de 20 × 20 px, com uma classe por ícone local e uma por imagem remota validada, compartilhadas entre linhas. O fallback Phosphor `question.svg` fica visível durante a espera e em caso de rejeição. Uma imagem remota só é aplicada se a linha ainda estiver no DOM e pertencer à sessão atual. A inversão de cor é restrita ao fallback. Ao encerrar, a interface remove as regras remotas, cancela requisições e revoga as URLs dos objetos.

## Imagens remotas

A URL original deve ser HTTPS, de `files.kick.com` ou `ext.cdn.kick.com`, sem credenciais, porta explícita fora do padrão, query ou fragmento. Para o caminho exato `/chat/badges/{id}.png` em `ext.cdn.kick.com`, a URL de transporte recebe parâmetros de WebP a 72 px e qualidade 50. O teto do corpo é de 64 KiB nesse caso e de 128 KiB nos demais. O formato aceito depende do MIME e da assinatura real. SVG passa por restrições de conteúdo e a decodificação exige dimensões naturais positivas até 512 × 512.

O fetch recusa redirecionamentos e tem prazo de 8 s. A decodificação tem prazo de 2 s. Há duas cargas simultâneas e um orçamento de 2 MiB por sessão. O cache compartilha promessas pela URL original até 64 entradas, incluindo falhas. Esgotamento ou falha mantém o fallback, sem repetir o download com a URL original.

## Verificação

Os SVGs locais entram no IPK pela lista explícita de [empacotamento](../packaging.json). Os testes cobrem limites Gift, níveis válidos e inválidos, fallback, decode e reutilização de regras CSS. A telemetria conta ícones locais inseridos, excluindo o fallback, e imagens remotas aplicadas enquanto a linha ainda existe. Veja [coleta na LG C3](TESTES-DE-CHAT-NA-TV.md).
