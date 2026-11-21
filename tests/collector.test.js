'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collect, folderPrefix, options, streamMetadata, summarize } = require('../scripts/collect-tv.cjs');

test('collector validates the automatic channel and names folders in local time', () => {
  assert.equal(options([]).mode, 'manual');
  assert.equal(options([]).duration, 600_000);
  assert.throws(() => options(['--mode=automatic']), /--streamer/);
  assert.throws(() => options(['--length=0']), /--length/);
  assert.throws(() => options(['--mode=automatic', '--streamer=../unsafe']), /--streamer/);
  assert.equal(options(['--mode=automatic', '--streamer=BaianoTV', '--length=20']).streamer, 'baianotv');
  assert.equal(folderPrefix('baianotv', new Date(2026, 10, 21, 14, 30)), 'baianotv_21-11-2026_1430-');
  assert.match(folderPrefix('../unsafe', new Date()), /^canal-desconhecido_/);
});

test('hybrid collection writes fast and slow snapshots and aggregates observed counter deltas', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-collector-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  let player = 0;
  let chat = 0;
  let metadata = 0;
  const readPlayer = () => ({
    page: 1, stream: 1, player: { state: 'playing', buffering_count: player++, buffered_ahead_seconds: 6 }
  });
  const readChat = () => ({
    service: { instance: 'instance', session: 'chat', counts: { confirmed: chat++ * 10 }, queue: { items: 2 } }
  });
  const result = await collect({
    folder, duration: 141, fastMs: 30, slowMs: 90, start: readPlayer(), started: performance.now(),
    read: readPlayer, slowRead: readChat, metadata: async () => { metadata++; return { status: 'sem_token' }; },
    events: { record() {} }, signal: new AbortController().signal
  });
  assert.equal(result, 'completa');
  assert.equal(metadata, 2);
  const files = await readdir(folder);
  assert.ok(files.includes('player-0000000141.json'));
  assert.deepEqual(files.filter(name => name.startsWith('chat-')), [
    'chat-0000000000.json', 'chat-0000000090.json', 'chat-0000000141.json'
  ]);
  await writeFile(path.join(folder, 'execucao.json'), JSON.stringify({ result, duration_ms: 141, fast_ms: 30 }));
  await summarize(folder);
  const report = await readFile(path.join(folder, 'resumo.md'), 'utf8');
  assert.match(report, /Mensagens confirmadas · 20/);
  assert.match(report, /Buffer adiante mínimo \/ médio \/ máximo observados · 6 \/ 6 \/ 6/);
});

test('partial collection preserves the first sample when the TV page restarts', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kicktv-collector-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const events = [];
  const result = await collect({
    folder, duration: 40, fastMs: 20, slowMs: 80, start: { page: 1, stream: 1, player: {} },
    started: performance.now(), read: () => ({ page: 2 }), slowRead: () => ({}),
    metadata: async () => ({}), events: { record: event => events.push(event.kind) },
    signal: new AbortController().signal
  });
  assert.equal(result, 'incompleta (pagina_reiniciada)');
  assert.deepEqual(events, ['pagina_reiniciada']);
  const initial = JSON.parse(await readFile(path.join(folder, 'player-0000000000.json'), 'utf8'));
  assert.equal(initial.sample.page, 1);
});

test('metadata is optional, reads only chosen fields and backs off on HTTP 429', async t => {
  const responses = [
    new Response(JSON.stringify({ data: [{
      slug: 'baianotv', stream_title: 'Ao vivo', category: { name: 'Jogos' },
      stream: { viewer_count: 123, is_live: true, url: 'fixture-do-not-export' }
    }] })),
    new Response(null, { status: 429, headers: { 'retry-after': '60' } })
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url.href, 'https://api.kick.com/public/v1/channels?slug=baianotv');
    assert.equal(request.headers.Authorization, 'Bearer fixture');
    return responses.shift();
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await streamMetadata('baianotv')(signal), { status: 'sem_token' });
  const read = streamMetadata('baianotv', 'fixture');
  const data = await read(signal);
  assert.equal(data.viewers, 123);
  assert.ok(!JSON.stringify(data).includes('fixture'));
  assert.equal((await read(signal)).status, 'http_429');
  assert.equal((await read(signal)).status, 'aguardando_retry_after');
  assert.equal(fetch.mock.callCount(), 2);
});
