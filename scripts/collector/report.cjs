'use strict';

const { readFile, readdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { readRows } = require('./archive.cjs');
const { temporal } = require('./analysis.cjs');
const { graphs } = require('./graphs.cjs');

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
  return sum(sessions.flatMap(rows => rows.slice(1).map((row, i) =>
    delta(field(rows[i].sample), field(row.sample)))));
}

function observedStates(samples, events) {
  return [...new Set([
    ...samples.map(item => item.sample.player?.state),
    ...events.map(e => ['playing', 'paused', 'waiting', 'stalled'].includes(e.kind) ? e.kind : e.kind === 'pause' ? 'paused' : null)
  ].filter(Boolean))].join(', ') || 'indisponível';
}

function observedService(slow, events) {
  const observations = slow.filter(row => row.sample?.service).map(row => ({
    source: 'snapshot_chat', utc: row.utc ?? null, elapsed_ms: row.elapsed_ms,
    status: row.sample.service.status ?? null, reason: row.sample.service.reason ?? null,
    error: row.sample.service.error ?? null, socket: row.sample.service.socket ?? null,
    session: row.sample.service.session ?? null
  }));
  for (const event of events.filter(e => e.kind === 'chat_service_status')) {
    observations.push({
      source: 'transicao_ui', utc: event.host_utc ?? null, tv_ms: event.tv_ms ?? null,
      status: event.status ?? null, reason: event.reason ?? null, error: event.error ?? null,
      socket: event.socket ?? null
    });
  }
  observations.sort((a, b) => (Date.parse(a.utc) || 0) - (Date.parse(b.utc) || 0));
  const last = observations.at(-1) ?? null;
  const lastReason = observations.findLast(entry => entry.reason !== null) ?? null;
  return {
    last_observation: last, last_reason_observed: lastReason,
    service_closure_observed: last ? last.status === 'stopped' : null
  };
}

function observedAuthorization(rows) {
  const service = rows.findLast(row => row.sample?.service)?.sample.service;
  const auth = service?.authorization;
  const renewal = service?.renewal;
  const deadline = Number.isFinite(auth?.expires_at_ms) ? new Date(auth.expires_at_ms) : null;
  const expiration = deadline && Number.isFinite(deadline.valueOf()) ? deadline.toISOString() : null;
  const attempted = Number.isFinite(renewal?.attempts) ? renewal.attempts > 0 : auth ? false : null;
  const result = ({ confirmed: 'sucesso', failed: 'falha', retry_wait: 'aguardando nova tentativa',
    attempting: 'em andamento' })[renewal?.status];
  return {
    ttl_seconds: auth?.ttl_seconds ?? renewal?.ttl_seconds ?? null,
    renewal_required: auth?.renewal_required ?? null,
    renewal_attempted: attempted,
    renewal_result: result ?? (attempted === false ? 'sem tentativa' : null),
    next_expiration_utc: auth?.active === true ? expiration : null,
    last_expiration_utc: expiration,
    connection_active: auth?.active ?? null
  };
}

async function summarize(folder, overrides) {
  const readJson = async name => JSON.parse(await readFile(path.join(folder, name), 'utf8'));
  const meta = await readJson('execucao.json');
  const files = await readdir(folder);
  const rows = (await readRows(folder, files)).sort((a, b) => a.scheduled_ms - b.scheduled_ms);
  const fast = rows.filter(row => ['player', 'amostra'].includes(row.type));
  const legacy = fast.some(row => row.sample && 'service_status' in row.sample);
  const slow = legacy ? fast : rows.filter(row => row.type === 'chat');
  const metadata = rows.filter(row => row.type === 'metadados');
  const events = [];
  const eventFile = ['events.jsonl', 'eventos.jsonl'].find(file => files.includes(file));
  if (eventFile) {
    const content = await readFile(path.join(folder, eventFile), 'utf8');
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
  const badgeIntervals = chatSessions.flatMap(rows => rows.slice(1).flatMap((row, index) => {
    const before = rows[index];
    if (row.sample.page !== before.sample.page) return [];
    const seconds = (row.sample.tv_ms - before.sample.tv_ms) / 1000;
    const start = before.sample.chat.badges;
    const end = row.sample.chat.badges;
    const local = delta(start?.effective_local, end?.effective_local);
    const remote = delta(start?.effective_remote, end?.effective_remote);
    if (!(seconds > 0) || local === null || remote === null) return [];
    return [{ start_ms: before.elapsed_ms, end_ms: row.elapsed_ms, seconds,
      local, remote, per_second: (local + remote) / seconds,
      messages_with_more_than_four: delta(start?.over_four, end?.over_four) }];
  }));
  const badgeSeconds = sum(badgeIntervals.map(row => row.seconds));
  const badgeMetrics = badgeSeconds > 0 ? {
    local: sum(badgeIntervals.map(row => row.local)),
    remote: sum(badgeIntervals.map(row => row.remote)),
    observed_seconds: badgeSeconds,
    mean_per_second: sum(badgeIntervals.map(row => row.local + row.remote)) / badgeSeconds,
    peak_per_second: stats(badgeIntervals.map(row => row.per_second)).max,
    messages_with_more_than_four: sum(badgeIntervals.map(row => row.messages_with_more_than_four)),
    intervals: badgeIntervals
  } : null;
  // Both page totals include the final drain after the per-consumer counters disappear.
  const chatTotalRows = slowValid.filter(({ sample: { chat } }) =>
    Number.isFinite(chat?.received) && Number.isFinite(chat?.presented));
  const chatTotals = groups(chatTotalRows, s => s.page ?? 'legacy').filter(rows => rows.length > 1).map(rows => {
    const first = rows[0].sample.chat;
    const last = rows.at(-1).sample.chat;
    return { received: delta(first.received, last.received), inserted: delta(first.presented, last.presented) };
  }).filter(totals => totals.received !== null && totals.inserted !== null);
  const receivedUnique = sum(chatTotals.map(totals => totals.received));
  const inserted = sum(chatTotals.map(totals => totals.inserted));
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
  const observedVersion = startVersion?.version || startVersion?.service?.version;
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

  const analysis = temporal(fast, slow, events, meta, overrides);
  const { incidents, plotted, ...analytics } = analysis;
  const endState = observedService(slow, events);
  const renewal = slowValid.findLast(row => row.sample.service?.renewal)?.sample.service.renewal ?? null;
  const authorization = observedAuthorization(slowValid);
  const screenshots = {
    enabled: meta.screenshots ?? null,
    saved: events.filter(event => event.kind === 'screenshot_salvo').length,
    unavailable: events.filter(event => event.kind === 'screenshot_indisponivel').length
  };
  const cssMeasurements = slowValid.map(row => row.sample.chat?.emotes).filter(Boolean);
  const cssLast = cssMeasurements.at(-1);
  const cssMetrics = Number.isFinite(cssLast?.lazy_css_loads) ? {
    loads: cssLast.lazy_css_loads, ready: cssLast.lazy_css_ready, failed: cssLast.lazy_css_failed,
    evicted: cssLast.lazy_css_evicted, capacity_fallbacks: cssLast.lazy_css_capacity_fallbacks,
    cache_peak_sampled: stats(cssMeasurements.map(counts => counts.lazy_css_ids)).max,
    peak_dom_emotes: cssLast.lazy_css_peak_dom_emotes,
    ready_mean_ms: cssLast.lazy_css_ready ? cssLast.lazy_css_latency_ms_total / cssLast.lazy_css_ready : null,
    ready_max_ms: cssLast.lazy_css_ready ? cssLast.lazy_css_latency_ms_max : null
  } : null;
  const yesNo = value => value === true ? 'sim' : value === false ? 'não' : 'indisponível';
  const playbackMode = first?.playback_mode ?? null;
  const baseline = {
    schema: 3, channel: meta.channel ?? null, mode: meta.mode ?? null, playback_mode: playbackMode, result: meta.result ?? null,
    ...(meta.live_emote_assets && { live_emote_assets: meta.live_emote_assets }),
    ...(meta.live_badge_assets && { live_badge_assets: meta.live_badge_assets }),
    ...(badgeMetrics && { badges_effective: badgeMetrics }),
    ...(cssMetrics && { lazy_css: cssMetrics }),
    duration_requested_ms: meta.duration_ms ?? null, duration_observed_ms: durationSeconds,
    player_interval_ms: meta.fast_ms ?? 30000, chat_interval_ms: meta.slow_ms ?? 30000,
    coverage: { player_valid: valid.length, player_expected: expected, chat_valid: slowValid.length, chat_read: slow.length },
    player: { startup_ms: delta(selection, firstPlaying), buffering_count: delta(first?.player?.buffering_count, last?.player?.buffering_count),
      buffering_seconds: delta(first?.player?.buffering_seconds, last?.player?.buffering_seconds),
      dropped_frames: delta(first?.player?.dropped_frames, last?.player?.dropped_frames), observed_states: observedStates(valid, events) },
    chat: { received_unique: receivedUnique, inserted, confirmed, sessions_observed: serviceSessions.length,
      last_renewal: renewal, authorization, ...endState }, screenshots, ...analytics
  };
  await writeFile(path.join(folder, 'summary.json'), JSON.stringify(baseline, null, 2) + '\n');
  await writeFile(path.join(folder, 'anomalies.json'), JSON.stringify({ thresholds: analysis.thresholds, anomalies: incidents }, null, 2) + '\n');
  await graphs(folder, analysis, lastTime, events.filter(event => event.kind === 'screenshot_salvo'));
  const formatRange = value => value ? `${show(value.lower)}–${value.upper === null ? 'sem teto' : show(value.upper)}` : 'indisponível';
  const report = [
    '# Coleta KickTV', '', '## Identificação da sessão', '',
    `- Canal · ${cell(meta.channel)}`,
    ...(meta.live_emote_assets ? [`- Renderização dos emotes no chat real · ${cell(meta.live_emote_assets)}`] : []),
    ...(meta.live_badge_assets ? [`- Renderização dos distintivos no chat real · ${cell(meta.live_badge_assets)}`] : []),
    ...(meta.operator_note ? [`- Observação presencial · ${cell(meta.operator_note)}`] : []),
    ...(cssMetrics ? [
      `- Carregamentos CSS iniciados / prontos / falhos · ${show(cssMetrics.loads)} / ${show(cssMetrics.ready)} / ${show(cssMetrics.failed)}`,
      `- Pico amostrado de IDs em cache / IDs removidos / fallbacks por capacidade · ${show(cssMetrics.cache_peak_sampled)} / ${show(cssMetrics.evicted)} / ${show(cssMetrics.capacity_fallbacks)}`,
      `- Pico de emotes CSS no DOM · ${show(cssMetrics.peak_dom_emotes)}`,
      `- Tempo médio / máximo da descoberta do ID à regra pronta · ${show(cssMetrics.ready_mean_ms)} / ${show(cssMetrics.ready_max_ms)} ms`
    ] : []),
    `- Modo de início / reprodução · ${cell(meta.mode)} / ${cell(playbackMode)}`,
    `- Intervalos configurados do player e chat · ${show((meta.fast_ms ?? 30000) / 1000)} / ${show((meta.slow_ms ?? 30000) / 1000)} s`,
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
    `- Mensagens únicas recebidas pela UI · ${show(receivedUnique)}`,
    `- Mensagens inseridas no DOM · ${show(inserted)}`,
    `- Mensagens confirmadas · ${show(confirmed)}`,
    `- Confirmações por segundo entre leituras da mesma sessão · ${show(Number.isFinite(confirmed) && subscribedSeconds > 0 ? confirmed / subscribedSeconds : null)}`,
    `- Retransmissões / duplicatas de origem / duplicatas suprimidas pela UI · ${show(serviceDelta(s => s.service.counts?.retransmissions))} / ${show(serviceDelta(s => s.service.duplicates))} / ${show(sessionDelta(chatSessions, s => s.chat.counts?.duplicates_suppressed))}`,
    `- Recusas / descartes do serviço · ${show(serviceDelta(s => s.service.counts?.refused))} / ${show(serviceDelta(s => s.service.counts?.discarded))}`,
    `- Fila atual / pico de sessão do serviço · ${show(slowValid.at(-1)?.sample.service?.queue?.items ?? slowValid.at(-1)?.sample.service?.queue_items)} / ${show(stats(service(s => s?.queue?.max_items)).max)} itens`,
    `- Fila média no período observado (ponderada pelo tempo) · ${show(subscribedSeconds > 0 ? (serviceDelta(s => s.service.queue?.item_ms) ?? NaN) / (subscribedSeconds * 1000) : null)} itens`,
    ...(badgeMetrics ? [
      `- Distintivos efetivos por segundo, média / pico por intervalo · ${show(badgeMetrics.mean_per_second)} / ${show(badgeMetrics.peak_per_second)}`,
      `- Distintivos efetivos locais / remotos · ${show(badgeMetrics.local)} / ${show(badgeMetrics.remote)} em ${show(badgeMetrics.observed_seconds)} s amostrados na mesma sessão`,
      ...(badgeMetrics.messages_with_more_than_four !== null ? [
        `- Mensagens com mais de quatro distintivos selecionados · ${show(badgeMetrics.messages_with_more_than_four)}`
      ] : []),
      '- A métrica conta ícones locais inseridos no DOM e ícones remotos validados aplicados a linhas presentes. Exclui ícones provisórios e usa intervalos entre amostras.'
    ] : []),
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
    `- Último service.reason registrado · ${endState.last_observation ? (endState.last_observation.reason === null ? 'null' : cell(endState.last_observation.reason)) : 'indisponível'}`,
    `- Último motivo preenchido observado · ${cell(endState.last_reason_observed?.reason)}`,
    `- Último estado do serviço / fechamento observado · ${cell(endState.last_observation?.status)} / ${endState.service_closure_observed ? 'sim' : 'não observado'}`,
    `- Sessões de chat observadas / encerramentos detectados · ${serviceSessions.length} / ${socketClosedCount}`,
    `- Tempo entre encerramento e nova sessão observada · ${distribution(disconnections)} s (mín. / méd. / máx.)`,
    `- HTTP do chat, registros observados / status de erro · ${http.length} / ${http.filter(row => row.status >= 400).length}`,
    `- Tempo de resposta HTTP do chat · ${distribution(http.map(row => row.elapsed_ms))} ms (mín. / méd. / máx.)`,
    `- Segmentos HLS e tempos HTTP de mídia · ${urlsUnavailable}`,
    `- Metadados válidos · ${metaOk.length} de ${metadata.length} (${cell(metadata.at(-1)?.sample?.status)})`,
    `- Último título / categoria · ${cell(latest?.title)} / ${cell(latest?.category)}`,
    `- Espectadores mínimo / médio / máximo observados · ${distribution(viewers)}`,
    '',
    '### Autorização da conexão WebSocket', '',
    `- TTL concedido · ${Number.isFinite(authorization.ttl_seconds) ? show(authorization.ttl_seconds) + ' s' : authorization.renewal_required === false ? 'sem prazo anunciado' : 'indisponível'}`,
    `- Renovação necessária · ${yesNo(authorization.renewal_required)}`,
    `- Renovação tentada · ${yesNo(authorization.renewal_attempted)}`,
    `- Resultado · ${cell(authorization.renewal_result)}`,
    `- Próxima expiração · ${authorization.next_expiration_utc ?? (authorization.connection_active === false ? 'conexão encerrada' : authorization.renewal_required === false ? 'sem expiração anunciada' : 'indisponível')}`,
    ...(authorization.connection_active === false && authorization.last_expiration_utc
      ? [`- Último prazo anunciado · ${authorization.last_expiration_utc}`] : []),
    '',
    '## Saúde da coleta', '',
    `- Intervalo real entre amostras do player · ${distribution(valid.slice(1).map((row, i) => (row.elapsed_ms - valid[i].elapsed_ms) / 1000))} s (mín. / méd. / máx.)`,
    `- Tempo de resposta do Inspector para o player · ${distribution(fast.slice(1).map(row => row.inspector_ms))} ms (mín. / méd. / máx.)`,
    `- Falhas de leitura registradas / amostras do player ausentes · ${healthFailures.length} / ${Math.max(0, expected - valid.length)}`,
    `- Exceções JS observadas / reinícios de página observados · ${show(observedExceptions)} / ${events.filter(e => e.kind === 'pagina_reiniciada').length}`,
    `- Entrega de eventos · ${cell(meta.event_delivery)}`,
    `- Eventos perdidos sinalizados · ${sum(events.filter(e => e.kind === 'eventos_perdidos').map(e => e.count)) ?? 0}`,
    `- Screenshots habilitados / salvos / indisponíveis · ${yesNo(screenshots.enabled)} / ${screenshots.saved} / ${screenshots.unavailable}`,
    `- Gravação de eventos · ${meta.event_write_error ? 'falha' : files.includes('eventos.jsonl') ? 'registrada' : 'indisponível'}`,
    '',
    '## Análise temporal', '',
    `- Intervalos de callback rAF P50 / P95 / P99 / máximo · ${show(analysis.raf.interval_ms?.p50)} / ${show(analysis.raf.interval_ms?.p95)} / ${show(analysis.raf.interval_ms?.p99)} / ${show(analysis.raf.interval_ms?.max)} ms`,
    `- FPS médio das rajadas de 1 s / 5 s · ${show(analysis.raf.fps_by_window_ms[1000]?.mean)} / ${show(analysis.raf.fps_by_window_ms[5000]?.mean)}`,
    `- Sequências lentas / duração observada / episódios persistentes · ${analysis.raf.windows ? analysis.raf.slow_runs : 'indisponível'} / ${show(analysis.raf.windows ? analysis.raf.slow_ms : null)} ms / ${analysis.raf.windows ? incidents.filter(e => e.kind === 'cadencia_raf_baixa').length : 'indisponível'}`,
    `- rAF observado em ${analysis.raf.windows} rajadas, com ${show(analysis.raf.observed_ms / 1000)} s entre callbacks`,
    `- Fila P95 amostral / tempo elevado estimado · ${show(analysis.fifo.sampled?.p95)} itens / ${show(analysis.fifo.elevated_estimated_ms === null ? null : analysis.fifo.elevated_estimated_ms / 1000)} s`,
    `- Pico observado de itens na fila da interface · ${show(stats(slowValid.map(row => row.sample.chat?.queue?.max_items)).max)} itens`,
    `- Idade máxima amostrada na fila do serviço / da interface · ${show(stats(service(s => s?.oldest_age_ms)).max)} / ${show(stats(slowValid.map(row => row.sample.chat?.oldest_age_ms)).max)} ms`,
    `- Tempo de processamento por mil inserções · ${show(analysis.render_ms_per_1000_messages)} ms`,
    `- Heap JS / RSS do Node, tendência linear · ${show(analysis.memory.heap_js_mib.slope_per_hour)} / ${show(analysis.memory.rss_node_mib.slope_per_hour)} MiB/h`,
    `- Consultas acima da cadência / janelas puladas / eventos perdidos · ${analysis.inspector.over_period} / ${analysis.inspector.skipped} / ${analysis.inspector.lost_events}`,
    '',
    '### Histogramas por etapa', '',
    '| Métrica | n | Média | P50 | P95 | P99 | Máximo confirmado |',
    '| --- | ---: | ---: | --- | --- | --- | ---: |',
    ...Object.entries(analysis.latency).map(([key, h]) =>
      `| ${key} | ${h?.n ?? 'indisponível'} | ${show(h?.mean)} | ${formatRange(h?.p50)} | ${formatRange(h?.p95)} | ${formatRange(h?.p99)} | ${show(h?.max)} |`),
    '',
    'Os histogramas usam ms, exceto render_batch_items. Os percentis são faixas. Oferta→recebimento na UI usa o relógio de parede da TV e inclui a entrega Luna e a espera pelo callback. DOM→ACK usa o mesmo relógio e mede uma observação por ACK cumulativo, a partir da última inserção coberta. Recebimento na UI→DOM e recebimento no serviço→ACK usam relógios monotônicos locais.',
    'render_frame_wait_ms mede a espera pelo quadro. render_timer_late_ms mede o atraso além dos 50 ms quando o timer assume a renderização. service_flush_timer_late_ms mede o atraso além dos 100 ms entre disparos com fila pendente.',
    'As amostras guardam histogramas cumulativos da interface e do serviço. O summary.json guarda os deltas em latency_by_interval.',
    '',
    '### Picos de carga no serviço', '',
    '| Janela | Normalizadas | Primeiras ofertas | Confirmadas |',
    '| ---: | ---: | ---: | ---: |',
    ...analysis.load_peaks.map(row => `| ${row.seconds} s | ${show(row.peaks.normalized)} | ${show(row.peaks.first_offered)} | ${show(row.peaks.confirmed)} |`),
    '',
    'Picos cumulativos da sessão do serviço em janelas alinhadas a segundos. Taxas por intervalo observado estão no summary.json.',
    '',
    `- Segundos com contagem na origem · ${show(analysis.source_rate_per_second_observed.normalized?.n)}`,
    `- Média por segundo na origem, normalizadas / primeiras ofertas / confirmadas · ${show(analysis.source_rate_per_second_observed.normalized?.mean)} / ${show(analysis.source_rate_per_second_observed.first_offered?.mean)} / ${show(analysis.source_rate_per_second_observed.confirmed?.mean)}`,
    '',
    '## Anomalias', '',
    `Ocorrências observadas: ${incidents.length}. Detalhes antes, durante e depois, critérios, confiança e eventos vizinhos estão em anomalies.json.`,
    '',
    ...incidents.slice(0, 30).map(e => `- ${show(e.timestamp_ms / 1000)} s · ${e.kind} · duração ${show(e.duration_ms === null ? null : e.duration_ms / 1000)} s · confiança ${e.confidence}`),
    '',
    '## Avaliação final', '',
    'Quedas de rAF descrevem a cadência dos callbacks JavaScript. Avalie a reprodução pelos eventos e contadores do player. Uma coincidência temporal indica o que investigar. Tendências de memória descrevem o intervalo observado e podem incluir aquecimento e garbage collection.',
    '',
    'Os deltas usam leituras da mesma sessão. Picos amostrais e tempos sem cobertura dependem da cadência. Consulte os JSONs e eventos para cruzar horários.',
    ''
  ];
  for (const row of healthFailures) report.push(`- Falha em ${show(row.scheduled_ms / 1000)} s · ${cell(row.error)}`);
  await writeFile(path.join(folder, 'resumo.md'), report.join('\n') + '\n');
}

module.exports = { summarize, observedService, observedAuthorization };
