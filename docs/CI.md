# Validação e publicação do IPK

Referência funcional: v0.2.9. O CI usa Ubuntu 24.04, Node 22.22.3, CLI webOS e Playwright fixados pelos lockfiles. A validação local equivalente está no [roteiro de testes](TESTES.md).

| Workflow | Disparo | Resultado |
| --- | --- | --- |
| [Validate webOS app](../.github/workflows/validate.yml) | Push em branch ou pull request | Valida metadados, roda testes, gera e audita o IPK. Guarda o artefato por 7 dias. |
| [Release webOS IPK](../.github/workflows/release.yml) | Push de tag `v*` | Valida tag e versão, roda testes, gera e audita o IPK. Guarda o artefato por 14 dias. Um job separado baixa o IPK da mesma execução e publica a Release com notas automáticas. |

O build tem permissão `contents: read`. O job de publicação usa `contents: write` e o token automático do workflow. A tag deve igualar a versão do manifesto do app. O [validador](../scripts/validate.cjs) também confere identidade e versões nos metadados e lockfiles do app e do serviço. Consulte o [changelog](../CHANGELOG.md) para registrar o conteúdo da versão.

O [empacotador](../scripts/package.cjs) copia somente os arquivos definidos em [packaging.json](../packaging.json), inclui a dependência de execução do serviço e gera `dist/releases/<id>_<versão>_all.ipk`. A auditoria confere caminhos, metadados e bytes do conteúdo. Os pacotes preservados na raiz de `dist/` pertencem à PoC. CI valida o artefato de instalação. A reprodução na LG C3 tem roteiro próprio.
