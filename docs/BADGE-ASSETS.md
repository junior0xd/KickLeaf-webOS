# Distintivos locais da Kick

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

Os três últimos tipos passam a ser reconhecidos quando recebidos. Sua inclusão no mapa não atribui distintivos a usuários nem comprova observação em sessão. O serviço mantém `count` validado no badgeSet; o seletor usa esse campo para os presentes. Valor ausente, inválido ou zero usa Gift1, como o fallback `count || 1` do frontend. Tipos desconhecidos continuam com o fallback, sem criar caminhos a partir de texto remoto.

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

Os arquivos são incluídos explicitamente em packaging.json, sem fetch de SVGs oficiais ou execução dos bundles. Os testes verificam associação após normalização, ambos os lados de cada limite Gift, níveis válidos/fora da faixa, fallback e decodificação real de 139 arquivos alcançáveis pelo seletor no navegador em 20×20. Não houve sessão nova ou instalação na TV.
