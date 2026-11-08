(function (root) {
  'use strict';
  function config(params) {
    var base;
    try { base = new URL(params.backendURL); } catch (error) { throw new Error('Configure o endereço do backend local nos parâmetros de abertura.'); }
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      throw new Error('O endereço do backend deve ser uma origem HTTP/HTTPS, sem credenciais ou caminhos.');
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(params.apiToken || '')) throw new Error('Configure o token de acesso ao backend local.');
    return { backendURL: base.origin, apiToken: params.apiToken };
  }
  function mediaURL(value) {
    var parsed;
    try { parsed = new URL(value); } catch (error) { throw new Error('O backend retornou uma URL de reprodução inválida.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('A reprodução direta exige uma URL HTTPS sem credenciais embutidas.');
    return value;
  }
  var messages = {
    unauthorized: 'O token do backend foi recusado.',
    upstream_access_denied: 'A Kick ou a CDN recusou o acesso. Nenhum contorno será tentado.',
    discovery_timeout: 'O backend excedeu o tempo de descoberta.',
    upstream_rate_limited: 'A plataforma limitou as consultas. Tente mais tarde.',
    protected_stream_unsupported: 'Esta PoC não reproduz fluxos protegidos.',
    test_channel_required: 'No modo de teste, digite hls-test.'
  };
  async function resolve(channel, settings, signal) {
    var response;
    try {
      response = await fetch(settings.backendURL + '/api/streams/' + encodeURIComponent(channel), {
        headers: { Authorization: 'Bearer ' + settings.apiToken }, signal: signal,
        credentials: 'omit', cache: 'no-store', redirect: 'error'
      });
    } catch (error) {
      if (signal.aborted) throw new Error('Consulta ao backend cancelada ou expirada.');
      throw new Error('Não foi possível acessar o backend local. Verifique rede, certificado e CORS.');
    }
    var data;
    try { data = await response.json(); } catch (error) { throw new Error('Resposta inválida do backend.'); }
    if (!response.ok) throw new Error(messages[data && data.error && data.error.code] || 'Não foi possível descobrir a transmissão pelo backend.');
    if (!data || data.channel !== channel || typeof data.online !== 'boolean') throw new Error('Metadados de reprodução inválidos.');
    if (!data.online) return data;
    var playback = data.playback;
    if (!playback || playback.type !== 'hls' || typeof playback.live !== 'boolean' || !Array.isArray(playback.qualities) || playback.qualities.length > 64) throw new Error('Metadados HLS inválidos.');
    mediaURL(playback.url);
    playback.qualities.forEach(function (quality) {
      if (!quality || !/^variant-\d{1,3}$/.test(quality.id) || typeof quality.label !== 'string' || quality.label.length > 32 || typeof quality.selectable !== 'boolean') throw new Error('Variante de qualidade inválida.');
      ['bitrate', 'fps', 'width', 'height'].forEach(function (key) {
        if (quality[key] != null && (typeof quality[key] !== 'number' || !Number.isFinite(quality[key]) || quality[key] < 0)) throw new Error('Métrica de qualidade inválida.');
      });
      if (quality.selectable) mediaURL(quality.url);
    });
    return data;
  }
  root.KickNativeAPI = { config: config, resolve: resolve };
}(window));
