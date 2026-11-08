(function () {
  'use strict';
  var params = {};
  try { params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}'); } catch (error) { /* Configuração inválida será apresentada no formulário. */ }
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
  var video = null;
  var listeners = [];
  var request = null;
  var generation = 0;
  var timers = {};
  var metadata = null;
  var channel = '';
  var selected = 'auto';
  var keyboardVisible = false;
  var frameSample = null;
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
    if (!video) return;
    listeners.forEach(function (item) { video.removeEventListener(item[0], item[1]); });
    listeners = [];
    video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null;
    frameSample = null;
    log('media_released');
  }
  function stop() {
    generation += 1;
    if (request) { request.abort(); request = null; }
    Object.keys(timers).forEach(clear);
    releaseVideo(); hideControls(); hideHint(); menu.replaceChildren();
  }
  function showHome(text) {
    stop(); metadata = null; home.hidden = false; message.textContent = text || ''; watch.focus();
  }
  function fail(text) { log('failed'); showHome(text); }
  function fallback() {
    var value = input.value;
    stop();
    var suffix = '';
    try { suffix = '&channel=' + encodeURIComponent(window.KickChannel.normalizeChannel(value)); } catch (error) { /* Entrada vazia não impede voltar ao iframe. */ }
    window.location.replace('index.html?iframe' + suffix);
  }
  function snapshot() {
    if (!video) return null;
    var ahead = 0;
    for (var i = 0; i < video.buffered.length; i += 1) {
      if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) ahead = video.buffered.end(i) - video.currentTime;
    }
    var quality = selected === 'auto' ? null : metadata.playback.qualities.find(function (q) { return q.id === selected; });
    var playbackQuality = null;
    try { if (typeof video.getVideoPlaybackQuality === 'function') playbackQuality = video.getVideoPlaybackQuality(); } catch (error) { /* Não disponível neste pipeline. */ }
    var now = performance.now();
    var fps = null;
    if (playbackQuality && !video.paused && !video.ended) {
      var presented = playbackQuality.totalVideoFrames - playbackQuality.droppedVideoFrames;
      if (frameSample && now - frameSample.time >= 1000) fps = Math.max(0, (presented - frameSample.frames) * 1000 / (now - frameSample.time));
      if (!frameSample || now - frameSample.time >= 1000) frameSample = { time: now, frames: presented };
    } else frameSample = null;
    return { width: video.videoWidth || null, height: video.videoHeight || null,
      quality: selected, nominal_bitrate: quality ? quality.bitrate : null, buffered_ahead_seconds: ahead,
      observed_presented_fps: fps, dropped_frames: playbackQuality ? playbackQuality.droppedVideoFrames : null,
      live_edge_gap_seconds: metadata.playback.live && video.seekable.length ? Math.max(0, video.seekable.end(video.seekable.length - 1) - video.currentTime) : null,
      paused: video.paused, ready_state: video.readyState };
  }
  function play(selection) {
    releaseVideo(); hideControls();
    var item = selection === 'auto' ? null : metadata.playback.qualities.find(function (q) { return q.id === selection && q.selectable; });
    if (selection !== 'auto' && !item) { fail('Qualidade indisponível.'); return; }
    selected = selection;
    qualityButton.textContent = 'Qualidade: ' + (item ? item.label : 'Auto');
    var current = document.createElement('video');
    current.className = 'screen'; current.setAttribute('playsinline', ''); current.preload = 'none';
    video = current; host.appendChild(current); document.body.focus();
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
    on('pause', function () { clear('media'); hideHint(); frameSample = null; log('paused'); });
    on('error', function () { if (current.error) { log('media_error', { code: current.error.code }); fail(errors[current.error.code] || 'Erro de reprodução.'); } });
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
    try { next = window.KickChannel.normalizeChannel(input.value); settings = window.KickNativeAPI.config(params); }
    catch (error) { message.textContent = error.message; return; }
    stop(); channel = next; selected = 'auto'; home.hidden = true; document.body.focus();
    var ticket = generation;
    var controller = new AbortController(); request = controller;
    hint('Consultando backend local…');
    later('request', function () { controller.abort(); }, 12000);
    try {
      var data = await window.KickNativeAPI.resolve(channel, settings, controller.signal);
      if (ticket !== generation) return;
      clear('request'); request = null;
      if (!data.online) { showHome('Canal offline ou sem transmissão disponível.'); return; }
      metadata = data; play('auto');
    } catch (error) {
      if (ticket === generation) fail(error.message);
    }
  }
  document.getElementById('native-form').addEventListener('submit', function (event) { event.preventDefault(); open(); });
  buttons[1].addEventListener('click', open);
  officialHome.addEventListener('click', fallback); buttons[2].addEventListener('click', fallback);
  qualityButton.addEventListener('click', function () {
    if (!metadata) return;
    clear('controls'); menu.replaceChildren();
    var entries = [{ id: 'auto', label: 'Auto', selectable: true }].concat(metadata.playback.qualities);
    entries.forEach(function (entry) {
      var button = document.createElement('button'); button.type = 'button';
      button.textContent = entry.label + (entry.selectable ? '' : ' (áudio separado; use Auto)');
      button.disabled = !entry.selectable;
      button.addEventListener('click', function () { play(entry.id); });
      menu.appendChild(button);
    });
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
  input.focus();
}());
