# Coletar o chat na LG C3

Use Node.js 22 ou mais recente e deixe a TV ligada, pareada como `lgc3` e com o Developer Mode ativo. Gere o IPK, instale o arquivo indicado pelo empacotador e feche o KickTV antes de iniciar a coleta.

```bash
npm run package
npx ares-install --device lgc3 dist/releases/com.kicktv.alpha_0.2.8_all.ipk
node scripts/collect-tv.cjs --device=lgc3 --check-package
node scripts/collect-tv.cjs --device=lgc3 --mode=automatic --streamer=westcol --length=10 --chat-interval=10
```

No modo automático, o coletor abre a transmissão e o chat real. No modo manual, espere o aviso, abra o app pelo controle e selecione o canal. Ative o modo teatro para medir o chat. O coletor valida o IPK contra o código e compara os hashes do app e do serviço instalados. A coleta começa quando o vídeo avança e, no modo automático, quando o chat está conectado.

## Opções

| Opção | Uso |
|---|---|
| `--device` | Apelido da TV. Padrão `lgc3`. |
| `--mode` | `manual` (padrão) ou `automatic`. |
| `--streamer` | Nome do canal no modo automático. |
| `--length` | Duração em minutos. Aceita frações. Padrão 10. |
| `--player-interval` | Segundos entre amostras do player. Padrão 5. |
| `--chat-interval` | Segundos entre amostras do chat. Padrão 30 e pelo menos igual ao intervalo do player. |
| `--raf-window` | Janela de rAF em segundos. Aceita 0, 1 (padrão) ou 5. |
| `--screenshots` | `true` captura o painel do chat. Padrão `false`. |
| `--continue-on-timeout` | Registra consultas expiradas como lacunas e prossegue. |
| `--output` | Diretório das execuções. Padrão `coletas`. |
| `--keep-samples` | Mantém os JSONs individuais após a consolidação. |
| `--thresholds` | Caminho para limiares de anomalia em JSON. |
| `--check-package` | Confere o IPK e a instalação sem iniciar uma coleta. |
| `--summarize` | Recalcula o resumo e os gráficos de uma execução arquivada. |

## Interpretar a coleta

O `resumo.md` traz as métricas da sessão, `summary.json` inclui os intervalos e `graficos.html` abre as séries temporais. Use fila, reconhecimentos e motivo de encerramento para medir a estabilidade do chat. O rAF mede a cadência da interface. O estado e o avanço do vídeo são medidos pelo player.

A taxa de distintivos efetivos conta ícones locais inseridos no DOM e imagens remotas validadas aplicadas a linhas presentes. A média usa o tempo entre amostras da mesma sessão. O pico é a maior média desses intervalos. Ícones provisórios ficam fora da contagem.

Veja [telemetria, relógios e limites das medições](TELEMETRIA-FASE-2.md).
