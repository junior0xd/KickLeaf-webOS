'use strict';

// These functions are serialized and evaluated in the KickTV document.
function installProbe(key, binding) {
  if (window[key]) return true;
  if (!window.KickNativeDiagnostics || !window.KickChatUI) return false;
  const home = document.getElementById('home');
  const input = document.getElementById('channel');
  const host = document.getElementById('native-video-host');
  const chatLabel = document.getElementById('chat-state');
  const chatRows = document.getElementById('chat-messages');
  if (!home || !input || !host || !chatLabel || !chatRows) return false;

  const buffered = [];
  const unsubscribe = [];
  let dropped = 0;
  let channel = null;
  let selected = null;
  let firstVideo = null;
  let chatReady = null;
  let stream = 0;
  let video = null;
  let chatState;
  let chatBatch = 0;
  let chatTimer;
  let frameRequest;
  let frameTimeout;
  let renderFps = null;
  let probeTimeout;

  function emit(kind, fields = {}) {
    const event = { kind, tv_ms: performance.now(), ...fields };
    if (binding && typeof window[binding] === 'function') {
      try { window[binding](JSON.stringify(event)); return; } catch { /* Buffer for the next read. */ }
    }
    if (buffered.length === 200) { buffered.shift(); dropped++; }
    buffered.push(event);
  }

  function listen(target, name, fn, capture = false) {
    target.addEventListener(name, fn, capture);
    unsubscribe.push(() => target.removeEventListener(name, fn, capture));
  }

  function attach() {
    const next = host.querySelector('video');
    if (video === next) return;
    video = next;
    if (video) stream++;
    emit(video ? 'video_attached' : 'video_removed', { stream });
  }
  const videoObserver = new MutationObserver(attach);
  videoObserver.observe(host, { childList: true });
  attach();
  listen(window, 'kicktv-channel-selected', event => {
    channel = event.detail.channel;
    selected = performance.now();
    firstVideo = null;
    chatReady = null;
    emit('channel_selected');
  });
  listen(window, 'kicktv-channel-left', () => emit('channel_left'));
  const mediaEvents = ['playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'error', 'ended'];
  for (const kind of mediaEvents) {
    listen(host, kind, event => {
      if (event.target.tagName !== 'VIDEO') return;
      attach();
      if (kind === 'playing') firstVideo ??= performance.now();
      emit(kind, { stream, position: video?.currentTime ?? null, code: event.target.error?.code ?? null });
    }, true);
  }
  listen(window, 'online', () => emit('network_online'));
  listen(window, 'offline', () => emit('network_offline'));

  const chatStates = {
    Desabilitado: 'Idle', Conectando: 'Connecting', 'Assinando sala': 'Subscribing',
    Conectado: 'Connected', Encerrando: 'Closing', Encerrado: 'Closed', 'Chat indisponível': 'Error',
    'Chat interrompido por sobrecarga': 'Error'
  };
  function readChatState() {
    const next = chatStates[chatLabel.textContent] ?? 'Unknown';
    if (next === chatState) return;
    chatState = next;
    if (next === 'Connected') chatReady ??= performance.now();
    emit('chat_state', { state: next });
  }
  const chatObserver = new MutationObserver(readChatState);
  chatObserver.observe(chatLabel, { childList: true, characterData: true, subtree: true });
  readChatState();
  function flushChat() {
    clearTimeout(chatTimer);
    chatTimer = undefined;
    if (chatBatch) emit('chat_batch', { dom_inserted: chatBatch });
    chatBatch = 0;
  }
  const rowObserver = new MutationObserver(records => {
    for (const record of records) chatBatch += record.addedNodes.length;
    if (chatBatch && chatTimer === undefined) chatTimer = setTimeout(flushChat, 1000);
  });
  rowObserver.observe(chatRows, { childList: true });

  // Observe animation cadence for a short burst between reads.
  function measureFrames() {
    if (frameTimeout !== undefined || !window.requestAnimationFrame || document.hidden) return;
    let first;
    let last;
    let count = 0;
    function tick(time) {
      first ??= time;
      last = time;
      count++;
      frameRequest = requestAnimationFrame(tick);
    }
    frameRequest = requestAnimationFrame(tick);
    frameTimeout = setTimeout(() => {
      cancelAnimationFrame(frameRequest);
      frameTimeout = undefined;
      renderFps = !document.hidden && count > 1 && last > first ? (count - 1) * 1000 / (last - first) : null;
    }, 450);
  }

  function armCleanup() {
    clearTimeout(probeTimeout);
    probeTimeout = setTimeout(() => window[key]?.stop(), 25_000);
  }

  window[key] = {
    read(measure) {
      armCleanup();
      attach();
      const p = window.KickNativeDiagnostics.snapshot();
      if (!home.hidden) channel = null;
      else if (!channel) {
        try { channel = window.KickChannel.normalizeChannel(input.value); } catch { /* No selected channel yet. */ }
      }
      const fps = renderFps;
      if (measure && p) measureFrames();
      const gaps = dropped;
      dropped = 0;
      return {
        page: performance.timeOrigin, stream, channel, tv_ms: performance.now(), home: !home.hidden,
        home_message: !home.hidden ? document.getElementById('message')?.textContent : null,
        selected_ms: selected, first_video_ms: firstVideo, chat_ready_ms: chatReady,
        player: p && {
          state: p.state, paused: p.paused, ready_state: p.ready_state,
          media_time_seconds: video?.currentTime ?? null, error_code: video?.error?.code ?? null,
          buffering_count: p.buffering_count, buffering_seconds: p.buffering_seconds,
          buffered_ahead_seconds: p.buffered_ahead_seconds, quality: p.quality,
          nominal_bitrate: p.nominal_bitrate, live_edge_gap_seconds: p.live_edge_gap_seconds,
          effective_bitrate: null, absolute_latency_seconds: null, width: p.width, height: p.height,
          total_frames: p.total_frames, dropped_frames: p.dropped_frames, reported_fps: p.observed_presented_fps
        },
        ui: { raf_fps: fps, js_heap_used_bytes: performance.memory?.usedJSHeapSize ?? null },
        chat: { state: chatState, enabled: window.KickChatUI.visible() },
        events: buffered.splice(0), dropped_events: gaps
      };
    },
    stop() {
      clearTimeout(probeTimeout);
      rowObserver.disconnect();
      chatObserver.disconnect();
      videoObserver.disconnect();
      unsubscribe.forEach(fn => fn());
      if (frameRequest !== undefined) cancelAnimationFrame(frameRequest);
      clearTimeout(frameTimeout);
      flushChat();
      delete window[key];
      return buffered.splice(0);
    }
  };
  armCleanup();
  return true;
}

function startStream(channel) {
  const home = document.getElementById('home');
  const input = document.getElementById('channel');
  const button = document.getElementById('watch');
  if (!home || home.hidden || !input || !button || button.disabled) return false;
  input.value = channel;
  button.click();
  return true;
}

function enableChat() {
  const button = document.getElementById('native-theater');
  if (!button || button.disabled || !window.KickChatUI) return false;
  if (!window.KickChatUI.visible()) button.click();
  return window.KickChatUI.visible();
}

function chatBound() {
  const chat = window.KickChatUI?.snapshot();
  return chat?.state === 'Connected' && chat.delivery?.ticket != null;
}

async function readSlow(serviceUri) {
  const j = window.KickJointDiagnostics?.snapshot();
  if (!j) return null;
  const chat = j.chat;
  const result = {
    page: performance.timeOrigin,
    ui: j.ui,
    chat: {
      session: chat.session_id, state: chat.state, presented: chat.presented,
      received: chat.received, dom_rows: chat.dom_rows, batches: chat.batches,
      render_ms_total: chat.render_ms_total, render_ms_max: chat.render_ms_max,
      counts: chat.delivery?.counts, queue: chat.delivery?.queue,
      render_batch_ms: chat.delivery?.h?.render_batch_ms,
      emotes: chat.images?.counts, badges: chat.badges?.counts
    },
    service: null, service_status: 'not_requested'
  };
  if (!chat.enabled && !chat.last && !chat.consumer) return result;
  const reply = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 2500);
    function done(value) { clearTimeout(timer); resolve(value); }
    try {
      webOS.service.request(serviceUri, {
        method: 'status', parameters: {},
        onSuccess: reply => done(reply.returnValue ? reply : null),
        onFailure: () => done(null)
      });
    } catch { done(null); }
  });
  const c = reply?.capabilities;
  if (!c) return { ...result, service_status: 'unavailable' };
  const s = c.snapshot.session;
  result.service_status = 'ok';
  result.version = c.version;
  result.service = s && {
    version: c.version, runtime: c.supported_runtime,
    instance: c.instance, session: c.snapshot.session_id, status: s.status,
    started_at: s.started_at, reading_at: s.reading_at, ended_at: s.ended_at,
    reason: s.reason, error: s.error, messages: s.messages, duplicates: s.duplicates,
    counts: s.delivery.counts, queue: s.delivery.queue, delivery_state: s.delivery.state,
    socket: s.resources.socket, memory: s.memory,
    network: {
      websocket: {
        dns: s.metrics.network.dns, tls: s.metrics.network.tls,
        tcp_established: s.metrics.network.tcp_established,
        upgrade_status: s.metrics.network.upgrade_status, close_code: s.metrics.network.close_code
      },
      frames: s.metrics.phases.F?.frames_received,
      bytes: s.metrics.phases.F?.ws_payload_rx,
      http: s.metrics.http.map(item => ({
        phase: item.phase, status: item.status, elapsed_ms: item.elapsed_ms,
        response_bytes: item.response_bytes
      }))
    }
  };
  result.history = (reply.history || []).filter(e => [
    'opening_wss', 'protocol_connected', 'subscribed', 'server_disconnect',
    'closing', 'stopped', 'reading'
  ].includes(e.kind)).map(({ kind, at, session_id }) => ({ kind, at, session_id }));
  return result;
}

module.exports = { installProbe, startStream, enableChat, chatBound, readSlow };
