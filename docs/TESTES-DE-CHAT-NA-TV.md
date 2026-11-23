# Coletar o chat na LG C3

Referência funcional: v0.2.8. Use Node.js 22 ou mais recente, [instale o IPK do checkout a testar](TESTES.md#instalar-e-testar-na-lg-c3) e feche o app antes de iniciar. O dispositivo precisa estar pareado e com Developer Mode ativo.

```bash
node scripts/collect-tv.cjs --device=lgc3 --check-package
node scripts/collect-tv.cjs --device=lgc3 --length=10
```

O coletor valida o IPK local contra o código e compara os arquivos do app, serviço e pacote instalados por SHA-256. No modo manual, aguarde o aviso, abra o app com o controle, selecione uma live e ative teatro para observar o chat. A coleta começa quando o vídeo avança.

Para abrir a live e ativar o chat pelo coletor, defina `CANAL` com o nome da live e execute:

```bash
node scripts/collect-tv.cjs --device=lgc3 --mode=automatic --streamer="$CANAL" --length=10
```

Nesse modo, o início também aguarda o chat conectado. Ctrl+C após o início permite produzir um relatório parcial.

## Opções

| Opção | Uso |
|---|---|
| `--device` | Apelido da TV. Padrão `lgc3`. |
| `--mode` | `manual` (padrão) ou `automatic`. |
| `--streamer` | Nome do canal no modo automático. |
| `--length` | Duração em minutos. Aceita frações. Padrão 10. |
| `--player-interval` | Segundos entre amostras do player. Padrão 5, de 1 a 60 s. |
| `--chat-interval` | Segundos entre amostras do chat. Padrão 30, de 1 a 60 s e pelo menos igual ao intervalo do player. |
| `--raf-window` | Janela de rAF em segundos. Aceita 0, 1 (padrão) ou 5. |
| `--screenshots` | `true` captura o painel do chat. Padrão `false`. |
| `--continue-on-timeout` | Registra consultas expiradas como lacunas e prossegue. |
| `--output` | Diretório das execuções. Padrão `coletas`. |
| `--keep-samples` | Mantém os JSONs individuais após a consolidação. |
| `--thresholds` | Caminho para limiares de anomalia em JSON. |
| `--check-package` | Confere o IPK e a instalação sem iniciar uma coleta. |
| `--summarize` | Recalcula o resumo e os gráficos de uma execução arquivada. |

## Interpretar a coleta

Abra `resumo.md` para ver a sessão, `summary.json` para consultar intervalos e `graficos.html` para cruzar séries. Para investigar o chat, confronte fila e ACK, motivo de fechamento, expiração e tentativa de renovação. A taxa de distintivos efetivos usa as inserções de ícones locais e a aplicação de imagens remotas a linhas presentes. Fallbacks ficam fora da contagem. O pico é a maior média de um intervalo observado na mesma sessão.

Veja a [metodologia e os limites da telemetria](TELEMETRIA-FASE-2.md) antes de interpretar os números.
