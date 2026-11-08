# Preparação do CI e publicação de IPK

## Processo identificado

A aplicação usa HTML, CSS e JavaScript puro, sem compilação. Antes desta preparação, `npm run package` chamava `ares-package --no-minify app -o dist`, e `package:info` tinha o nome da versão 0.1.0 fixado. A CLI oficial 3.2.6 e o Playwright já estavam fixados nas dependências de desenvolvimento.

O novo processo mantém os arquivos da aplicação intactos. Valida manifesto e versões npm, prepara os arquivos de execução definidos em `packaging.json`, seleciona o perfil `tv`, empacota com a mesma CLI e audita o conteúdo do IPK. A saída fica em `dist/releases/`; os pacotes históricos não são selecionados por glob nem usados nas Releases.

## Validações locais realizadas

Ambiente: Ubuntu Linux, Node 22.22.3, CLI oficial 3.2.6 e Playwright 1.65.0.

| Verificação | Resultado |
| --- | --- |
| `npm ci --no-audit --no-fund` | Instalação concluída com o lockfile existente; nenhuma dependência adicionada |
| `npm test` | 10 testes unitários e 8 testes de navegador passaram |
| Metadados com tag `v0.1.0` | Aceitos; caminho do IPK emitido corretamente no formato `GITHUB_OUTPUT` |
| Tag divergente, prerelease e argumento `--tag` incompleto | Rejeitados com saída 1 |
| Arquivos de credenciais, dependências, testes e temporários dentro de `app/` | Excluídos da preparação; apenas os arquivos listados foram copiados |
| Links simbólicos e caminhos externos na lista de empacotamento | Rejeitados pelos testes |
| `npm run package` | IPK gerado com perfil `tv` em `dist/releases/com.kicktv.poc_0.1.0_all.ipk` |
| `npm run package:info` e auditoria Python | Identidade, versão, arquitetura e nove arquivos de execução conferidos contra a origem |
| Pacotes adulterados em diretórios temporários | Auditoria rejeitou arquivo extra, conteúdo alterado, arquivo ausente, link simbólico e versão interna divergente |
| `actionlint` 1.7.12 | Os dois workflows passaram sem apontamentos; ferramenta obtida da Release oficial e checksum conferido |
| Inspeção estrutural dos workflows | Filtro de tags, eventos de branch/PR, permissões, dependência entre jobs e referências por SHA conferidos |
| `git diff --check` | Sem erros de whitespace |
| Comparação com Git em `app/` e `assets/` | Sem alterações; funcionalidades e ícones preservados |

Os testes de navegador continuam usando o embed simulado para validar a interface. A geração de pacote usa a ferramenta real, e sua auditoria compara os bytes de todos os arquivos da aplicação. As rejeições de pacotes adulterados foram exercitadas localmente, sem modificar a aplicação ou os pacotes históricos.

## Limites desta preparação

Os workflows foram validados localmente, mas não executados no serviço GitHub Actions. Nenhuma tag ou Release foi criada e nenhuma alteração foi enviada ao remoto. Upload de artefatos, permissões efetivas das políticas do repositório, geração de notas e publicação precisam da primeira execução autorizada no GitHub para validação ponta a ponta.

O teste na televisão não foi repetido: o aceite anterior relatado pelo usuário continua registrado em [TESTES.md](TESTES.md). As instruções para criar uma versão, acompanhar os jobs e baixar o IPK estão no [README](../README.md#github-actions-e-publicação-de-versões).
