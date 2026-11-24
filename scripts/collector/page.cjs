'use strict';

// These functions are serialized and evaluated in the KickLeaf document.
function installProbe(key, binding, rafWindowMs = 1000, fastMs = 5000) {
  if (window[key]) return true;
  if (!window.KickNativeDiagnostics || !window.KickChatUI) return false;
  const home = document.getElementById('home');
  const input = document.getElementById('channel');
  const host = document.getElementById('native-video-host');
  const chatLabel = document.getElementById('chat-state');
  const chatRows = document.getElementById('chat-messages');
  if (!home || !input || !host || !chatLabel || !chatRows) return false;

  let playbackMode = 'direct-hls';
  try {
    if (JSON.parse(window.PalmSystem?.launchParams || '{}').mode === 'native-hls') playbackMode = 'native-hls';
  } catch { /* KickLeaf falls back to Direct HLS. */ }
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
  let serviceState;
  let chatBatch = 0;
  let chatBatchStart;
  let chatTimer;
  let frameRequest;
  let frameTimeout;
  let frameWindow = null;
  let nextFrameWindow = 0;
  let taskCursor = null;
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
  listen(window, 'kicktv-view-mode', event => emit('view_mode', event.detail));
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
    const changed = next !== chatState;
    if (changed) {
      chatState = next;
      if (next === 'Connected') chatReady ??= performance.now();
      emit('chat_state', { state: next });
    }
    if (['Closing', 'Closed', 'Error'].includes(next)) {
      const last = window.KickChatUI.snapshot().last;
      if (!last) return;
      const state = {
        status: last.status ?? null, reason: last.reason ?? null, error: last.error ?? null,
        socket: last.resources?.socket ?? null
      };
      const serialized = JSON.stringify(state);
      if (serialized !== serviceState) {
        serviceState = serialized;
        emit('chat_service_status', state);
      }
    } else if (changed) {
      serviceState = undefined;
    }
  }
  const chatObserver = new MutationObserver(readChatState);
  chatObserver.observe(chatLabel, { childList: true, characterData: true, subtree: true });
  readChatState();
  function flushChat() {
    clearTimeout(chatTimer);
    chatTimer = undefined;
    if (chatBatch) emit('chat_batch', { dom_inserted: chatBatch, start_ms: chatBatchStart });
    chatBatch = 0;
  }
  const rowObserver = new MutationObserver(records => {
    if (!chatBatch) chatBatchStart = performance.now();
    for (const record of records) chatBatch += record.addedNodes.length;
    if (chatBatch && chatTimer === undefined) chatTimer = setTimeout(flushChat, 1000);
  });
  rowObserver.observe(chatRows, { childList: true });

  // Only collect callbacks inside bounded foreground bursts.
  function measureFrames() {
    const started = performance.now();
    if (!rafWindowMs || frameTimeout !== undefined || !window.requestAnimationFrame ||
        document.hidden || started + 50 < nextFrameWindow) return;
    nextFrameWindow = started + Math.max(fastMs, rafWindowMs * 5);
    let first;
    let last;
    const intervals = [];
    function tick(time) {
      if (time > started + rafWindowMs || document.hidden) return;
      first ??= time;
      if (last !== undefined) intervals.push(time - last);
      last = time;
      frameRequest = requestAnimationFrame(tick);
    }
    frameRequest = requestAnimationFrame(tick);
    frameTimeout = setTimeout(() => {
      cancelAnimationFrame(frameRequest);
      frameTimeout = undefined;
      frameWindow = document.hidden ? null : {
        start_ms: first ?? started, end_ms: last ?? started, requested_ms: rafWindowMs,
        intervals_ms: intervals
      };
    }, rafWindowMs);
  }

  function drainTasks() {
    const tasks = window.KickJointDiagnostics?.longTasksSince?.(taskCursor ?? 0);
    if (!tasks) return null;
    if (taskCursor !== null) {
      if (tasks.lost) emit('eventos_perdidos', { count: tasks.lost, source: 'long_task' });
      for (const task of tasks.events) emit('long_task', { tv_ms: task.tv_ms, duration_ms: task.duration_ms });
    }
    taskCursor = tasks.cursor;
    return true;
  }

  function armCleanup() {
    clearTimeout(probeTimeout);
    probeTimeout = setTimeout(() => window[key]?.stop(), Math.max(25_000, fastMs * 3));
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
      const windowSample = frameWindow;
      frameWindow = null;
      const fps = windowSample?.end_ms > windowSample?.start_ms
        ? windowSample.intervals_ms.length * 1000 / (windowSample.end_ms - windowSample.start_ms) : null;
      const longTaskEvents = drainTasks();
      if (measure && p) measureFrames();
      const gaps = dropped;
      dropped = 0;
      return {
        page: performance.timeOrigin, stream, channel, playback_mode: playbackMode, view_mode: p?.view_mode ?? null, tv_ms: performance.now(), home: !home.hidden,
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
        ui: { raf_fps: fps, raf_window: windowSample, long_task_events: longTaskEvents, js_heap_used_bytes: performance.memory?.usedJSHeapSize ?? null },
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
      drainTasks();
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
  const chat = window.KickChatUI;
  if (!chat) return false;
  if (chat.visible()) return true;
  const fullscreen = window.KickNativeDiagnostics?.snapshot()?.view_mode === 'fullscreen';
  const button = document.getElementById(fullscreen ? 'native-fullscreen' : 'native-theater');
  if (!button || button.disabled) return false;
  button.click();
  return chat.visible();
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
    tv_ms: j.monotonic_ms,
    ui: j.ui,
    chat: {
      session: chat.session_id, state: chat.state, presented: chat.presented,
      received: chat.received, dom_rows: chat.dom_rows, batches: chat.batches,
      render_ms_total: chat.render_ms_total, render_ms_max: chat.render_ms_max,
      counts: chat.delivery?.counts, queue: chat.delivery?.queue,
      oldest_age_ms: chat.delivery?.oldest_age_ms,
      render_batch_ms: chat.delivery?.h?.render_batch_ms,
      latency: {
        service_offered_ui_received_ms: chat.delivery?.h?.bridge_ms,
        ui_received_dom_ms: chat.delivery?.h?.ui_wait_ms,
        render_prepare_ms: chat.delivery?.h?.render_prepare_ms,
        render_append_ms: chat.delivery?.h?.render_append_ms,
        emote_mount_ms: chat.delivery?.h?.emote_mount_ms,
        prune_ms: chat.delivery?.h?.prune_ms,
        scroll_read_ms: chat.delivery?.h?.scroll_read_ms,
        scroll_write_ms: chat.delivery?.h?.scroll_write_ms,
        render_frame_wait_ms: chat.delivery?.h?.render_frame_wait_ms,
        render_timer_late_ms: chat.delivery?.h?.render_timer_late_ms
      },
      render_batch_items: chat.delivery?.h?.render_batch_items,
      emotes: chat.images?.counts, badges: chat.badges?.counts,
      emote_images: chat.images?.counts?.lazy_css_dom_emotes,
      emote_entries: chat.images?.known_ids,
      badge_entries: chat.badges?.cache_entries
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
    instance: c.instance, session: c.snapshot.session_id, status: s.status, renewal: s.renewal,
    authorization: s.connection_authorization ?? (s.protocol_details ? {
      ttl_seconds: s.protocol_details.ttl_seconds, active: s.resources.socket,
      renewal_required: s.resources.socket ? s.resources.lease_timer : null, expires_at_ms: null
    } : null),
    started_at: s.started_at, reading_at: s.reading_at, ended_at: s.ended_at,
    reason: s.reason, error: s.error, messages: s.messages, duplicates: s.duplicates,
    counts: s.delivery.counts, queue: s.delivery.queue, delivery_state: s.delivery.state,
    oldest_age_ms: s.delivery.oldest_age_ms,
    socket: s.resources.socket, memory: s.memory, load: s.delivery.load,
    latency: {
      service_received_normalized_ms: s.delivery.latency?.receive_normalized_ms,
      service_received_admitted_ms: s.delivery.latency?.receive_admitted_ms,
      service_admitted_offered_ms: s.delivery.h?.service_wait_ms,
      service_received_ack_ms: s.delivery.latency?.receive_ack_ms,
      ui_dom_service_ack_ms: s.delivery.h?.dom_ack_ms,
      service_flush_timer_late_ms: s.delivery.h?.flush_timer_late_ms
    },
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
    'closing', 'stopped', 'reading', 'lease_refresh_started', 'lease_refresh_confirmed',
    'lease_refresh_retry', 'lease_refresh_failed'
  ].includes(e.kind)).map(({ kind, at, session_id, details }) => ({
    kind, at, session_id, ...(kind.startsWith('lease_refresh_') ? {
      attempt: details?.attempt, ttl_seconds: details?.ttl_seconds, code: details?.code, retry_ms: details?.retry_ms
    } : {})
  }));
  return result;
}

module.exports = { installProbe, startStream, enableChat, chatBound, readSlow };
