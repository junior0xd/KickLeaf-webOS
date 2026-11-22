'use strict';

const { readFile } = require('node:fs/promises');

const DEFAULTS = Object.freeze({
  nearby_ms: 2000,
  slow_interval_ms: 1000 / 30,
  raf_episode_ms: 250,
  long_task_ms: 100,
  fifo_items: 64,
  ui_latency_p95_ms: 120,
  memory_min_window_ms: 300000,
  memory_growth_mib_per_hour: 20
});

function thresholds(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Limiares devem ser um objeto JSON.');
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULTS, key) || !Number.isFinite(value) || value <= 0) throw new Error(`Limiar inválido: ${key}`);
  }
  return { ...DEFAULTS, ...overrides };
}

async function readThresholds(file) {
  return thresholds(JSON.parse(await readFile(file, 'utf8')));
}

function describe(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = p => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    n: sorted.length, min: sorted[0], mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    max: sorted.at(-1), p50: at(.5), p95: at(.95), p99: at(.99)
  };
}

function histogramDifference(a, b) {
  if (!a || !b || a.bounds.length !== b.bounds.length || !a.bounds.every((n, i) => n === b.bounds[i]) ||
      a.counts.length !== b.counts.length || b.sum < a.sum || b.n < a.n) return null;
  const counts = b.counts.map((n, i) => n - a.counts[i]);
  const n = b.n - a.n;
  if (counts.some(x => x < 0) || counts.reduce((sum, x) => sum + x, 0) !== n || !n) return null;
  const max = a.n === 0 || b.max > a.max ? b.max : null;
  return { bounds: b.bounds, counts, n, sum: b.sum - a.sum, max };
}

function histogramStats(histograms) {
  const valid = histograms.filter(Boolean);
  if (!valid.length) return null;
  const bounds = valid[0].bounds;
  if (!valid.every(h => h.bounds.length === bounds.length && h.bounds.every((n, i) => n === bounds[i]))) return null;
  const counts = valid[0].counts.map((_, i) => valid.reduce((sum, h) => sum + h.counts[i], 0));
  const n = valid.reduce((sum, h) => sum + h.n, 0);
  const quantile = p => {
    let total = 0;
    const index = counts.findIndex(count => (total += count) >= Math.ceil(n * p));
    return { lower: bounds[index - 1] ?? 0, upper: bounds[index] ?? null };
  };
  const lastBucket = counts.findLastIndex(count => count > 0);
  return {
    n, mean: valid.reduce((sum, h) => sum + h.sum, 0) / n,
    max: valid.every(h => Number.isFinite(h.max)) ? Math.max(...valid.map(h => h.max)) : null,
    max_upper: bounds[lastBucket] ?? null,
    p50: quantile(.5), p95: quantile(.95), p99: quantile(.99)
  };
}

function pairs(rows, identity, maxGap = Infinity) {
  const result = [];
  let previous;
  for (const row of rows) {
    if (row.sample && previous?.sample) {
      const id = identity(row.sample);
      const elapsed = row.elapsed_ms - previous.elapsed_ms;
      if (id && id === identity(previous.sample) && elapsed > 0 && elapsed <= maxGap) {
        result.push({ a: previous, b: row, elapsed });
      }
    }
    previous = row;
  }
  return result;
}

function series(rows, read, gap = Infinity) {
  const points = [];
  for (const row of rows) {
    const last = points.at(-1);
    if (last && row.elapsed_ms - last.ms > gap) points.push({ ms: (last.ms + row.elapsed_ms) / 2, value: null });
    points.push({ ms: row.elapsed_ms, value: read(row.sample) ?? null });
  }
  return points;
}

function trend(points) {
  const values = points.filter(p => Number.isFinite(p.value) && Number.isFinite(p.ms));
  const stats = describe(values.map(p => p.value));
  const span = values.at(-1)?.ms - values[0]?.ms;
  if (values.length < 3 || !(span > 0)) return { ...stats, slope_per_hour: null, observed_ms: Number.isFinite(span) ? span : null };
  const meanX = values.reduce((sum, p) => sum + (p.ms - values[0].ms), 0) / values.length;
  let covariance = 0;
  let variance = 0;
  for (const p of values) {
    const x = p.ms - values[0].ms - meanX;
    covariance += x * (p.value - stats.mean);
    variance += x * x;
  }
  const third = Math.max(1, Math.floor(values.length / 3));
  return {
    ...stats, slope_per_hour: covariance / variance * 3600000, observed_ms: span,
    first_third_mean: describe(values.slice(0, third).map(p => p.value)).mean,
    last_third_mean: describe(values.slice(-third).map(p => p.value)).mean
  };
}

function analyzeRaf(windows, criteria) {
  const intervals = [];
  const slow = [];
  const rates = { 1000: [], 5000: [] };
  let observed = 0;
  for (const window of windows) {
    let time = window.start_ms;
    let began = null;
    let subwindow = [];
    let subwindowIndex = 0;
    for (const dt of window.intervals_ms) {
      if (!Number.isFinite(dt) || dt <= 0) continue;
      intervals.push(dt);
      if (dt > criteria.slow_interval_ms) began ??= time;
      else if (began !== null) { slow.push({ start_ms: began, end_ms: time }); began = null; }
      if (window.requested_ms === 5000) {
        const bucket = Math.floor((time - window.start_ms) / 1000);
        if (bucket !== subwindowIndex) {
          if (subwindow.length) rates[1000].push(subwindow.length * 1000 / subwindow.reduce((n, value) => n + value, 0));
          subwindow = [];
          subwindowIndex = bucket;
        }
        if (time + dt <= window.start_ms + (bucket + 1) * 1000) subwindow.push(dt);
      }
      time += dt;
    }
    if (began !== null) slow.push({ start_ms: began, end_ms: time });
    if (subwindow.length) rates[1000].push(subwindow.length * 1000 / subwindow.reduce((n, value) => n + value, 0));
    const span = time - window.start_ms;
    observed += span;
    if (span > 0 && rates[window.requested_ms]) rates[window.requested_ms].push(window.intervals_ms.length * 1000 / span);
  }
  return {
    interval_ms: describe(intervals), windows: windows.length, observed_ms: observed,
    fps_by_window_ms: Object.fromEntries(Object.entries(rates).map(([key, rate]) => [key, describe(rate)])),
    slow_runs: slow.length, slow_ms: slow.reduce((sum, s) => sum + s.end_ms - s.start_ms, 0),
    episodes: slow.filter(s => s.end_ms - s.start_ms >= criteria.raf_episode_ms)
  };
}

function sessionId(sample) {
  return sample.service?.session ? `${sample.service.instance ?? ''}:${sample.service.session}` : null;
}

function temporal(fast, slow, events, meta, overrides) {
  const criteria = thresholds(overrides || meta.thresholds);
  const validFast = fast.filter(row => row.sample?.player);
  const first = validFast[0]?.sample?.tv_ms;
  const tvElapsed = value => Number.isFinite(value) && Number.isFinite(first) ? value - first : null;
  const fastPeriod = meta.fast_ms ?? 30000;
  const slowPeriod = meta.slow_ms ?? 30000;
  const servicePairs = pairs(slow, sessionId, slowPeriod * 1.5);
  const uiPairs = pairs(slow, s => s.chat?.session, slowPeriod * 1.5);
  const latencyFields = {
    service_received_normalized_ms: [servicePairs, 'service'],
    service_received_admitted_ms: [servicePairs, 'service'],
    service_admitted_offered_ms: [servicePairs, 'service'],
    service_offered_ui_received_ms: [uiPairs, 'chat'],
    ui_received_dom_ms: [uiPairs, 'chat'],
    ui_dom_service_ack_ms: [servicePairs, 'service'],
    service_received_ack_ms: [servicePairs, 'service'],
    render_prepare_ms: [uiPairs, 'chat'],
    render_append_ms: [uiPairs, 'chat'],
    emote_mount_ms: [uiPairs, 'chat'],
    emote_parse_ms: [uiPairs, 'chat'],
    emote_acquire_ms: [uiPairs, 'chat'],
    emote_nodes_ms: [uiPairs, 'chat'],
    emote_configure_ms: [uiPairs, 'chat'],
    emote_src_ms: [uiPairs, 'chat'],
    prune_ms: [uiPairs, 'chat'],
    scroll_read_ms: [uiPairs, 'chat'],
    scroll_write_ms: [uiPairs, 'chat'],
    scroll_wait_ms: [uiPairs, 'chat'],
    render_frame_wait_ms: [uiPairs, 'chat'],
    render_task_wait_ms: [uiPairs, 'chat'],
    render_timer_late_ms: [uiPairs, 'chat'],
    service_flush_timer_late_ms: [servicePairs, 'service'],
    render_batch_ms: [uiPairs, 'chat', 'render_batch_ms'],
    render_batch_items: [uiPairs, 'chat', 'render_batch_items']
  };
  const latencyWindows = [];
  const latency = {};
  const latencyByInterval = {};
  for (const [key, [frames, side, direct]] of Object.entries(latencyFields)) {
    const field = s => direct ? s[side]?.[direct] : s[side]?.latency?.[key];
    const intervals = frames.map(({ a, b }) => ({
      from: a.elapsed_ms, to: b.elapsed_ms, h: histogramDifference(field(a.sample), field(b.sample))
    })).filter(row => row.h);
    latency[key] = histogramStats(intervals.map(row => row.h));
    latencyByInterval[key] = intervals.map(row => ({
      from_ms: row.from, to_ms: row.to, ...histogramStats([row.h])
    }));
    if (key === 'ui_received_dom_ms') {
      for (const row of intervals) latencyWindows.push({ from: row.from, to: row.to, p95: histogramStats([row.h]).p95 });
    }
  }
  const counterFields = { normalized: 'normalized', offered: 'delivery_attempts', confirmed: 'confirmed',
    retransmissions: 'retransmissions', discarded: 'discarded', refused: 'refused' };
  const rates = servicePairs.map(({ a, b, elapsed }) => ({
    start_ms: a.elapsed_ms, end_ms: b.elapsed_ms, values: Object.fromEntries(
      Object.entries(counterFields).map(([label, key]) => {
        const start = a.sample.service.counts?.[key];
        const end = b.sample.service.counts?.[key];
        return [label, Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) * 1000 / elapsed : null];
      }))
  }));
  const processedMs = latency.render_batch_ms ? latency.render_batch_ms.mean * latency.render_batch_ms.n : null;
  const batchItems = latency.render_batch_items ? latency.render_batch_items.mean * latency.render_batch_items.n : null;
  const peaks = [1, 5, 30].map((seconds, i) => ({ seconds, peaks: Object.fromEntries(
    ['normalized', 'first_offered', 'confirmed'].map((name, k) => {
      const observed = slow.map(row => row.sample?.service?.load?.peaks?.[i]?.[k]).filter(Number.isFinite);
      return [name, observed.length ? Math.max(...observed) : null];
    })) }));
  const originBuckets = new Map();
  for (const row of slow) {
    const session = row.sample && sessionId(row.sample);
    if (!session) continue;
    for (const bucket of row.sample.service.load?.recent_1s ?? []) {
      originBuckets.set(`${session}:${bucket[0]}`, bucket);
    }
  }
  const sourceRateStats = Object.fromEntries(['normalized', 'first_offered', 'confirmed']
    .map((key, index) => [key, describe([...originBuckets.values()].map(bucket => bucket[index + 1]))]));
  const slowRead = fn => series(slow, s => s ? fn(s) : null, 1.5 * slowPeriod);
  const fastRead = fn => series(fast, s => s ? fn(s) : null, 1.5 * fastPeriod);
  const mib = bytes => Number.isFinite(bytes) ? bytes / 1048576 : null;
  const memory = {
    heap_js_mib: fastRead(s => mib(s.ui?.js_heap_used_bytes)),
    rss_node_mib: slowRead(s => mib(s.service?.memory?.rss)),
    dom_elements: slowRead(s => s.ui?.dom_nodes),
    emote_images: slowRead(s => s.chat?.emote_images),
    emote_entries: slowRead(s => s.chat?.emote_entries),
    badge_entries: slowRead(s => s.chat?.badge_entries)
  };
  const memoryStats = Object.fromEntries(Object.entries(memory).map(([key, points]) => [key, trend(points)]));
  const instances = new Set(slow.map(row => row.sample?.service?.instance).filter(Boolean));
  if (instances.size > 1) {
    memoryStats.rss_node_mib.slope_per_hour = null;
    memoryStats.rss_node_mib.trend_unavailable = 'reinicio_servico';
  }
  const fifo = slowRead(s => s.service?.queue?.items ?? s.service?.queue_items);
  let fifoElevatedMs = 0;
  let area = 0;
  let areaCoverage = 0;
  for (const { a, b, elapsed } of servicePairs) {
    const pre = a.sample.service.queue;
    const post = b.sample.service.queue;
    if (Number.isFinite(pre?.item_ms) && Number.isFinite(post?.item_ms) && post.item_ms >= pre.item_ms) {
      area += post.item_ms - pre.item_ms;
      areaCoverage += elapsed;
    }
    if (pre?.items >= criteria.fifo_items && post?.items >= criteria.fifo_items) fifoElevatedMs += elapsed;
  }
  const windows = validFast.map(row => row.sample.ui?.raf_window).filter(w => w && Number.isFinite(first) && w.start_ms >= first);
  const raf = analyzeRaf(windows, criteria);
  const normalizedEvents = events.map(e => {
    const tv = tvElapsed(e.tv_ms);
    const host = Date.parse(e.host_utc) - Date.parse(meta.started_utc);
    return { ...e, elapsed: Number.isFinite(tv) ? tv : Number.isFinite(host) ? host : null,
      clock: Number.isFinite(tv) ? 'ui_monotonic' : 'host_observed' };
  }).filter(e => Number.isFinite(e.elapsed) && e.elapsed >= 0 &&
    (e.clock !== 'ui_monotonic' || e.elapsed <= (validFast.at(-1)?.elapsed_ms ?? 0) + fastPeriod))
    .sort((a, b) => a.elapsed - b.elapsed);
  const plotted = {
    buffer_s: fastRead(s => s.player?.buffered_ahead_seconds), fifo_items: fifo,
    ui_fifo_items: slowRead(s => s.chat?.queue?.items),
    raf_fps: fastRead(s => s.ui?.raf_fps), inspector_ms: series(fast.map(r => ({ ...r, sample: r })), r => r.inspector_ms, 1.5 * fastPeriod),
    ...memory
  };
  const probeIntervals = (fast === slow ? fast : [...fast, ...slow])
    .filter(row => Number.isFinite(row.inspector_ms))
    .map(row => ({ kind: 'diagnostico', start: row.elapsed_ms - row.inspector_ms, end: row.elapsed_ms, duration: row.inspector_ms }));
  for (const event of events) {
    if (['screenshot_salvo', 'screenshot_indisponivel'].includes(event.kind) &&
        Number.isFinite(event.elapsed_ms) && Number.isFinite(event.duration_ms)) {
      probeIntervals.push({ kind: 'screenshot', start: event.elapsed_ms,
        end: event.elapsed_ms + event.duration_ms, duration: event.duration_ms });
    }
  }
  const incidents = [];
  function add(kind, from, until, metrics, confidence, limitation, clock = 'host_observed') {
    if (!Number.isFinite(from)) return;
    const end = Number.isFinite(until) ? until : from;
    const nearby = normalizedEvents.filter(e => e.elapsed >= from - criteria.nearby_ms && e.elapsed <= end + criteria.nearby_ms);
    const context = {};
    for (const field of ['buffer_s', 'fifo_items', 'raf_fps', 'heap_js_mib']) {
      const values = plotted[field].filter(p => Number.isFinite(p.value));
      context[field] = {
        before: values.findLast(p => p.ms < from) ?? null,
        during: describe(values.filter(p => p.ms >= from && p.ms <= end).map(p => p.value)),
        after: values.find(p => p.ms > end) ?? null
      };
    }
    incidents.push({
      kind, timestamp_ms: from, duration_ms: Number.isFinite(until) ? Math.max(0, end - from) : null,
      clock, confidence, limitation, metrics, context,
      nearby_events: nearby.slice(0, 20).map(e => ({ kind: e.kind, timestamp_ms: e.elapsed, clock: e.clock })),
      nearby_events_omitted: Math.max(0, nearby.length - 20),
      inspector_reads_nearby: probeIntervals.filter(row =>
        row.end >= from - criteria.nearby_ms && row.start <= end + criteria.nearby_ms).slice(0, 20)
    });
  }
  for (const episode of raf.episodes) add('cadencia_raf_baixa', tvElapsed(episode.start_ms), tvElapsed(episode.end_ms),
    { threshold_interval_ms: criteria.slow_interval_ms }, 'média', 'Rajada amostral de callbacks JS, sem inferência sobre fluidez de vídeo.', 'ui_monotonic');
  for (const e of normalizedEvents) {
    if (e.kind === 'long_task' && e.duration_ms >= criteria.long_task_ms) {
      add('long_task', e.elapsed, e.elapsed + e.duration_ms, { duration_ms: e.duration_ms }, 'alta', 'Tarefa observada pelo navegador.', e.clock);
    }
    if (['server_disconnect', 'stopped', 'network_offline', 'inspector_disconnected'].includes(e.kind) ||
        e.kind === 'chat_service_status' && e.status === 'stopped' ||
        e.kind === 'chat_state' && ['Error', 'Closed'].includes(e.state)) {
      add('mudanca_conexao', e.elapsed, null, { event: e.kind, state: e.state, reason: e.reason ?? null }, 'média',
        e.clock === 'host_observed' ? 'Horário em que o coletor recebeu o evento, possivelmente até uma leitura depois.' : 'Transição observada na página.', e.clock);
    }
  }
  let waiting;
  for (const e of normalizedEvents) {
    if (['waiting', 'stalled'].includes(e.kind)) waiting ??= e;
    if (['playing', 'pause', 'error', 'ended', 'video_removed'].includes(e.kind) && waiting) {
      add('interrupcao_player', waiting.elapsed, e.elapsed, { start_event: waiting.kind, end_event: e.kind }, 'média', 'Intervalo entre eventos do player, sujeito a lacunas.', waiting.clock);
      waiting = undefined;
    } else if (e.kind === 'error') add('erro_player', e.elapsed, null, { code: e.code }, 'alta', 'Evento de erro de mídia.', e.clock);
  }
  if (waiting) add('interrupcao_player', waiting.elapsed, null, { start_event: waiting.kind }, 'baixa', 'Fim do episódio fora da cobertura.', waiting.clock);
  if (!incidents.some(event => event.kind === 'interrupcao_player')) {
    for (const { a, b } of pairs(fast, s => `${s.page}:${s.stream}`, fastPeriod * 1.5)) {
      const earlier = a.sample.player?.buffering_count;
      const later = b.sample.player?.buffering_count;
      if (Number.isFinite(earlier) && later > earlier) add('interrupcao_player_amostrada', b.elapsed_ms, null,
        { count_delta: later - earlier, interval_start_ms: a.elapsed_ms }, 'média', 'A transição ocorreu entre amostras; o instante exato é desconhecido.');
    }
  }
  for (const point of fifo) {
    if (point.value >= criteria.fifo_items) add('fila_elevada', point.ms, null, { depth: point.value }, 'média', 'Profundidade instantânea, duração exata indisponível.');
  }
  for (const window of latencyWindows) {
    if (window.p95.lower >= criteria.ui_latency_p95_ms) add('latencia_ui_elevada', window.from, window.to,
      { p95_ms: window.p95 }, 'média', 'P95 está dentro da faixa do histograma; duração corresponde à janela de leitura.');
  }
  for (const [key, points] of Object.entries(memory)) {
    if (!key.endsWith('_mib')) continue;
    const stats = memoryStats[key];
    if (stats.observed_ms >= criteria.memory_min_window_ms &&
        stats.slope_per_hour > criteria.memory_growth_mib_per_hour &&
        stats.last_third_mean > stats.first_third_mean) {
      add('tendencia_memoria', points.find(p => Number.isFinite(p.value)).ms,
        points.findLast(p => Number.isFinite(p.value)).ms, { field: key, ...stats }, 'baixa',
        'Tendência linear das leituras. Aquecimento e garbage collection podem afetar a estimativa.');
    }
  }
  incidents.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  return {
    thresholds: criteria, raf, latency, latency_by_interval: latencyByInterval, latency_windows: latencyWindows, rates,
    load_peaks: peaks, source_rate_per_second_observed: sourceRateStats, render_ms_per_1000_messages: batchItems > 0 ? processedMs / batchItems * 1000 : null,
    fifo: { sampled: describe(fifo.map(p => p.value)), mean_weighted: areaCoverage ? area / areaCoverage : null,
      elevated_estimated_ms: fifo.some(p => Number.isFinite(p.value)) ? fifoElevatedMs : null,
      coverage_ms: areaCoverage },
    memory: memoryStats,
    inspector: { player: describe(fast.map(r => r.inspector_ms)), chat: describe(slow.map(r => r.inspector_ms)),
      over_period: fast.filter(r => r.inspector_ms >= fastPeriod).length + slow.filter(r => r.inspector_ms >= slowPeriod).length,
      skipped: events.filter(e => e.kind === 'amostras_puladas').reduce((n, e) => n + (e.count || 0), 0),
      lost_events: events.filter(e => e.kind === 'eventos_perdidos' || e.kind === 'linha_invalida').reduce((n, e) => n + (e.count || 1), 0) },
    incidents, plotted
  };
}

module.exports = { describe, histogramDifference, histogramStats, pairs, trend, analyzeRaf, temporal, readThresholds };
