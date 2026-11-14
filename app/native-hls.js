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
  var settingsPanel = document.getElementById('native-settings-panel');
  var settingsButton = document.getElementById('native-settings');
  var playPauseButton = document.getElementById('native-play-pause');
  var closeSettingsButton = document.getElementById('native-close-settings');
  var qualityButton = document.getElementById('native-quality');
  var officialHome = document.getElementById('official-home');
  var buttons = [qualityButton, document.getElementById('native-reload'), document.getElementById('official-player')];
  var statisticsButton = document.getElementById('video-statistics-toggle');
  buttons.push(statisticsButton);
  var statistics = window.KickVideoStats.create();
  var statisticsPanel = window.KickVideoStatsPanel.create(document.getElementById('video-statistics'), statistics);
  var video = null;
  var playback = null;
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
  function syncPlayback(busy) {
    var paused = !video || video.paused;
    var label = paused ? 'Reproduzir' : 'Pausar';
    playPauseButton.disabled = !video;
    playPauseButton.setAttribute('aria-label', label);
    playPauseButton.title = label;
    playPauseButton.setAttribute('aria-busy', String(!!busy));
    playPauseButton.querySelector('img').src = paused ? 'phosphor-play-fill.svg' : 'phosphor-pause-fill.svg';
  }
  function setSettingsVisible(visible) {
    settingsPanel.hidden = !visible;
    settingsButton.setAttribute('aria-expanded', String(visible));
  }
  function showControls() { controls.hidden = false; settingsButton.focus(); idleControls(); }
  function closeSettings() { setSettingsVisible(false); settingsButton.focus(); idleControls(); }
  function hideControls() {
    clear('controls'); controls.hidden = true; menu.hidden = true; setSettingsVisible(false);
    if (video || request) document.body.focus();
  }
  function idleControls() { clear('controls'); if (menu.hidden && settingsPanel.hidden) later('controls', hideControls, 5000); }
  function releaseVideo() {
    clear('media'); clear('resume'); clear('resume-notice'); playback = null;
    statistics.detach(); statisticsPanel.refresh();
    if (!video) return;
    listeners.forEach(function (item) { video.removeEventListener(item[0], item[1]); });
    listeners = [];
    video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null;
    syncPlayback(false);
    log('media_released');
  }
  function stop() {
    document.getElementById('native-live').hidden = true;
    statisticsPanel.hide(); statisticsButton.setAttribute('aria-pressed', 'false');
    generation += 1;
    if (request) { request.abort(); request = null; }
    Object.keys(timers).forEach(clear);
    releaseVideo(); hideControls(); hideHint(); menu.replaceChildren();
  }
  function showHome(text) {
    window.dispatchEvent(new CustomEvent('kicktv-channel-left'));
    stop(); metadata = null; home.hidden = false; message.textContent = text || ''; watch.focus();
  }
  function fail(text, stage) { log('failed', { stage: stage || 'playback', mode: mode }); showHome(text); }
  function fallback() {
    var value = input.value;
    window.dispatchEvent(new CustomEvent('kicktv-channel-left'));
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
    document.getElementById('native-live').hidden = !metadata.playback.live;
    qualityButton.textContent = 'Qualidade: ' + (item ? item.label : 'Auto');
    var current = document.createElement('video');
    current.className = 'screen'; current.setAttribute('playsinline', ''); current.preload = 'none';
    video = current; host.appendChild(current); document.body.focus();
    statistics.attach(current, { quality: selected, variant: item, live: metadata.playback.live });
    statisticsPanel.refresh();
    var started = performance.now();
    var firstPlay = true;
    var pausedAt = null, pending = false, recovered = false, corrected = false, blocked = false, operation = 0;
    var target = null, resumePlaying = false;
    function on(name, callback) {
      var guarded = function () { if (video === current) callback(); };
      listeners.push([name, guarded]); current.addEventListener(name, guarded);
    }
    // Snapshot each range independently. Native HLS may expose no ranges temporarily.
    function ranges(name) {
      var result = [];
      try {
        var value = current[name];
        for (var i = 0; i < value.length; i += 1) {
          var start = value.start(i), end = value.end(i);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) result.push([start, end]);
        }
      } catch (error) { result = []; /* No reliable timeline available yet. */ }
      return result;
    }
    function available(position, intervals) {
      return intervals.some(function (range) { return position >= range[0] && position < range[1]; });
    }
    function accessible() { return ranges('seekable').concat(ranges('buffered')); }
    function expired(position) {
      var intervals = accessible();
      return ranges('seekable').length > 0 && !available(position, intervals);
    }
    function recover() {
      if (recovered) return false;
      var intervals = accessible();
      if (!expired(pausedAt)) return false;
      // Closest accessible point, slightly inside its interval (never assume live edge).
      var choices = intervals.map(function (range) {
        var margin = Math.min(0.25, (range[1] - range[0]) / 2);
        return Math.max(range[0] + margin, Math.min(pausedAt, range[1] - margin));
      });
      choices.sort(function (a, b) { return Math.abs(a - pausedAt) - Math.abs(b - pausedAt); });
      recovered = true; target = choices[0];
      hint('O ponto pausado não está mais disponível. Retomando no trecho acessível mais próximo.');
      try { current.currentTime = target; return true; } catch (error) { return false; }
    }
    function resumeFailed(text) {
      pending = false; blocked = true; operation += 1;
      clear('resume'); clear('media');
      current.pause(); syncPlayback(false); hint(text);
    }
    function resumeDeadline() {
      later('resume', function () {
        if (video !== current || !pending) return;
        if (recover()) { resumeDeadline(); return; }
        resumeFailed('Não foi possível retomar. Verifique a conexão e pressione Reproduzir para tentar novamente.');
      }, 25000);
    }
    function confirmResume() {
      if (!pending || !resumePlaying || current.paused || current.seeking) return false;
      if (Math.abs(current.currentTime - target) > 0.5) {
        if (expired(target)) {
          if (!recover()) resumeFailed('O ponto pausado não está mais disponível. Tente recarregar a transmissão.');
        } else if (!corrected) {
          corrected = true;
          try { current.currentTime = target; } catch (error) { resumeFailed('Não foi possível restaurar o ponto pausado neste dispositivo.'); }
        } else resumeFailed('Este dispositivo não conseguiu preservar o ponto pausado. Tente novamente ou recarregue a transmissão.');
        return false;
      }
      pending = false; pausedAt = null; operation += 1; clear('resume'); clear('media'); syncPlayback(false);
      if (recovered) later('resume-notice', hideHint, 8000); else hideHint();
      return true;
    }
    playback = { toggle: function (intent) {
      if (pending) return;
      if ((intent === 'pause' && current.paused) || (intent === 'play' && !current.paused)) return;
      if (!current.paused) { pausedAt = current.currentTime; current.pause(); return; }
      pending = true; blocked = false; recovered = false; corrected = false; resumePlaying = false;
      clear('resume-notice'); clear('media');
      if (pausedAt === null) pausedAt = current.currentTime;
      target = pausedAt;
      hint('Retomando vídeo…'); syncPlayback(true); resumeDeadline();
      try {
        if (expired(target)) {
          if (!recover()) throw new Error('Unavailable timeline');
        } else if (Math.abs(current.currentTime - target) > 0.05) current.currentTime = target;
        var ticket = ++operation;
        var attempt = current.play();
        if (attempt && attempt.catch) attempt.catch(function () {
          if (video === current && ticket === operation) resumeFailed('Não foi possível retomar. Pressione Reproduzir para tentar novamente.');
        });
      } catch (error) { resumeFailed('Não foi possível retomar o ponto pausado. Tente novamente ou recarregue a transmissão.'); }
    } };
    function deadline() { later('media', function () { fail('O vídeo não avançou em 25 segundos. Tente recarregar ou usar o player oficial.'); }, 25000); }
    on('loadedmetadata', function () { log('metadata', snapshot()); });
    on('playing', function () {
      if (blocked) { current.pause(); return; }
      if (pending) { resumePlaying = true; confirmResume(); return; }
      clear('media'); if (!timers['resume-notice']) hideHint();
      syncPlayback(false);
      log('playing', firstPlay ? { initial_play_ms: Math.round(performance.now() - started) } : 'resumed');
      firstPlay = false;
    });
    on('play', function () { syncPlayback(true); });
    on('seeked', function () { if (pending) confirmResume(); });
    on('timeupdate', function () { if (pending) confirmResume(); });
    on('waiting', function () { if (!current.paused && !current.ended) { syncPlayback(true); if (!recovered) hint('Carregando vídeo…'); if (!pending && !timers.media) deadline(); log('buffering'); } });
    on('pause', function () {
      if (!pending && !blocked && pausedAt === null) pausedAt = current.currentTime;
      clear('media'); syncPlayback(pending); if (!pending && !blocked) { clear('resume-notice'); hideHint(); } log('paused');
    });
    on('error', function () { if (current.error) { log('media_error', { code: current.error.code, message: errors[current.error.code] || 'Erro de mídia', browser_message_present: !!current.error.message }); fail(errors[current.error.code] || 'Erro de reprodução.'); } });
    on('ended', function () { showHome('A reprodução terminou.'); });
    hint('Carregando vídeo…'); deadline();
    current.src = item ? item.url : metadata.playback.url;
    log('quality_selected', { selection: selected, nominal_bitrate: item ? item.bitrate : null });
    current.load();
    syncPlayback(true);
    try {
      var promise = current.play();
      if (promise && promise.catch) promise.catch(function () {
        if (video === current && operation === 0 && pausedAt === null) fail('Não foi possível iniciar o HLS neste dispositivo.');
      });
    } catch (error) { fail('Não foi possível iniciar o HLS neste dispositivo.'); }
  }
  async function open() {
    var settings, next;
    try { next = window.KickChannel.normalizeChannel(input.value); settings = provider.config(params); }
    catch (error) { message.textContent = error.message; return; }
    stop(); channel = next; selected = 'auto';
    window.dispatchEvent(new CustomEvent('kicktv-channel-selected',{detail:{channel:channel}})); home.hidden = true; document.body.focus();
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
  playPauseButton.addEventListener('click', function () { if (playback) playback.toggle(); idleControls(); });
  settingsButton.addEventListener('click', function () {
    clear('controls'); setSettingsVisible(true); qualityButton.focus();
  });
  closeSettingsButton.addEventListener('click', closeSettings);
  statisticsButton.addEventListener('click', function () {
    if (!video && !request) return;
    if (statisticsPanel.isVisible()) statisticsPanel.hide(); else statisticsPanel.show();
    statisticsButton.setAttribute('aria-pressed', String(statisticsPanel.isVisible()));
    closeSettings();
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
    setSettingsVisible(false);
    menu.hidden = false; menu.querySelector('button').focus();
  });
  document.addEventListener('keyboardStateChange', function (event) { keyboardVisible = event.visibility === true || !!(event.detail && event.detail.visibility); });
  window.addEventListener('keydown', function (event) {
    if (keyboardVisible && !home.hidden) return;
    var code = event.keyCode;
    if (home.hidden && [19, 179, 415, 463].indexOf(code) !== -1) {
      event.preventDefault();
      if (!event.repeat && playback) playback.toggle(code === 19 ? 'pause' : (code === 415 ? 'play' : null));
      return;
    }
    if (code === 461 || event.key === 'Escape') {
      event.preventDefault();
      if (!menu.hidden) { menu.hidden = true; setSettingsVisible(true); qualityButton.focus(); }
      else if (!settingsPanel.hidden) closeSettings();
      else if (!controls.hidden) hideControls();
      else if (window.KickChatUI && window.KickChatUI.visible()) { window.KickChatUI.hide(); document.body.focus(); }
      else if (home.hidden) showHome();
      else fallback();
      return;
    }
    var targets = !home.hidden ? [input, watch, officialHome] : (!menu.hidden ? Array.from(menu.querySelectorAll('button:not(:disabled)')) : (!settingsPanel.hidden ? buttons.concat([closeSettingsButton]) : (video ? [playPauseButton, document.getElementById('native-theater'), settingsButton, document.getElementById('native-fullscreen')] : [settingsButton])));
    if ([37, 38, 39, 40].indexOf(code) !== -1 || (code === 9 && home.hidden)) {
      if (!home.hidden && (code === 37 || code === 39)) return;
      event.preventDefault();
      if (home.hidden && controls.hidden) { showControls(); return; }
      var index = targets.indexOf(document.activeElement), direction = code === 37 || code === 38 || (code === 9 && event.shiftKey) ? -1 : 1;
      targets[index === -1 ? 0 : (index + direction + targets.length) % targets.length].focus();
      if (home.hidden) idleControls();
    } else if (code === 13 && home.hidden) {
      event.preventDefault();
      if (event.repeat) return;
      if (controls.hidden) showControls();
      else if (targets.indexOf(document.activeElement) !== -1) document.activeElement.click();
      else hideControls();
    }
  });
  document.getElementById('native-theater').addEventListener('click',function(){if(window.KickChatUI)window.KickChatUI.toggle();idleControls();});
  document.getElementById('native-fullscreen').addEventListener('click',function(){if(window.KickChatUI)window.KickChatUI.hide();idleControls();});
  document.addEventListener('visibilitychange', function () { if (document.hidden) showHome('Reprodução encerrada ao sair do aplicativo.'); });
  window.KickNativeDiagnostics = { snapshot: snapshot };
  log('mode_selected', { mode: mode, origin: window.location.origin, protocol: window.location.protocol });
  input.focus();
}());
