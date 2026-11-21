'use strict';

const { execFile, spawn } = require('node:child_process');
const { appendFile, mkdir, mkdtemp, rename, writeFile } = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { parseArgs, promisify } = require('node:util');

const APP = 'com.kicktv.alpha';
const SERVICE = APP + '.service';
const { version: VERSION } = require('../app/appinfo.json');
const { installProbe, startStream, enableChat, chatBound, readSlow } = require('./collector/page.cjs');
const { summarize } = require('./collector/report.cjs');
const FAST_MS = 5_000;
const SLOW_MS = 30_000;
const STARTUP_MS = 60_000;
const WAIT_MS = 2_000;
const IO_MS = 8_000;
const exec = promisify(execFile);
const { KICK_API_TOKEN: apiToken, ...cliEnv } = process.env;
let nextRequestId = 0;

function options(args) {
  const { values } = parseArgs({
    args,
    options: {
      device: { type: 'string', default: 'lgc3' },
      mode: { type: 'string', default: 'manual' },
      streamer: { type: 'string' },
      length: { type: 'string', default: '10' },
      output: { type: 'string', default: 'coletas' },
      summarize: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  const minutes = Number(values.length);
  const duration = Math.round(minutes * 60_000);
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new Error('--length precisa ser um número positivo em minutos (ex.: 10 ou 0.5).');
  }
  if (!['manual', 'automatic'].includes(values.mode)) {
    throw new Error('--mode precisa ser manual ou automatic.');
  }
  const streamer = values.streamer?.trim().toLowerCase();
  if (values.mode === 'automatic' && !/^[a-z0-9][a-z0-9_]{0,24}$/.test(streamer ?? '')) {
    throw new Error('Informe --streamer com um nome de canal aceito pelo chat do KickTV.');
  }
  if (values.mode === 'manual' && values.streamer !== undefined) {
    throw new Error('--streamer é usado com --mode=automatic.');
  }
  return { ...values, streamer, duration };
}

async function isRunning(device, signal) {
  const launch = require.resolve('@webos-tools/cli/bin/ares-launch.js');
  const { stdout } = await exec(process.execPath, [launch, '--device', device, '--running'], {
    timeout: IO_MS, signal, env: cliEnv
  });
  return stdout.split(/\r?\n/).some(line => line.trim().split(' - display ')[0] === APP);
}

// Run the pinned CLI API in a child so killing it releases its tunnel and HTTP server.
// The API's running option skips the CLI's implicit app launch.
function startTunnel(device) {
  const inspector = require.resolve('@webos-tools/cli/APIs.js');
  const code = `
    const { Inspector } = require(process.argv[1]);
    Inspector.inspect({ device: process.argv[2], appId: process.argv[3], running: true, open: false })
      .then(({ session }) => console.log('KICKTV_PORT=' + session.getLocalPortByName(process.argv[3])))
      .catch(() => process.exit(1));
  `;
  return spawn(process.execPath, ['-e', code, inspector, device, APP], {
    stdio: ['ignore', 'pipe', 'ignore'], env: cliEnv
  });
}

async function tunnelPort(child, signal) {
  let output = '';
  let port;
  let failed = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output = (output + chunk).slice(-4096);
    const match = output.match(/KICKTV_PORT=(\d+)\r?\n/);
    if (match) port = Number(match[1]);
  });
  child.on('error', () => { failed = true; });
  const deadline = performance.now() + 20_000;
  while (!port && !failed && child.exitCode === null && performance.now() < deadline) {
    await delay(100, undefined, { signal });
  }
  if (!port) throw new Error('Não foi possível abrir o túnel do Inspector.');
  return port;
}

async function inspectorUrl(port, signal) {
  for (const route of ['/json/list', '/pagelist.json']) {
    try {
      const response = await fetch(`http://localhost:${port}${route}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(IO_MS)]), redirect: 'error'
      });
      if (!response.ok) continue;
      const targets = await response.json();
      const target = targets.find(item => {
        const documentUrl = typeof item.url === 'string' ? item.url.split(/[?#]/)[0] : '';
        return documentUrl.includes(`/${APP}/`) && documentUrl.endsWith('/native-hls.html');
      });
      if (!target) continue;
      const frontend = target.devtoolsFrontendUrl || target.inspectorUrl || '';
      const endpoint = target.webSocketDebuggerUrl || new URL(frontend, 'http://localhost').searchParams.get('ws');
      if (!endpoint) continue;
      const remote = new URL(endpoint.startsWith('ws://') ? endpoint : `ws://${endpoint}`);
      if (remote.protocol === 'ws:' && remote.pathname.startsWith('/devtools/page/')) {
        const base = `http://localhost:${port}`;
        const browser = frontend ? new URL(new URL(frontend, base).pathname, base) : new URL(base);
        if (frontend) browser.searchParams.set('ws', `localhost:${port}${remote.pathname}`);
        return { websocket: `ws://localhost:${port}${remote.pathname}`, browser: browser.href };
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  return null;
}

async function openInspector(port, signal) {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    const url = await inspectorUrl(port, signal);
    if (url) return url;
    await delay(WAIT_MS, undefined, { signal });
  }
  throw new Error('O Inspector não encontrou native-hls.html do KickTV Alpha.');
}

function command(socket, method, params, signal, timeout = IO_MS) {
  return new Promise((resolve, reject) => {
    const id = ++nextRequestId;
    const timer = setTimeout(() => fail('consulta_expirada'), timeout);
    function cleanup() {
      clearTimeout(timer);
      socket.removeEventListener('open', send);
      socket.removeEventListener('message', receive);
      socket.removeEventListener('close', unavailable);
      socket.removeEventListener('error', unavailable);
      signal.removeEventListener('abort', abort);
    }
    function fail(code) {
      cleanup();
      reject(new Error(code));
    }
    function unavailable() { fail('inspector_desconectado'); }
    function abort() { fail('coleta_cancelada'); }
    function send() {
      try { socket.send(JSON.stringify({ id, method, params })); }
      catch { unavailable(); }
    }
    function receive(event) {
      let response;
      try {
        response = JSON.parse(event.data);
      } catch {
        return fail('resposta_invalida');
      }
      if (response.id !== id) return;
      if (response.error || !response.result || response.result.exceptionDetails) {
        return fail('consulta_falhou');
      }
      cleanup();
      resolve(response.result);
    }
    socket.addEventListener('message', receive);
    socket.addEventListener('close', unavailable);
    socket.addEventListener('error', unavailable);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (socket.readyState === WebSocket.OPEN) send();
    else if (socket.readyState === WebSocket.CONNECTING) socket.addEventListener('open', send, { once: true });
    else unavailable();
  });
}

async function evaluate(socket, expression, signal, timeout) {
  const reply = await command(socket, 'Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  }, signal, timeout);
  return reply.result?.value;
}

function call(fn, ...args) {
  return `(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`;
}

function folderPrefix(channel, date) {
  const pad = n => String(n).padStart(2, '0');
  const slug = /^[a-z0-9_-]{1,25}$/.test(channel) ? channel : 'canal-desconhecido';
  return `${slug}_${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}_${pad(date.getHours())}${pad(date.getMinutes())}-`;
}

async function writeJson(folder, filename, value) {
  const file = path.join(folder, filename);
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(file + '.tmp', file);
}

function recordEvents(socket, binding) {
  const pending = [];
  let file;
  let writing = Promise.resolve();
  let error;
  let dropped = 0;
  function record(event) {
    const entry = { host_utc: new Date().toISOString(), ...event };
    if (!file) {
      if (pending.length === 512) { pending.shift(); dropped++; }
      pending.push(entry);
      return;
    }
    writing = writing.then(() => appendFile(file, JSON.stringify(entry) + '\n')).catch(failure => {
      error ??= failure;
    });
  }
  function onMessage(event) {
    try {
      const { method, params } = JSON.parse(event.data);
      if (method === 'Runtime.bindingCalled' && params.name === binding) {
        record(JSON.parse(params.payload));
      } else if (method === 'Runtime.exceptionThrown') {
        const info = params.exceptionDetails;
        record({ kind: 'js_exception', line: info.lineNumber, column: info.columnNumber });
      } else if (method === 'Runtime.executionContextsCleared') {
        record({ kind: 'inspector_context_cleared' });
      }
    } catch { /* Ignore messages outside the selected event stream. */ }
  }
  const onClose = () => record({ kind: 'inspector_disconnected' });
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  return {
    record,
    start(folder) {
      file = path.join(folder, 'eventos.jsonl');
      if (dropped) record({ kind: 'eventos_perdidos', count: dropped });
      pending.splice(0).forEach(record);
    },
    async flush() {
      await writing;
      if (error) throw new Error('Não foi possível gravar eventos: ' + error.message);
    },
    stop() {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    }
  };
}

function absorbEvents(sample, events) {
  if (!sample) return sample;
  const { events: pending, dropped_events: dropped, ...fields } = sample;
  for (const event of pending || []) events.record(event);
  if (dropped) events.record({ kind: 'eventos_perdidos', count: dropped });
  return fields;
}

async function prepareTv(config, signal) {
  let checked = false;
  console.log('Aguardando a TV responder.');
  while (true) {
    let running;
    try {
      running = await isRunning(config.device, signal);
    } catch {
      signal.throwIfAborted();
      await delay(WAIT_MS, undefined, { signal });
      continue;
    }
    if (!checked && running) {
      console.log('O KickTV Alpha já está aberto. Feche o app e execute o coletor novamente.');
      return false;
    }
    if (running) return true;
    if (!checked && config.mode === 'automatic') {
      const launch = require.resolve('@webos-tools/cli/bin/ares-launch.js');
      await exec(process.execPath, [launch, '--device', config.device, APP], {
        signal, timeout: 20_000, env: cliEnv
      });
      return true;
    }
    if (!checked) console.log('Aguardando abrir o KickTV Alpha na TV...');
    checked = true;
    await delay(WAIT_MS, undefined, { signal });
  }
}

async function waitForPlayback(read, control, config, signal) {
  const automatic = config.mode === 'automatic';
  if (automatic && !await control(startStream, config.streamer)) {
    throw new Error('Não foi possível selecionar a transmissão na tela inicial.');
  }
  const deadline = automatic ? performance.now() + STARTUP_MS : Infinity;
  let previous;
  let chatRequested = false;
  while (performance.now() < deadline) {
    const sample = await read(false);
    const player = sample?.player;
    const advancing = player?.state === 'playing' && !player.paused && player.ready_state >= 2 && !player.error_code &&
      previous?.page === sample.page && previous.stream === sample.stream &&
      previous.player?.state === 'playing' && player.media_time_seconds > previous.player.media_time_seconds;
    if (automatic && sample?.home && sample.home_message) {
      throw new Error(`KickTV voltou à tela inicial: ${sample.home_message}`);
    }
    if (automatic && chatRequested && ['Error', 'Closed'].includes(sample?.chat?.state)) {
      throw new Error('O chat não ficou disponível.');
    }
    if (advancing && (!automatic || (sample.chat.state === 'Connected' && await control(chatBound)))) return sample;
    if (automatic && advancing && !chatRequested) {
      if (!await control(enableChat)) throw new Error('Não foi possível abrir o chat da transmissão.');
      chatRequested = true;
    }
    previous = sample;
    await delay(WAIT_MS, undefined, { signal });
  }
  throw new Error('O vídeo e o chat não ficaram prontos dentro de 60 segundos.');
}

function streamMetadata(channel, token) {
  let retryAt = 0;
  let refusal;
  return async signal => {
    if (!token) return { status: 'sem_token' };
    if (refusal) return { status: refusal };
    if (!channel) return { status: 'canal_indisponivel' };
    if (Date.now() < retryAt) return { status: 'aguardando_retry_after' };
    try {
      const url = new URL('https://api.kick.com/public/v1/channels');
      url.searchParams.set('slug', channel);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4000)])
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) refusal = `http_${response.status}`;
        if (response.status === 429) {
          const header = response.headers.get('retry-after');
          const seconds = Number(header);
          retryAt = header && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(header);
          if (!Number.isFinite(retryAt) || retryAt <= Date.now()) retryAt = Date.now() + SLOW_MS * 2;
        }
        await response.body?.cancel();
        return { status: `http_${response.status}` };
      }
      const body = await response.json();
      const info = Array.isArray(body.data) && body.data.find(item => item.slug === channel);
      if (!info) return { status: 'canal_indisponivel' };
      return {
        status: 'ok', viewers: info.stream?.viewer_count ?? null, title: info.stream_title ?? null,
        category: info.category?.name ?? null, live: info.stream?.is_live ?? null,
        started_at: info.stream?.start_time ?? null, language: info.stream?.language ?? null
      };
    } catch {
      return { status: signal.aborted ? 'cancelado' : 'api_indisponivel' };
    }
  };
}

async function collect({ folder, duration, start, started, read, slowRead, metadata, events, signal,
  fastMs = FAST_MS, slowMs = SLOW_MS }) {
  let result = 'completa';
  let slowFailure = false;
  let metadataWrite;
  let nextSlow = 0;
  let lastMetadataAt = -Infinity;
  const history = new Set();
  const elapsed = () => Math.round(performance.now() - started);
  async function checkpoint(name, scheduled, readSample, reused = false) {
    const readStarted = performance.now();
    let sample = null;
    let error = null;
    try {
      sample = await readSample();
      if (!sample) error = 'diagnostico_indisponivel';
    } catch (failure) {
      error = failure.message;
    }
    const row = {
      utc: new Date().toISOString(), scheduled_ms: scheduled, elapsed_ms: elapsed(),
      inspector_ms: reused ? null : Math.round(performance.now() - readStarted), sample, error
    };
    await writeJson(folder, name, row);
    return row;
  }
  try {
    for (let scheduled = 0; ; scheduled = Math.min(scheduled + fastMs, duration)) {
      const remaining = scheduled - elapsed();
      if (remaining > 0) await delay(remaining, undefined, { signal });
      signal.throwIfAborted();
      const key = String(scheduled).padStart(10, '0');
      const fast = await checkpoint(`player-${key}.json`, scheduled, async () => {
        const sample = scheduled === 0 ? start : await read();
        if (sample && sample.page !== start.page) throw new Error('pagina_reiniciada');
        if (sample && (sample.stream !== start.stream || !sample.player)) {
          throw new Error('reproducao_encerrada_ou_trocada');
        }
        if (!sample) return sample;
        const { home_message, ...fields } = sample;
        return fields;
      }, scheduled === 0);
      if (signal.aborted) return 'interrompida pelo operador';
      if (['pagina_reiniciada', 'reproducao_encerrada_ou_trocada', 'inspector_desconectado'].includes(fast.error)) {
        events.record({ kind: fast.error });
        return `incompleta (${fast.error})`;
      }
      if (fast.error) result = 'incompleta (lacunas de coleta)';
      if (scheduled >= nextSlow || scheduled === duration) {
        nextSlow = scheduled + slowMs;
        if (scheduled - lastMetadataAt >= slowMs) {
          if (metadataWrite) await metadataWrite;
          lastMetadataAt = scheduled;
          metadataWrite = (async () => {
            const sample = await metadata(signal);
            await writeJson(folder, `metadados-${key}.json`, {
              scheduled_ms: scheduled, elapsed_ms: elapsed(), utc: new Date().toISOString(), sample
            });
          })().catch(error => { events.record({ kind: 'erro_gravacao_metadados', code: error.code }); slowFailure = true; });
        }
        const slow = await checkpoint(`chat-${key}.json`, scheduled, slowRead);
        if (slow.error) slowFailure = true;
        for (const event of slow.sample?.history ?? []) {
          const id = `${event.session_id}:${event.at}:${event.kind}`;
          if (!history.has(id)) events.record({ ...event, origin: 'servico_chat' });
          history.add(id);
        }
        if (history.size > 240) {
          for (const id of history) {
            if (history.size <= 120) break;
            history.delete(id);
          }
        }
      }
      if (signal.aborted) return 'interrompida pelo operador';
      if (scheduled === duration) break;
      // Preserve planned timestamps and skip missed slots instead of sending bursts.
      if (elapsed() >= scheduled + 2 * fastMs) {
        scheduled = Math.min(Math.floor(elapsed() / fastMs) * fastMs - fastMs, duration - fastMs);
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    return 'interrompida pelo operador';
  } finally {
    if (metadataWrite) await metadataWrite;
  }
  return slowFailure ? 'incompleta (lacunas de coleta)' : result;
}

async function capture(config, signal) {
  if (!await prepareTv(config, signal)) return;
  const child = startTunnel(config.device);
  const key = '__kicktvProbe_' + randomBytes(6).toString('hex');
  const binding = key + '_event';
  let socket;
  let events;
  let installed = false;
  let eventStreaming = false;
  let runtimeEvents = false;
  let folder;
  let meta;
  let result;
  try {
    const port = await tunnelPort(child, signal);
    const target = await openInspector(port, signal);
    console.log(`Inspector (mesmo computador) ${target.browser}`);
    console.log('A conexão simultânea pelo navegador ainda precisa ser confirmada na C3.');
    socket = new WebSocket(target.websocket);
    events = recordEvents(socket, binding);
    try {
      await command(socket, 'Runtime.enable', {}, signal);
      runtimeEvents = true;
      await command(socket, 'Runtime.addBinding', { name: binding }, signal);
      eventStreaming = true;
    } catch { signal.throwIfAborted(); }
    const control = (fn, ...args) => evaluate(socket, call(fn, ...args), signal);
    const setupDeadline = performance.now() + IO_MS;
    while (!installed) {
      installed = await control(installProbe, key, eventStreaming ? binding : null);
      if (installed) break;
      if (performance.now() >= setupDeadline) throw new Error('Diagnósticos do KickTV indisponíveis na página.');
      await delay(250, undefined, { signal });
    }
    const read = async (measure = true) => {
      const sample = await evaluate(socket, `window[${JSON.stringify(key)}]?.read(${measure}) ?? null`, signal);
      if (!sample) {
        const page = await evaluate(socket, 'performance.timeOrigin', signal);
        if (Number.isFinite(page)) return { page };
      }
      return absorbEvents(sample, events);
    };
    if (config.mode === 'manual') console.log('Selecione uma transmissão na TV.');
    const start = await waitForPlayback(read, control, config, signal);
    const date = new Date();
    const started = performance.now();
    const root = path.resolve(config.output);
    await mkdir(root, { recursive: true });
    folder = await mkdtemp(path.join(root, folderPrefix(start.channel || config.streamer, date)));
    events.start(folder);
    events.record({ kind: 'inicio_coleta', tv_ms: start.tv_ms });
    console.log(`Coletando por ${config.duration / 60_000} min em ${folder}`);
    meta = {
      schema: 2, app: APP, expected_version: VERSION, channel: start.channel || config.streamer,
      mode: config.mode, duration_ms: config.duration, started_utc: date.toISOString(), fast_ms: FAST_MS, slow_ms: SLOW_MS,
      event_delivery: eventStreaming ? 'inspector' : 'buffer_em_amostras',
      runtime_events: runtimeEvents, api_configured: Boolean(apiToken),
      result: 'interrompida sem conclusão'
    };
    await writeJson(folder, 'execucao.json', meta);
    result = await collect({
      folder, duration: config.duration, start, started, signal, events,
      read,
      slowRead: () => control(readSlow, 'luna://' + SERVICE),
      metadata: streamMetadata(meta.channel, apiToken)
    });
  } finally {
    if (installed && socket?.readyState === WebSocket.OPEN) {
      const cleanup = AbortSignal.timeout(2000);
      try {
        const drained = await evaluate(socket, `window[${JSON.stringify(key)}]?.stop() ?? []`, cleanup, 1500);
        for (const event of drained || []) events.record(event);
        if (eventStreaming) await command(socket, 'Runtime.removeBinding', { name: binding }, cleanup, 500);
      } catch { events.record({ kind: 'limpeza_probe_nao_confirmada' }); }
    }
    events?.stop();
    socket?.close();
    child.kill();
    if (folder && meta) {
      events.record({ kind: 'fim_coleta', result: result || 'incompleta (falha operacional)' });
      let eventFailure;
      try { await events.flush(); } catch (error) { eventFailure = error; }
      await writeJson(folder, 'execucao.json', {
        ...meta, result: result || 'incompleta (falha operacional)', finished_utc: new Date().toISOString(),
        event_write_error: Boolean(eventFailure)
      });
      await summarize(folder);
      console.log(`Relatório salvo em ${path.join(folder, 'resumo.md')}`);
      if (eventFailure) throw eventFailure;
    }
  }
}

async function main() {
  const config = options(process.argv.slice(2));
  if (config.help) {
    console.log('node scripts/collect-tv.cjs [--device=lgc3] [--length=10] [--output=coletas]\n' +
      'node scripts/collect-tv.cjs --mode=automatic --streamer=baianotv --length=20\n' +
      'node scripts/collect-tv.cjs --summarize CAMINHO_DA_EXECUCAO\n' +
      '--length define a duração em minutos. Ctrl+C encerra a coleta.\n' +
      'KICK_API_TOKEN habilita metadados da API oficial da Kick no computador.');
    return;
  }
  if (config.summarize) return summarize(config.summarize);
  if (typeof WebSocket !== 'function') throw new Error('Use Node.js 22 ou mais recente.');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await capture(config, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.log('Coletor encerrado.');
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { collect, options, summarize, folderPrefix, streamMetadata };
