(function (root) {
  'use strict';
  function log(stage, details) { console.info('[KickLeaf direct-hls]', stage, details); }
  function failure(code, message) { var error = new Error(message); error.code = code; return error; }
  // A browser intentionally exposes CORS, DNS, TLS and many network failures as TypeError.
  // Do not claim that JavaScript alone can distinguish them.
  function networkError() { return failure('network_or_cors', 'Falha na descoberta: rede, TLS ou CORS impediu a consulta direta à Kick. Consulte o Inspector.'); }
  async function request(url, type, signal, timeout, stage) {
    var controller = new AbortController();
    var expired = false;
    function cancel() { controller.abort(); }
    if (signal.aborted) cancel();
    signal.addEventListener('abort', cancel, { once: true });
    var timer = setTimeout(function () { expired = true; controller.abort(); }, timeout);
    try {
      var response = await fetch(url, { signal: controller.signal, credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error' });
      log(stage, { http_status: response.status });
      if (!response.ok) {
        var messages = { 401: 'A Kick exige autenticação; descoberta direta encerrada.', 403: 'A Kick recusou o acesso (403); nenhum contorno será tentado.', 404: 'Canal não encontrado (404).', 429: 'A Kick limitou as consultas. Tente mais tarde.' };
        throw failure('http_' + response.status, 'Falha na descoberta: ' + (messages[response.status] || 'HTTP ' + response.status + '.'));
      }
      // Bound response bodies, including chunked responses. Never log their contents.
      var reader = response.body.getReader(), size = 0, chunks = [], decoder = new TextDecoder();
      try {
        while (true) {
          var part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 524288) throw failure('body_too_large', 'Resposta excedeu o limite de tamanho.');
          chunks.push(decoder.decode(part.value, { stream: true }));
        }
      } finally { await reader.cancel().catch(function () {}); reader.releaseLock(); }
      var text = chunks.join('') + decoder.decode();
      if (type === 'text') return text;
      try { return JSON.parse(text); } catch (error) { throw failure('invalid_json', 'Falha na descoberta: a Kick retornou JSON inválido.'); }
    } catch (error) {
      if (expired) throw failure('timeout', 'Falha na descoberta: tempo limite da consulta direta à Kick.');
      if (signal.aborted) throw failure('cancelled', 'Consulta direta cancelada.');
      if (typeof error.code === 'string') throw error;
      throw networkError();
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
    }
  }
  async function resolve(channel, settings, signal) {
    channel = root.KickChannel.normalizeChannel(channel);
    log('discovery_start', { channel: channel });
    try {
      var json = await request('https://kick.com/api/v2/channels/' + encodeURIComponent(channel) + '/livestream', 'json', signal, 8000, 'discovery_http');
      if (!json || typeof json !== 'object' || !Object.prototype.hasOwnProperty.call(json, 'data')) throw failure('invalid_contract', 'Falha na descoberta: formato de resposta da Kick desconhecido.');
      if (json.data === null) { log('discovery_result', { online: false, has_playback_url: false }); return { channel: channel, online: false, playback: null }; }
      log('discovery_result', { has_playback_url: typeof json.data.playback_url === 'string' && !!json.data.playback_url });
      if (!json.data || typeof json.data.playback_url !== 'string' || !json.data.playback_url) throw failure('missing_playback_url', 'Falha na descoberta: resposta sem playback_url; o contrato interno pode ter mudado.');
      var master;
      try { master = root.KickHLSManifest.mediaURL(json.data.playback_url); }
      catch (error) { throw failure('invalid_hls_url', 'Falha na descoberta: URL HLS inválida ou CDN não permitida.'); }
      log('discovery_success', { channel: channel, has_playback_url: true });
      var playback = { type: 'hls', url: master, live: true, qualities: [] };
      var analysis;
      try {
        var text = await request(master, 'text', signal, 3000, 'manifest_http');
        var parsed = root.KickHLSManifest.parse(text, master);
        playback.qualities = parsed.qualities;
        analysis = { status: 'available', kind: parsed.kind };
        log('manifest_success', { kind: parsed.kind, variants: parsed.qualities.length, selectable: parsed.qualities.filter(function (q) { return q.selectable; }).length });
      } catch (error) {
        if (signal.aborted) throw failure('cancelled', 'Consulta direta cancelada.');
        analysis = { status: 'unavailable', code: error.code || 'invalid_manifest' };
        log('manifest_unavailable', { code: analysis.code, fallback: 'master_auto' });
      }
      return { channel: channel, online: true, source: 'direct-hls', playback: playback, analysis: analysis };
    } catch (error) {
      log('discovery_failed', { code: error.code || 'invalid_contract' });
      throw error;
    }
  }
  root.KickDirectAPI = { config: function () { return {}; }, resolve: resolve };
}(window));
