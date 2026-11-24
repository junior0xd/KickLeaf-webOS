(function (root) {
  'use strict';
  function log(stage, details) { console.info('[KickLeaf direct-hls]', stage, details); }
  function failure(code, message) { var error = new Error(message); error.code = code; return error; }
  async function request(url, type, signal, timeout, stage) {
    try {
      return await root.KickHTTP.request(url, {type: type, signal: signal, timeout: timeout,
        onStatus: function (status) { log(stage, {http_status: status}); }});
    } catch (error) {
      var messages = {
        http_401: 'A Kick exige autenticação; descoberta direta encerrada.',
        http_403: 'A Kick recusou o acesso (403); nenhum contorno será tentado.',
        http_404: 'Canal não encontrado (404).',
        http_429: 'A Kick limitou as consultas. Tente mais tarde.',
        network_or_cors: 'rede, TLS ou CORS impediu a consulta direta à Kick. Consulte o Inspector.',
        invalid_json: 'a Kick retornou JSON inválido.',
        timeout: 'tempo limite da consulta direta à Kick.'
      };
      if (messages[error.code] || /^http_/.test(error.code)) {
        error.message = 'Falha na descoberta: ' + (messages[error.code] || error.message + '.');
      }
      throw error;
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
      var stream = root.KickDiscovery.normalize(json.data, channel);
      return { channel: channel, online: true, source: 'direct-hls', playback: playback, analysis: analysis, stream: stream };
    } catch (error) {
      log('discovery_failed', { code: error.code || 'invalid_contract' });
      throw error;
    }
  }
  root.KickDirectAPI = { config: function () { return {}; }, resolve: resolve };
}(window));
