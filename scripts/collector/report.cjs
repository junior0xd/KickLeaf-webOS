'use strict';

const { readFile, readdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const show = value => Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : 'indisponível';
const cell = value => typeof value === 'string' && value
  ? value.replace(/[\r\n|]/g, ' ').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  : 'indisponível';
const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;

function stats(values) {
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of values.filter(Number.isFinite)) {
    count++;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { count, min, max, mean: sum / count };
}

function distribution(values) {
  const { min, max, mean, count } = stats(values);
  return count ? `${show(min)} / ${show(mean)} / ${show(max)}` : 'indisponível';
}

function sum(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
}

function groups(rows, identify) {
  const result = new Map();
  for (const row of rows) {
    const key = identify(row.sample);
    if (!key) continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return [...result.values()];
}

function sessionDelta(sessions, field) {
  return sum(sessions.map(rows => rows.length < 2
    ? null : delta(field(rows[0].sample), field(rows.at(-1).sample))));
}

function observedStates(samples, events) {
  return [...new Set([
    ...samples.map(item => item.sample.player?.state),
    ...events.map(e => ['playing', 'paused', 'waiting', 'stalled'].includes(e.kind) ? e.kind : e.kind === 'pause' ? 'paused' : null)
  ].filter(Boolean))].join(', ') || 'indisponível';
}

async function summarize(folder) {
  const readJson = async name => JSON.parse(await readFile(path.join(folder, name), 'utf8'));
  const meta = await readJson('execucao.json');
  const files = await readdir(folder);
  const rowsFor = async pattern => {
    const rows = [];
    for (const name of files.filter(name => pattern.test(name)).sort()) rows.push(await readJson(name));
    return rows.sort((a, b) => a.scheduled_ms - b.scheduled_ms);
  };
  const fast = await rowsFor(/^(player|amostra)-\d+\.json$/);
  const legacy = fast.some(row => row.sample && 'service_status' in row.sample);
  const slow = legacy ? fast : await rowsFor(/^chat-\d+\.json$/);
  const metadata = await rowsFor(/^metadados-\d+\.json$/);
  const events = [];
  if (files.includes('eventos.jsonl')) {
    const content = await readFile(path.join(folder, 'eventos.jsonl'), 'utf8');
    for (const line of content.split('\n').filter(Boolean)) {
      try { events.push(JSON.parse(line)); } catch { events.push({ kind: 'linha_invalida' }); }
    }
  }
  const valid = fast.filter(row => row.sample);
  const first = valid[0]?.sample;
  const last = valid.at(-1)?.sample;
  const slowValid = slow.filter(row => row.sample);
  const player = fn => valid.map(row => fn(row.sample.player));
  const service = fn => slowValid.map(row => fn(row.sample.service));
  const sessionKey = s => s.service?.session && `${s.service.instance || ''}:${s.service.session}`;
  const serviceSessions = groups(slowValid, sessionKey);
  const chatSessions = groups(slowValid, s => s.chat?.session);
  const serviceDelta = field => sessionDelta(serviceSessions, field);
  const confirmed = serviceDelta(s => s.service.counts?.confirmed);
  const subscribedSeconds = sum(serviceSessions.map(rows => rows.length < 2 ? null :
    (rows.at(-1).elapsed_ms - rows[0].elapsed_ms) / 1000));
  const firstPlaying = first?.first_video_ms;
  const selection = first?.selected_ms;
  const firstChatReady = valid.find(row => Number.isFinite(row.sample.chat_ready_ms))?.sample.chat_ready_ms;
  const expected = Math.ceil(meta.duration_ms / (meta.fast_ms || 30_000)) + 1;
  const lastTime = valid.at(-1)?.elapsed_ms;
  const urlsUnavailable = 'indisponível no diagnóstico do player nativo';
  const timelineJumps = events.filter(e => e.kind === 'seeked' && e.tv_ms >= first?.tv_ms).length;
  const mediaErrors = events.filter(e => e.kind === 'error' && e.tv_ms >= first?.tv_ms).length;
  const observedExceptions = meta.runtime_events ? events.filter(e => e.kind === 'js_exception').length : null;
  const healthFailures = fast.concat(legacy ? [] : slow).filter(row => row.error);
  const startVersion = slowValid.find(row => row.sample.version || row.sample.service?.version)?.sample;
  const observedVersion = startVersion?.version || startVersion?.service.version;
  const durationSeconds = delta(valid[0]?.elapsed_ms, lastTime);
  const disconnections = [];
  let disconnected;
  let previousServiceSession;
  let socketClosedCount = 0;
  for (const event of events.filter(event => event.origin === 'servico_chat').sort((a, b) => a.at - b.at)) {
    if (event.kind === 'reading') {
      if (disconnected !== undefined && event.session_id !== previousServiceSession) {
        disconnections.push((event.at - disconnected) / 1000);
        disconnected = undefined;
      }
      previousServiceSession = event.session_id;
    } else if (event.kind === 'stopped' && event.session_id === previousServiceSession) {
      disconnected = event.at;
      socketClosedCount++;
    }
  }
  const http = [...new Map(serviceSessions.flatMap(rows => rows.at(-1).sample.service.network?.http?.map((record, index) =>
    [`${sessionKey(rows.at(-1).sample)}:${index}`, record]) ?? [])).values()];
  const viewers = metadata.map(row => row.sample?.viewers);
  const metaOk = metadata.filter(row => row.sample?.status === 'ok');
  const latest = metaOk.at(-1)?.sample;

  const report = [
    '# Coleta KickTV', '',
    `- Canal · ${cell(meta.channel)}`,
    `- Modo · ${cell(meta.mode)}`,
    `- Resultado · ${cell(meta.result)}`,
    `- Versão esperada / consultada pelo serviço · ${cell(meta.expected_version)} / ${cell(observedVersion)}`,
    `- Duração solicitada / observada · ${show(meta.duration_ms / 1000)} / ${show(durationSeconds === null ? null : durationSeconds / 1000)} s`,
    `- Amostras do player válidas · ${valid.length} de ${expected}`,
    `- Leituras de diagnóstico do chat válidas · ${slowValid.length} de ${slow.length}`,
    `- Leituras com serviço de chat indisponível · ${slowValid.filter(row => row.sample.service_status === 'unavailable').length}`,
    '',
    '## Player HLS', '',
    `- Seleção até o primeiro evento playing · ${show(delta(selection, firstPlaying))} ms`,
    `- Primeiro playing até o chat pronto · ${show(delta(firstPlaying, firstChatReady))} ms`,
    `- Buffer adiante atual · ${show(last?.player?.buffered_ahead_seconds)} s`,
    `- Buffer adiante mínimo / médio / máximo observados · ${distribution(player(p => p?.buffered_ahead_seconds))} s`,
    `- Interrupções por buffering · ${show(delta(first?.player?.buffering_count, last?.player?.buffering_count))}`,
    `- Tempo total em buffering · ${show(delta(first?.player?.buffering_seconds, last?.player?.buffering_seconds))} s`,
    `- Posição final · ${show(last?.player?.media_time_seconds)} s`,
    `- Saltos sinalizados por seeked na janela · ${show(legacy ? null : timelineJumps)}`,
    `- Erros de mídia registrados por evento · ${show(legacy ? null : mediaErrors)}`,
    `- Estados observados · ${observedStates(valid, events)}`,
    `- Bitrate nominal da variante manual mínimo / médio / máximo · ${distribution(player(p => Number.isFinite(p?.nominal_bitrate) ? p.nominal_bitrate / 1e6 : null))} Mbps`,
    `- Distância até a borda da janela navegável · ${distribution(player(p => p?.live_edge_gap_seconds))} s (mín. / méd. / máx.)`,
    `- Bitrate efetivo e latência absoluta da live · ${urlsUnavailable}`,
    `- FPS de vídeo apresentado · ${distribution(player(p => p?.reported_fps))} (mín. / méd. / máx.)`,
    `- Quadros descartados · ${show(delta(first?.player?.dropped_frames, last?.player?.dropped_frames))}`,
    '',
    '## Chat e FIFO/ACK', '',
    `- Publicações normalizadas · ${show(serviceDelta(s => s.service.counts?.normalized))}`,
    `- Ofertas à UI, incluindo retransmissões · ${show(serviceDelta(s => s.service.counts?.delivery_attempts))}`,
    `- Mensagens únicas recebidas pela UI · ${show(sessionDelta(chatSessions, s => s.chat.counts?.received_unique))}`,
    `- Mensagens inseridas no DOM · ${show(delta(slowValid[0]?.sample.chat?.presented, slowValid.at(-1)?.sample.chat?.presented))}`,
    `- Mensagens confirmadas · ${show(confirmed)}`,
    `- Confirmações por segundo entre leituras da mesma sessão · ${show(Number.isFinite(confirmed) && subscribedSeconds > 0 ? confirmed / subscribedSeconds : null)}`,
    `- Retransmissões / duplicatas de origem / duplicatas suprimidas pela UI · ${show(serviceDelta(s => s.service.counts?.retransmissions))} / ${show(serviceDelta(s => s.service.duplicates))} / ${show(sessionDelta(chatSessions, s => s.chat.counts?.duplicates_suppressed))}`,
    `- Recusas / descartes do serviço · ${show(serviceDelta(s => s.service.counts?.refused))} / ${show(serviceDelta(s => s.service.counts?.discarded))}`,
    `- Fila atual / pico de sessão do serviço · ${show(slowValid.at(-1)?.sample.service?.queue?.items ?? slowValid.at(-1)?.sample.service?.queue_items)} / ${show(stats(service(s => s?.queue?.max_items)).max)} itens`,
    `- Fila média no período observado (ponderada pelo tempo) · ${show(subscribedSeconds > 0 ? (serviceDelta(s => s.service.queue?.item_ms) ?? NaN) / (subscribedSeconds * 1000) : null)} itens`,
    '',
    '## Interface', '',
    `- FPS da interface via rAF (janelas curtas) · ${distribution(valid.map(row => row.sample.ui?.raf_fps))} (mín. / méd. / máx.)`,
    `- Maior atraso do event loop relatado · ${show(stats(slowValid.map(row => row.sample.ui?.event_loop_lag_max_ms)).max)} ms`,
    `- Long tasks na janela observada · ${show(delta(slowValid[0]?.sample.ui?.long_tasks, slowValid.at(-1)?.sample.ui?.long_tasks))}`,
    `- Pico amostrado de elementos DOM / heap JS em MiB · ${show(stats(slowValid.map(row => row.sample.ui?.dom_nodes)).max)} / ${show(stats(valid.map(row => row.sample.ui?.js_heap_used_bytes)).max / 1048576)}`,
    `- Tempo de inserção por lote (média acumulada da sessão chat, última leitura) · ${show((slowValid.at(-1)?.sample.chat?.render_batch_ms?.sum ?? NaN) / (slowValid.at(-1)?.sample.chat?.render_batch_ms?.n || NaN))} ms`,
    '',
    '## Rede e metadados', '',
    `- Último estado do WebSocket · ${slowValid.at(-1)?.sample.service?.socket === true ? 'aberto' : slowValid.at(-1)?.sample.service?.socket === false ? 'fechado' : 'indisponível'}`,
    `- Último motivo ou erro reportado pelo chat · ${cell(slowValid.at(-1)?.sample.service?.reason || slowValid.at(-1)?.sample.service?.error)}`,
    `- Sessões de chat observadas / encerramentos detectados · ${serviceSessions.length} / ${socketClosedCount}`,
    `- Tempo entre encerramento e nova sessão observada · ${distribution(disconnections)} s (mín. / méd. / máx.)`,
    `- HTTP do chat, registros observados / status de erro · ${http.length} / ${http.filter(row => row.status >= 400).length}`,
    `- Tempo de resposta HTTP do chat · ${distribution(http.map(row => row.elapsed_ms))} ms (mín. / méd. / máx.)`,
    `- Segmentos HLS e tempos HTTP de mídia · ${urlsUnavailable}`,
    `- Metadados válidos · ${metaOk.length} de ${metadata.length} (${cell(metadata.at(-1)?.sample?.status)})`,
    `- Último título / categoria · ${cell(latest?.title)} / ${cell(latest?.category)}`,
    `- Espectadores mínimo / médio / máximo observados · ${distribution(viewers)}`,
    '',
    '## Saúde da coleta', '',
    `- Intervalo real entre amostras do player · ${distribution(valid.slice(1).map((row, i) => (row.elapsed_ms - valid[i].elapsed_ms) / 1000))} s (mín. / méd. / máx.)`,
    `- Tempo de resposta do Inspector para o player · ${distribution(fast.slice(1).map(row => row.inspector_ms))} ms (mín. / méd. / máx.)`,
    `- Falhas de leitura registradas / amostras do player ausentes · ${healthFailures.length} / ${Math.max(0, expected - valid.length)}`,
    `- Exceções JS observadas / reinícios de página observados · ${show(observedExceptions)} / ${events.filter(e => e.kind === 'pagina_reiniciada').length}`,
    `- Entrega de eventos · ${cell(meta.event_delivery)}`,
    `- Eventos perdidos sinalizados · ${sum(events.filter(e => e.kind === 'eventos_perdidos').map(e => e.count)) ?? 0}`,
    `- Gravação de eventos · ${meta.event_write_error ? 'falha' : files.includes('eventos.jsonl') ? 'registrada' : 'indisponível'}`,
    '',
    'Os deltas usam leituras da mesma sessão. Picos amostrais e tempos sem cobertura dependem da cadência. Consulte os JSONs e eventos para cruzar horários.',
    ''
  ];
  for (const row of healthFailures) report.push(`- Falha em ${show(row.scheduled_ms / 1000)} s · ${cell(row.error)}`);
  await writeFile(path.join(folder, 'resumo.md'), report.join('\n') + '\n');
}

module.exports = { summarize };
