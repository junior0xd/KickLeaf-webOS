# KickTV Alpha v0.2.6

Ao receber distintivos legados da Kick, o chat agora exibe os desenhos oficiais locais em vez dos ícones genéricos. O Founder usa a variante de numeral sólido #3b2a08 aprovada pelo usuário (987 bytes); Sub Gifter seleciona uma das 28 variantes conforme count. Os identificadores sidekick, chat_identity e trainwreckstv passam a ser reconhecidos, e badges v2 selecionadas de nível 1–99 usam os SVGs locais. Outros tipos v2 preservam seu fluxo CDN e seus limites. Assinantes usam o distintivo padrão; não foram inferidas imagens personalizadas ausentes.

A opção de player oficial foi retirada apenas do formulário inicial. O menu do player mantém a mesma ação e o canal informado; a navegação inicial por setas percorre campo e Assistir. Direct HLS, opções de qualidade, recarga, estatísticas, FIFO/ACK, emotes e limpeza de recursos permanecem cobertos pela suíte existente.

Nome visível **KickTV Alpha**, ID **com.kicktv.alpha**, serviço **com.kicktv.alpha.service**, metadados npm e versão de runtime sincronizados em **0.2.6**. O sufixo _all pertence ao nome do IPK; não integra o ID, conforme correção autorizada pelo usuário. O novo ID cria uma identidade distinta da antiga com.kicktv.poc, sem migração automática de preferências. Não foi instalada ou alterada nenhuma aplicação na TV.

## Validação local

- `npm run validate -- --tag v0.2.6`: aprovado.
- `npm test`: **24 testes unitários, 134 de chat e 83 de navegador; 241 aprovados**, sem falhas ou skips.
- Novos testes cobrem associação após normalização, os dois lados das 28 faixas Gift, count inválido, níveis válidos e fora da faixa, fallback desconhecido e o Founder sem raster/filtro.
- O teste de navegador decodifica os 139 SVGs alcançáveis pelo seletor em 20×20, sem fetch CDN; verifica cores sem inversão e mantém invert(1) apenas no fallback Phosphor. O SVG básico SubGifterBadge é preservado como referência entre os 140 ativos oficiais/derivados incorporados, mas a seleção normal usa Gift1 ou a faixa correspondente.
- A revisão visual encontrou o filtro CSS invert(1) herdado dos ícones monocromáticos. Ele foi restrito ao fallback antes da publicação; a suíte completa foi repetida e a prévia com CSS real inspecionada.
- `npm run package`: aprovado com CLI oficial, seguido da verificação de conteúdo do IPK (177 arquivos de execução do app, serviço e ws fixado no lockfile). Nenhum bundle minificado de frontend, experimento ou segredo foi incorporado.

Artefato: `dist/releases/com.kicktv.alpha_0.2.6_all.ipk`. Tamanho: 136506 bytes. SHA-256: **b22a96d717f2e4376b762146ee6ad61233f7a7df9bee7df2be3bde833b6b8969**.

[Associações, faixas e procedência](BADGE-ASSETS.md), [hashes individuais](BADGE-ASSETS.json). Question.svg continua sendo o fallback Phosphor, com sua licença MIT preservada. Os ativos da Kick não são reclassificados sob essa licença.

As verificações usam Chromium e mídia/rede simuladas. Não houve instalação, operação ou nova validação na televisão. GitHub Actions não foi consultado; a publicação do commit e da tag foi solicitada pelo usuário, e o resultado dos workflows não faz parte desta validação.
