'use strict';

const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collect, folderPrefix, options, summarize, inspectorUrl, comparePackageFiles } = require('../scripts/collect-tv.cjs');
const { analyzeRaf, describe, histogramDifference, histogramStats, pairs, temporal, trend } = require('../scripts/collector/analysis.cjs');
const { archive, readRows } = require('../scripts/collector/archive.cjs');
const { observedService, observedAuthorization } = require('../scripts/collector/report.cjs');
const { createScreenshots, screenshotClip } = require('../scripts/collector/screenshots.cjs');

test('collector validates the automatic channel and names folders in local time', () => {
  assert.equal(options([]).mode, 'manual');
  assert.equal(options(['--check-package'])['check-package'], true);
  assert.equal(options([]).screenshots, false);
  assert.equal(options(['--screenshots=true']).screenshots, true);
  assert.equal(options(['--mode=automatic', '--streamer=baianotv', '--screenshots=true']).screenshots, true);
  assert.equal(options(['--screenshots=false']).screenshots, false);
  assert.throws(() => options(['--screenshots=maybe']), /--screenshots/);
  assert.equal(options([]).duration, 600_000);
  assert.throws(() => options(['--mode=automatic']), /--streamer/);
  assert.throws(() => options(['--length=0']), /--length/);
  assert.throws(() => options(['--mode=automatic', '--streamer=../unsafe']), /--streamer/);
  assert.equal(options(['--mode=automatic', '--streamer=BaianoTV', '--length=20']).streamer, 'baianotv');
  assert.equal(folderPrefix('baianotv', new Date(2026, 10, 21, 14, 30)), 'baianotv_21-11-2026_1430-');
  assert.match(folderPrefix('../unsafe', new Date()), /^canal-desconhecido_/);
});

test('package preflight checks content, even when the installed version is identical', () => {
  const manifest = 'usr/palm/applications/com.kicktv.alpha/appinfo.json';
  const service = 'usr/palm/services/com.kicktv.alpha.service/session.js';
  const extra = 'usr/palm/services/com.kicktv.alpha.service/extra.js';
  const expected = { [manifest]: 'a'.repeat(64), [service]: 'b'.repeat(64) };
  const unchanged = `[Info] Set target device : lgc3\n${expected[manifest]}  ${manifest}\n`;
  assert.deepEqual(comparePackageFiles(expected, unchanged + `${expected[service]}  ${service}\n`), []);
  assert.deepEqual(comparePackageFiles(expected, unchanged + `${'c'.repeat(64)}  ${service}\n`), [service]);
  assert.deepEqual(comparePackageFiles(expected, unchanged + `${'c'.repeat(64)}  ${extra}\n`), [service, extra]);
  assert.throws(() => comparePackageFiles(expected, unchanged + `${service}\n`), /Inventário inválido/);
});

test('hybrid collection writes fast and slow snapshots and aggregates observed counter deltas', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-collector-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  let player = 0;
  let chat = 0;
  const readPlayer = () => ({
    page: 1, stream: 1, player: { state: 'playing', buffering_count: player++, buffered_ahead_seconds: 6 }
  });
  const readChat = () => {
    const count = chat++;
    return {
      page: 1, tv_ms: count * 1000,
      chat: { session: 'chat', badges: { effective_local: count * 6, effective_remote: count * 2 } },
      service: { instance: 'instance', session: 'chat', counts: { confirmed: count * 10 }, queue: { items: 2 } }
    };
  };
  const result = await collect({
    folder, duration: 430, fastMs: 100, slowMs: 300, start: readPlayer(), started: performance.now(),
    read: readPlayer, slowRead: readChat,
    events: { record() {} }, signal: new AbortController().signal
  });
  assert.equal(result, 'completa');
  const files = await readdir(folder);
  assert.ok(files.includes('player-0000000430.json'));
  assert.deepEqual(files.filter(name => name.startsWith('chat-')), [
    'chat-0000000000.json', 'chat-0000000300.json', 'chat-0000000430.json'
  ]);
  await writeFile(path.join(folder, 'execucao.json'), JSON.stringify({ result, duration_ms: 430, fast_ms: 100 }));
  await summarize(folder);
  const report = await readFile(path.join(folder, 'resumo.md'), 'utf8');
  assert.match(report, /Mensagens confirmadas · 20/);
  assert.match(report, /Distintivos efetivos por segundo, média \/ pico por intervalo · 8 \/ 8/);
  assert.match(report, /Distintivos efetivos locais \/ remotos · 12 \/ 4 em 2 s/);
  assert.match(report, /Buffer adiante mínimo \/ médio \/ máximo observados · 6 \/ 6 \/ 6/);
});

test('partial collection preserves the first sample when the TV page restarts', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-collector-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const events = [];
  const result = await collect({
    folder, duration: 40, fastMs: 20, slowMs: 80, start: { page: 1, stream: 1, player: {} },
    started: performance.now(), read: () => ({ page: 2 }), slowRead: () => ({}),
    events: { record: event => events.push(event.kind) },
    signal: new AbortController().signal
  });
  assert.equal(result, 'incompleta (pagina_reiniciada)');
  assert.deepEqual(events, ['pagina_reiniciada']);
  const initial = JSON.parse(await readFile(path.join(folder, 'player-0000000000.json'), 'utf8'));
  assert.equal(initial.sample.page, 1);
});

test('opt-in collection records timeouts and preserves later samples', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-collector-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const start = { page: 1, stream: 1, player: {} };
  let playerReads = 0;
  let chatReads = 0;
  const events = [];
  const result = await collect({
    folder, duration: 300, fastMs: 100, slowMs: 100, start,
    started: performance.now(), continueOnTimeout: true,
    read() {
      if (++playerReads === 1) throw new Error('consulta_expirada');
      return start;
    },
    slowRead() {
      if (++chatReads === 2) throw new Error('consulta_expirada');
      return { service: {} };
    },
    events: { record: event => events.push(event.kind) },
    signal: new AbortController().signal
  });
  assert.equal(result, 'incompleta (lacunas de coleta)');
  assert.deepEqual(events, ['consulta_expirada', 'consulta_expirada']);
  const final = JSON.parse(await readFile(path.join(folder, 'chat-0000000300.json'), 'utf8'));
  assert.deepEqual(final.sample, { service: {} });
});

test('percentiles ignore missing values and histogram deltas preserve ranges and reset boundaries', () => {
  assert.deepEqual(describe([1, null, 2, 8, undefined]), { n: 3, min: 1, mean: 11 / 3, max: 8, p50: 2, p95: 8, p99: 8 });
  const first = { bounds: [20, 40], counts: [4, 2, 0], n: 6, sum: 105, max: 30 };
  const last = { bounds: [20, 40], counts: [5, 2, 1], n: 8, sum: 170, max: 50 };
  const current = histogramStats([histogramDifference(first, last)]);
  assert.equal(current.n, 2);
  assert.equal(current.mean, 32.5);
  assert.equal(current.max, 50);
  assert.deepEqual(current.p95, { lower: 40, upper: null });
  assert.equal(histogramDifference(last, first), null);
  assert.equal(histogramDifference(first, { ...last, bounds: [10, 40] }), null);
  const rows = [{ elapsed_ms: 0, sample: { id: 'a' } }, { elapsed_ms: 5, sample: { id: 'b' } },
    { elapsed_ms: 10, sample: { id: 'b' } }, { elapsed_ms: 15, sample: null },
    { elapsed_ms: 20, sample: { id: 'b' } }];
  assert.deepEqual(pairs(rows, s => s.id).map(pair => [pair.a.elapsed_ms, pair.b.elapsed_ms]), [[5, 10]]);
});

test('rAF windows preserve gaps and episodes without treating cadence as media failure', () => {
  const data = analyzeRaf([
    { start_ms: 400, requested_ms: 1000, intervals_ms: [17, 60, 70, 90, 110, 18] },
    { start_ms: 4000, requested_ms: 5000, intervals_ms: [17, 18] }
  ], { slow_interval_ms: 1000 / 30, raf_episode_ms: 250 });
  assert.equal(data.interval_ms.p99, 110);
  assert.equal(data.slow_ms, 330);
  assert.deepEqual(data.episodes, [{ start_ms: 417, end_ms: 747 }]);
  assert.equal(data.fps_by_window_ms[5000].n, 1);
  assert.equal(analyzeRaf([], {}).interval_ms, null);
});

test('temporal correlation prefers the UI clock, reports gaps and preserves missing series', () => {
  const fast = [
    { elapsed_ms: 0, sample: { tv_ms: 9000, page: 1, stream: 1, player: { buffering_count: 0 } } },
    { elapsed_ms: 5000, inspector_ms: 6000, sample: { tv_ms: 14000, page: 1, stream: 1,
      player: { buffering_count: 1 }, ui: { raf_window: { start_ms: 11000, requested_ms: 1000, intervals_ms: [150, 150, 20] } } } }
  ];
  const result = temporal(fast, [], [
    { kind: 'long_task', tv_ms: 11150, duration_ms: 110, host_utc: '2040-01-01T00:00:00Z' },
    { kind: 'chat_batch', tv_ms: 11200, dom_inserted: 4 },
    { kind: 'eventos_perdidos', count: 3 }
  ], { started_utc: '2026-01-01T00:00:00Z', fast_ms: 5000 });
  assert.equal(result.inspector.over_period, 1);
  assert.equal(result.inspector.lost_events, 3);
  assert.equal(result.fifo.sampled, null);
  const lowRaf = result.incidents.find(item => item.kind === 'cadencia_raf_baixa');
  assert.equal(lowRaf.timestamp_ms, 2000);
  assert.equal(lowRaf.duration_ms, 300);
  const task = lowRaf.nearby_events.find(item => item.kind === 'long_task');
  assert.equal(task.timestamp_ms, 2150);
  assert.equal(task.clock, 'ui_monotonic');
  assert.ok(result.incidents.some(item => item.kind === 'interrupcao_player_amostrada'));
  assert.ok(Math.abs(trend([{ ms: 0, value: 10 }, { ms: 1800000, value: 12 },
    { ms: 3600000, value: 14 }]).slope_per_hour - 4) < 1e-9);
});

test('summary preserves null reason and distinguishes a later observed service shutdown', () => {
  const slow = [{ utc: '2026-01-01T00:00:00Z', sample: { service: { status: 'reading', reason: null, socket: true } } }];
  const active = observedService(slow, []);
  assert.equal(active.last_observation.reason, null);
  assert.equal(active.service_closure_observed, false);
  const stopped = observedService(slow, [{ kind: 'chat_service_status', host_utc: '2026-01-01T00:00:01Z',
    status: 'stopped', reason: 'last_consumer', socket: false }]);
  assert.equal(stopped.last_reason_observed.reason, 'last_consumer');
  assert.equal(stopped.last_observation.source, 'transicao_ui');
  assert.equal(stopped.service_closure_observed, true);
});

test('temporal analysis keeps delivery, DOM, ACK and timer latency in separate intervals', () => {
  const empty = { bounds: [10, 50], counts: [0, 0, 0], n: 0, sum: 0, max: null };
  const histogram = value => ({ ...empty, counts: [Number(value <= 10), Number(value > 10), 0], n: 1, sum: value, max: value });
  const slow = [0, 5000].map(elapsed => ({
    elapsed_ms: elapsed,
    sample: {
      chat: { session: 'chat', queue: { items: 4 }, latency: {
        service_offered_ui_received_ms: elapsed ? histogram(7) : empty,
        ui_received_dom_ms: elapsed ? histogram(30) : empty,
        render_timer_late_ms: elapsed ? histogram(5) : empty
      } },
      service: { instance: 'tv', session: 'chat', queue: { items: 9 }, latency: {
        ui_dom_service_ack_ms: elapsed ? histogram(9) : empty,
        service_flush_timer_late_ms: elapsed ? histogram(4) : empty
      } }
    }
  }));
  const result = temporal([], slow, [], { slow_ms: 5000 });
  assert.equal(result.latency.service_offered_ui_received_ms.mean, 7);
  assert.equal(result.latency.ui_received_dom_ms.mean, 30);
  assert.equal(result.latency.ui_dom_service_ack_ms.mean, 9);
  assert.equal(result.latency.render_timer_late_ms.mean, 5);
  assert.equal(result.latency.service_flush_timer_late_ms.mean, 4);
  assert.equal(result.latency_by_interval.ui_received_dom_ms[0].to_ms, 5000);
  assert.equal(result.plotted.ui_fifo_items.at(-1).value, 4);
});

test('report reconciles UI totals through the final drain after the session disappears', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-chat-totals-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(path.join(folder, 'execucao.json'), JSON.stringify({ duration_ms: 60_000, fast_ms: 5000 }));
  const chats = [
    { session: 'chat', received: 8, presented: 7, counts: { received_unique: 8 } },
    { session: 'chat', received: 9341, presented: 9210, counts: { received_unique: 9341 } },
    { session: null, received: 9853, presented: 9853 }
  ];
  const rows = chats.map((chat, index) => ({
    type: 'chat', scheduled_ms: index * 30_000, elapsed_ms: index * 30_000, sample: { page: 1, chat }
  }));
  await writeFile(path.join(folder, 'samples.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
  await summarize(folder);
  const summary = JSON.parse(await readFile(path.join(folder, 'summary.json'), 'utf8'));
  assert.equal(summary.chat.received_unique, 9845);
  assert.equal(summary.chat.inserted, 9846);
  const report = await readFile(path.join(folder, 'resumo.md'), 'utf8');
  assert.match(report, /Mensagens únicas recebidas pela UI · 9845/);
  assert.match(report, /Mensagens inseridas no DOM · 9846/);
});

test('legacy samples and consolidated files generate the same report without duplicating event data', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-archive-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(path.join(folder, 'execucao.json'), JSON.stringify({ duration_ms: 10000, fast_ms: 5000 }));
  await writeFile(path.join(folder, 'eventos.jsonl'), '{"kind":"eventos_perdidos","count":2}\n');
  await writeFile(path.join(folder, 'amostra-0000.json'), JSON.stringify({
    scheduled_ms: 0, elapsed_ms: 0, sample: { service_status: 'ok', player: { buffering_count: 0 } }
  }));
  await summarize(folder);
  const before = await readFile(path.join(folder, 'resumo.md'), 'utf8');
  await archive(folder, false);
  const files = await readdir(folder);
  assert.ok(!files.includes('amostra-0000.json'));
  assert.equal((await readRows(folder, files))[0].type, 'amostra');
  assert.equal(await readFile(path.join(folder, 'events.jsonl'), 'utf8'),
    await readFile(path.join(folder, 'eventos.jsonl'), 'utf8'));
  await summarize(folder);
  assert.equal(await readFile(path.join(folder, 'resumo.md'), 'utf8'), before);
  assert.equal(JSON.parse(await readFile(path.join(folder, 'summary.json'), 'utf8')).inspector.lost_events, 2);
  assert.match(await readFile(path.join(folder, 'graficos.html'), 'utf8'), /Telemetria KickTV/);
});

test('service load peaks use second-aligned windows without retaining messages', () => {
  const { Load } = require('../service/fifo-common.js');
  let now = 100;
  const load = new Load({ mono: () => now });
  load.add(0, 2, 120);
  load.add(0, 4, 1140);
  load.add(2, 3, 1150);
  load.add(0, 10, 6100);
  load.add(0, 1, 68100);
  now = 69100;
  const result = load.snapshot();
  assert.deepEqual(result.peaks, [[10, 0, 3], [10, 0, 3], [16, 0, 3]]);
  assert.equal(result.recent_1s.length, 30);
  assert.deepEqual(result.recent_1s.at(-1), [68, 1, 0, 0]);
});

test('WebSocket authorization report preserves announced TTL, renewal and next expiry', () => {
  const expiration = '2026-11-21T22:00:00.000Z';
  const service = { authorization: { ttl_seconds: 3600, renewal_required: true, active: true,
    expires_at_ms: Date.parse(expiration) }, renewal: { attempts: 1, status: 'confirmed' } };
  assert.deepEqual(observedAuthorization([{ sample: { service } }]), {
    ttl_seconds: 3600, renewal_required: true, renewal_attempted: true, renewal_result: 'sucesso',
    next_expiration_utc: expiration, last_expiration_utc: expiration, connection_active: true
  });
  service.authorization.active = false;
  const closed = observedAuthorization([{ sample: { service } }]);
  assert.equal(closed.next_expiration_utc, null);
  assert.equal(closed.last_expiration_utc, expiration);
  assert.equal(observedAuthorization([]).renewal_attempted, null);
});

test('screenshots crop to the visible chat panel and skip hidden chat', () => {
  const window = { innerWidth: 1920, innerHeight: 1080, scrollX: 0, scrollY: 0 };
  const rect = { left: 1440.25, top: 0, right: 1921, bottom: 1081 };
  const panel = { hidden: false, getBoundingClientRect: () => rect };
  const document = { hidden: false, getElementById: id => id === 'chat-panel' ? panel : null };
  const clip = () => runInNewContext(`(${screenshotClip})()`, { document, window });
  assert.deepEqual({ ...clip() }, { x: 1441, y: 0, width: 479, height: 1080, scale: 1 });
  panel.hidden = true;
  assert.equal(clip(), null);
  panel.hidden = false;
  rect.left = rect.right;
  assert.equal(clip(), null);
});

test('screenshot cadence merges events, preserves output paths and handles unavailable captures', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-screenshots-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const events = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const shots = createScreenshots(folder, async () => jpeg, event => events.push(event), () => 100);
  await shots.checkpoint(0);
  await shots.checkpoint(5000);
  shots.observe({ kind: 'chat_state', state: 'Error' });
  shots.observe({ kind: 'lease_refresh_failed' });
  await shots.checkpoint(5000);
  await shots.checkpoint(15000);
  await shots.checkpoint(60000);
  await shots.checkpoint(70000, true);
  assert.deepEqual(events.map(e => e.triggers), [['inicio'], ['chat_error', 'lease_refresh_failed'], ['periodica'], ['fim']]);
  assert.deepEqual(await readdir(path.join(folder, 'screenshots')), [
    '0001-0000000000.jpg', '0002-0000015000.jpg', '0003-0000060000.jpg', '0004-0000070000.jpg'
  ]);
  const failures = [];
  const unavailable = createScreenshots(folder, async () => { throw Error('consulta_falhou'); }, event => failures.push(event));
  await unavailable.checkpoint(0);
  await unavailable.checkpoint(60000);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'consulta_falhou');
});

test('resumo links only local screenshots in the graph gallery', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-gallery-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(path.join(folder, 'execucao.json'), JSON.stringify({ duration_ms: 60000 }));
  await writeFile(path.join(folder, 'events.jsonl'), [
    { kind: 'screenshot_salvo', file: 'screenshots/0001-0000060000.jpg', elapsed_ms: 60000, triggers: ['periodica'] },
    { kind: 'screenshot_salvo', file: '../private.jpg', elapsed_ms: 120000 }
  ].map(event => JSON.stringify(event)).join('\n'));
  await summarize(folder);
  const html = await readFile(path.join(folder, 'graficos.html'), 'utf8');
  const data = JSON.parse(html.match(/<script type="application\/json" id="data">(.+?)<\/script>/)[1]);
  assert.deepEqual(data.screenshots, [{ file: 'screenshots/0001-0000060000.jpg', ms: 60000, triggers: ['periodica'] }]);
});


test('Inspector browser URL uses the server IP while the collector uses its local tunnel', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'http://localhost:38754/json/list');
    return Response.json([{
      url: 'file:///apps/com.kicktv.alpha/native-hls.html',
      devtoolsFrontendUrl: '/devtools/inspector.html?ws=localhost:9998/devtools/page/a&panel=console'
    }]);
  });
  const result = await inspectorUrl(38754, new AbortController().signal);
  assert.equal(result.websocket, 'ws://localhost:38754/devtools/page/a');
  const browser = new URL(result.browser);
  assert.equal(browser.origin, 'http://192.168.3.8:38754');
  assert.equal(browser.pathname, '/devtools/inspector.html');
  assert.equal(browser.searchParams.get('ws'), '192.168.3.8:38754/devtools/page/a');
  assert.equal(browser.searchParams.get('panel'), 'console');
  assert.equal(fetch.mock.callCount(), 1);
});
