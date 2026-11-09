(function (root) {
  'use strict';
  var states = { idle: 'Sem reprodução', discovering: 'Descobrindo transmissão', initializing: 'Carregando',
    playing: 'Reproduzindo', buffering: 'Buffering', paused: 'Pausado', seeking: 'Buscando posição', error: 'Erro', ended: 'Encerrado' };
  function number(value, digits) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toFixed(digits).replace('.', ',') : 'N/D';
  }
  function units(value, suffix, digits) { var text = number(value, digits); return text === 'N/D' ? text : text + suffix; }
  function create(element, collector) {
    var timer = null;
    var fields = {};
    element.querySelectorAll('[data-stat]').forEach(function (node) { fields[node.dataset.stat] = node; });
    function refresh() {
      if (element.hidden) return;
      var data = collector.snapshot();
      var codecs = data ? data.declared_codecs : [];
      var videoCodec = codecs.filter(function (codec) { return /^(avc[13]|hev1|hvc1|av01|vp09|vp9)(\.|$)/i.test(codec); });
      var audioCodec = codecs.filter(function (codec) { return /^(mp4a|ac-3|ec-3|opus|flac)(\.|$)/i.test(codec); });
      var values = {
        resolution: data && data.width !== null && data.height !== null ? data.width + ' × ' + data.height : 'N/D',
        fps: data ? units(data.observed_presented_fps, ' fps', 1) : 'N/D',
        nominalFPS: data ? units(data.nominal_fps, ' fps', 2) : 'N/D',
        videoCodec: videoCodec.join(', ') || 'N/D', audioCodec: audioCodec.join(', ') || 'N/D',
        quality: data ? (data.quality === 'auto' ? 'Auto (variante N/D)' : data.quality_label || data.quality) : 'N/D',
        bitrate: data && data.nominal_bitrate !== null ? units(data.nominal_bitrate / 1000000, ' Mbps', 2) : 'N/D',
        buffer: data ? units(data.buffered_ahead_seconds, ' s', 1) : 'N/D',
        frames: data ? number(data.dropped_frames, 0) + ' / ' + number(data.total_frames, 0) : 'N/D',
        edge: data ? units(data.live_edge_gap_seconds, ' s', 1) : 'N/D',
        latency: 'N/D', state: states[data ? data.state : collector.state()] || 'N/D',
        interruptions: data ? number(data.buffering_count, 0) + ' / ' + units(data.buffering_seconds, ' s', 1) : 'N/D'
      };
      Object.keys(fields).forEach(function (key) { if (fields[key].textContent !== values[key]) fields[key].textContent = values[key]; });
    }
    function hide() {
      clearInterval(timer); timer = null; element.hidden = true; collector.resetSample();
      Object.keys(fields).forEach(function (key) { fields[key].textContent = 'N/D'; });
    }
    function show() {
      if (!element.hidden) return;
      collector.resetSample(); element.hidden = false; refresh(); timer = setInterval(refresh, 1000);
    }
    return { show: show, hide: hide, refresh: refresh, isVisible: function () { return !element.hidden; }, destroy: hide };
  }
  root.KickVideoStatsPanel = { create: create };
}(window));
