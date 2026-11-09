(function () {
  'use strict';
  var params = {};
  try { params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}'); } catch (error) { /* Configuração inválida será apresentada no formulário. */ }
  var mode = params.mode === 'native-hls' ? 'native-hls' : 'direct-hls';
  var provider = mode === 'direct-hls' ? window.KickDirectAPI : window.KickNativeAPI;
  var home = document.getElementById('home');
  var input = document.getElementById('channel');
  var watch = document.getElementById('watch');
  var message = document.getElementById('message');
  var host = document.getElementById('native-video-host');
  var notice = document.getElementById('notice');
  var controls = document.getElementById('native-controls');
  var menu = document.getElementById('native-quality-menu');
  var qualityButton = document.getElementById('native-quality');
  var officialHome = document.getElementById('official-home');
  var buttons = [qualityButton, document.getElementById('native-reload'), document.getElementById('official-player')];
  var statisticsButton = document.getElementById('video-statistics-toggle');
  buttons.push(statisticsButton);
  var statistics = window.KickVideoStats.create();
  var statisticsPanel = window.KickVideoStatsPanel.create(document.getElementById('video-statistics'), statistics);
  var video = null;
  var listeners = [];
  var request = null;
  var generation = 0;
  var timers = {};
  var metadata = null;
  var channel = '';
  var selected = 'auto';
  var keyboardVisible = false;
  var errors = { 1: 'Reprodução interrompida.', 2: 'Falha de rede ao reproduzir a mídia.', 3: 'A TV não conseguiu decodificar a mídia.', 4: 'HLS indisponível ou não suportado por este dispositivo.' };

  function log(state, details) { console.info('[KickTV native]', state, details || ''); }
  function clear(name) { clearTimeout(timers[name]); delete timers[name]; }
  function later(name, action, ms) { clear(name); timers[name] = setTimeout(action, ms); }
  function hint(text) { notice.textContent = text; notice.hidden = false; }
  function hideHint() { notice.hidden = true; }
  function hideControls() {
    clear('controls'); controls.hidden = true; menu.hidden = true;
    if (video || request) document.body.focus();
  }
  function idleControls() { clear('controls'); if (menu.hidden) later('controls', hideControls, 5000); }
  function releaseVideo() {
    clear('media');
    statistics.detach(); statisticsPanel.refresh();
    if (!video) return;
    listeners.forEach(function (item) { video.removeEventListener(item[0], item[1]); });
    listeners = [];
    video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null;
    log('media_released');
  }
  function stop() {
    statisticsPanel.hide(); statisticsButton.setAttribute('aria-pressed', 'false');
    generation += 1;
    if (request) { request.abort(); request = null; }
    Object.keys(timers).forEach(clear);
    releaseVideo(); hideControls(); hideHint(); menu.replaceChildren();
  }
  function showHome(text) {
    stop(); metadata = null; home.hidden = false; message.textContent = text || ''; watch.focus();
  }
  function fail(text, stage) { log('failed', { stage: stage || 'playback', mode: mode }); showHome(text); }
  function fallback() {
    var value = input.value;
    stop();
    var suffix = '';
    try { suffix = '&channel=' + encodeURIComponent(window.KickChannel.normalizeChannel(value)); } catch (error) { /* Entrada vazia não impede voltar ao iframe. */ }
    window.location.replace('index.html?iframe' + suffix);
  }
  function snapshot() { return statistics.snapshot(); }
  function play(selection) {
    releaseVideo(); hideControls();
    var item = selection === 'auto' ? null : metadata.playback.qualities.find(function (q) { return q.id === selection && q.selectable; });
    if (selection !== 'auto' && !item) { fail('Qualidade indisponível.'); return; }
    selected = selection;
    qualityButton.textContent = 'Qualidade: ' + (item ? item.label : 'Auto');
    var current = document.createElement('video');
    current.className = 'screen'; current.setAttribute('playsinline', ''); current.preload = 'none';
    video = current; host.appendChild(current); document.body.focus();
    statistics.attach(current, { quality: selected, variant: item, live: metadata.playback.live });
    statisticsPanel.refresh();
    var started = performance.now();
    var firstPlay = true;
    function on(name, callback) {
      var guarded = function () { if (video === current) callback(); };
      listeners.push([name, guarded]); current.addEventListener(name, guarded);
    }
    function deadline() { later('media', function () { fail('O vídeo não avançou em 25 segundos. Tente recarregar ou usar o player oficial.'); }, 25000); }
    on('loadedmetadata', function () { log('metadata', snapshot()); });
    on('playing', function () {
      clear('media'); hideHint();
      log('playing', firstPlay ? { initial_play_ms: Math.round(performance.now() - started) } : 'resumed');
      firstPlay = false;
    });
    on('waiting', function () { if (!current.paused && !current.ended) { hint('Carregando vídeo…'); if (!timers.media) deadline(); log('buffering'); } });
    on('pause', function () { clear('media'); hideHint(); log('paused'); });
    on('error', function () { if (current.error) { log('media_error', { code: current.error.code, message: errors[current.error.code] || 'Erro de mídia', browser_message_present: !!current.error.message }); fail(errors[current.error.code] || 'Erro de reprodução.'); } });
    on('ended', function () { showHome('A reprodução terminou.'); });
    hint('Carregando vídeo…'); deadline();
    current.src = item ? item.url : metadata.playback.url;
    log('quality_selected', { selection: selected, nominal_bitrate: item ? item.bitrate : null });
    current.load();
    var promise = current.play();
    if (promise && promise.catch) promise.catch(function () { if (video === current) fail('Não foi possível iniciar o HLS neste dispositivo.'); });
  }
  async function open() {
    var settings, next;
    try { next = window.KickChannel.normalizeChannel(input.value); settings = provider.config(params); }
    catch (error) { message.textContent = error.message; return; }
    stop(); channel = next; selected = 'auto'; home.hidden = true; document.body.focus();
    var ticket = generation;
    var controller = new AbortController(); request = controller;
    statistics.setPhase('discovering');
    log('discovery_start', { mode: mode, channel: channel });
    hint(mode === 'direct-hls' ? 'Consultando a Kick diretamente…' : 'Consultando backend local…');
    later('request', function () { controller.abort(); }, 12000);
    try {
      var data = await provider.resolve(channel, settings, controller.signal);
      if (ticket !== generation) return;
      clear('request'); request = null;
      if (!data.online) { showHome('Canal offline ou sem transmissão disponível.'); return; }
      metadata = data; play('auto');
    } catch (error) {
      if (ticket === generation) fail(error.message, 'discovery');
    }
  }
  document.getElementById('native-form').addEventListener('submit', function (event) { event.preventDefault(); open(); });
  buttons[1].addEventListener('click', open);
  statisticsButton.addEventListener('click', function () {
    if (!video && !request) return;
    if (statisticsPanel.isVisible()) statisticsPanel.hide(); else statisticsPanel.show();
    statisticsButton.setAttribute('aria-pressed', String(statisticsPanel.isVisible()));
    idleControls();
  });
  officialHome.addEventListener('click', fallback); buttons[2].addEventListener('click', fallback);
  qualityButton.addEventListener('click', function () {
    if (!metadata) return;
    clear('controls'); menu.replaceChildren();
    var entries = [{ id: 'auto', label: 'Auto', selectable: true }].concat(metadata.playback.qualities);
    entries.forEach(function (entry) {
      var button = document.createElement('button'); button.type = 'button';
      button.textContent = entry.label + (entry.selectable ? '' : (entry.reason === 'invalid_variant_url' ? ' (URL indisponível; use Auto)' : (entry.reason === 'external_rendition' ? ' (áudio/vídeo separado; use Auto)' : ' (áudio separado; use Auto)')));
      button.disabled = !entry.selectable;
      button.addEventListener('click', function () { play(entry.id); });
      menu.appendChild(button);
    });
    if (metadata.analysis && metadata.analysis.status === 'unavailable') {
      var explanation = document.createElement('p');
      explanation.textContent = 'Transmissão descoberta; não foi possível ler o manifesto. Reprodução em Auto disponível.';
      menu.appendChild(explanation);
    }
    menu.hidden = false; menu.querySelector('button').focus();
  });
  document.addEventListener('keyboardStateChange', function (event) { keyboardVisible = event.visibility === true || !!(event.detail && event.detail.visibility); });
  window.addEventListener('keydown', function (event) {
    if (keyboardVisible && !home.hidden) return;
    var code = event.keyCode;
    if (code === 461 || event.key === 'Escape') {
      event.preventDefault();
      if (!menu.hidden) { menu.hidden = true; qualityButton.focus(); idleControls(); }
      else if (!controls.hidden) hideControls();
      else if (home.hidden) showHome();
      else fallback();
      return;
    }
    var targets = !home.hidden ? [input, watch, officialHome] : (!menu.hidden ? Array.from(menu.querySelectorAll('button:not(:disabled)')) : buttons);
    if ([37, 38, 39, 40].indexOf(code) !== -1) {
      if (!home.hidden && (code === 37 || code === 39)) return;
      event.preventDefault();
      if (home.hidden && controls.hidden) { controls.hidden = false; controls.focus(); }
      var index = targets.indexOf(document.activeElement), direction = code === 37 || code === 38 ? -1 : 1;
      targets[index === -1 ? 0 : (index + direction + targets.length) % targets.length].focus();
      if (home.hidden) idleControls();
    } else if (code === 13 && home.hidden) {
      event.preventDefault();
      if (controls.hidden) { controls.hidden = false; controls.focus(); idleControls(); }
      else if (targets.indexOf(document.activeElement) !== -1) document.activeElement.click();
      else hideControls();
    }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) showHome('Reprodução encerrada ao sair do aplicativo.'); });
  window.KickNativeDiagnostics = { snapshot: snapshot };
  log('mode_selected', { mode: mode, origin: window.location.origin, protocol: window.location.protocol });
  input.focus();
}());
