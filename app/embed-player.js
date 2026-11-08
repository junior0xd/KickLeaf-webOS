/* Controles do documento pai. O estado de mídia do iframe permanece privado. */
(function (root) {
  'use strict';
  root.createKickPlayer = function (onExit) {
    var container = document.getElementById('player-container');
    var notice = document.getElementById('notice');
    var controls = document.getElementById('player-controls');
    var quality = document.getElementById('quality-menu');
    var qualityButton = document.getElementById('quality-button');
    var reloadButton = document.getElementById('reload-button');
    var closeQuality = document.getElementById('close-quality');
    var buttons = [qualityButton, reloadButton];
    var frame = null;
    var url = '';
    var active = false;
    var attempts = 0;
    var pendingFailure = false;
    var offline = false;
    var timers = {};
    var delays = [2000, 4000, 8000];

    function log(state, details) {
      // Somente estados e números locais; nunca URL, evento remoto ou exceção bruta.
      console.info('[KickTV player]', state, details || '');
    }
    function cancel(name) {
      clearTimeout(timers[name]);
      delete timers[name];
    }
    function later(name, callback, delay) {
      cancel(name);
      timers[name] = setTimeout(function () {
        delete timers[name];
        if (active) callback();
      }, delay);
    }
    function hideNotice() { cancel('notice'); notice.hidden = true; }
    function notify(text) {
      notice.textContent = text;
      notice.hidden = false;
      later('notice', hideNotice, 6000);
    }
    function hideControls() {
      cancel('controls');
      quality.hidden = true;
      controls.hidden = true;
      if (active) document.body.focus();
    }
    function idleControls() {
      cancel('controls');
      if (quality.hidden) later('controls', hideControls, 5000);
    }
    function showControls() {
      controls.hidden = false;
      controls.focus();
      idleControls();
    }
    function destroyFrame() {
      cancel('load');
      if (!frame) return;
      frame.onload = null;
      frame.onerror = null;
      frame.remove();
      frame = null;
    }
    function close() {
      var wasActive = active;
      active = false;
      Object.keys(timers).forEach(cancel);
      destroyFrame();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      pendingFailure = false;
      url = '';
      controls.hidden = true;
      quality.hidden = true;
      notice.hidden = true;
      container.hidden = true;
      if (wasActive) log('closed');
    }
    function exhausted() {
      log('recovery_exhausted', { attempts: attempts });
      close();
      onExit('Não foi possível abrir o player após três tentativas automáticas. Verifique a conexão e tente novamente.');
    }
    function scheduleRetry() {
      if (!active || !pendingFailure || timers.retry) return;
      if (attempts >= delays.length) { exhausted(); return; }
      if (offline) {
        log('retry_waiting_for_network', { attempts: attempts });
        notify('A rede parece indisponível. A recuperação aguardará a conexão.');
        return;
      }
      var delay = delays[attempts];
      log('retry_scheduled', { attempt: attempts + 1, delay_ms: delay });
      notify('Falha ao abrir o player. Tentando novamente…');
      later('retry', function () {
        if (offline) { scheduleRetry(); return; }
        attempts += 1;
        pendingFailure = false;
        loadFrame('automatic_retry');
      }, delay);
    }
    function loadFrame(reason) {
      destroyFrame();
      hideNotice();
      var started = Date.now();
      var current = document.createElement('iframe');
      frame = current;
      current.className = 'screen';
      current.title = 'Player oficial da Kick';
      current.tabIndex = -1;
      current.setAttribute('allow', 'autoplay; fullscreen');
      current.setAttribute('allowfullscreen', '');
      current.onload = function () {
        if (!active || frame !== current || pendingFailure) return;
        cancel('load');
        hideNotice();
        // Não zera o orçamento: load não comprova recuperação da reprodução.
        log('iframe_load; status da live e reprodução desconhecidos', { navigation_ms: Date.now() - started });
        if (controls.hidden) document.body.focus();
      };
      current.onerror = function () {
        if (!active || frame !== current || pendingFailure) return;
        cancel('load');
        pendingFailure = true;
        log('iframe_error', { network_offline_hint: offline, media_error: 'unavailable' });
        scheduleRetry();
      };
      notify('Abrindo o player da Kick…');
      later('load', function () {
        log('navigation_timeout; media_state_unknown');
        // Timeout de navegação não prova falha de mídia; não reinicia uma live possivelmente saudável.
        notify('A abertura do player não foi confirmada. Use OK para acessar Recarregar transmissão.');
      }, 25000);
      current.src = url;
      container.appendChild(current);
      if (controls.hidden) document.body.focus();
      log('embed_requested', { reason: reason, attempts: attempts });
    }
    function onOffline() {
      offline = true;
      cancel('retry');
      log('network_offline_hint');
      notify('A rede parece indisponível. A transmissão poderá ser interrompida.');
      // Mantém o frame: pode haver vídeo em buffer e recuperação interna do embed.
    }
    function onOnline() {
      offline = false;
      log('network_online_hint');
      // Uma rede disponível não comprova falha ou recuperação do vídeo remoto.
      if (pendingFailure) scheduleRetry();
      else hideNotice();
    }
    function open(nextURL) {
      close();
      url = nextURL;
      active = true;
      attempts = 0;
      offline = navigator.onLine === false;
      container.hidden = false;
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onOnline);
      log('capabilities', { quality: 'managed_by_kick', buffering: 'unavailable', playback_state: 'unavailable' });
      loadFrame('channel_open');
    }
    function reload() {
      if (!active) return;
      cancel('retry');
      pendingFailure = false;
      attempts = 0; // Ação explícita do usuário inicia um novo orçamento limitado.
      hideControls();
      log('manual_reload');
      loadFrame('manual_reload');
    }
    qualityButton.addEventListener('click', function () {
      if (!active) return;
      cancel('controls');
      quality.hidden = false;
      closeQuality.focus();
      log('quality_menu; managed_by_kick');
    });
    closeQuality.addEventListener('click', function () {
      quality.hidden = true;
      qualityButton.focus();
      idleControls();
    });
    reloadButton.addEventListener('click', reload);

    function handleKey(event) {
      if (!active) return false;
      var code = event.keyCode;
      if (code === 461 || event.key === 'Escape') {
        event.preventDefault();
        if (!quality.hidden) closeQuality.click();
        else if (!controls.hidden) hideControls();
        else { close(); onExit(); }
        return true;
      }
      if (code === 13 || event.key === 'Enter') {
        event.preventDefault();
        if (controls.hidden) showControls();
        else if (!quality.hidden) closeQuality.click();
        else if (buttons.indexOf(document.activeElement) !== -1) document.activeElement.click();
        else hideControls();
        return true;
      }
      if ([37, 38, 39, 40].indexOf(code) !== -1) {
        event.preventDefault();
        if (controls.hidden) showControls();
        if (!quality.hidden) { closeQuality.focus(); return true; }
        var index = buttons.indexOf(document.activeElement);
        var direction = code === 37 || code === 38 ? -1 : 1;
        index = index === -1 ? (direction === 1 ? 0 : buttons.length - 1) : (index + direction + buttons.length) % buttons.length;
        buttons[index].focus();
        idleControls();
        return true;
      }
      // Volume, mute, Home e outras teclas globais não são interceptados.
      return false;
    }
    return { open: open, close: close, reload: reload, handleKey: handleKey, isActive: function () { return active; } };
  };
}(window));
