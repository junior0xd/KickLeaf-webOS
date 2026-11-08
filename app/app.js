(function () {
  'use strict';
  var params = {};
  try { params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}'); }
  catch (error) { console.warn('[KickTV] Parâmetros de abertura inválidos.'); }
  if (params.mode === 'hls-test' && window.location.search !== '?home') {
    window.location.replace('hls-test.html');
    return;
  }

  var home = document.getElementById('home');
  var form = document.getElementById('channel-form');
  var input = document.getElementById('channel');
  var watch = document.getElementById('watch');
  var message = document.getElementById('message');
  var container = document.getElementById('player-container');
  var notice = document.getElementById('notice');
  var frame = null;
  var timer;
  var keyboardVisible = false;
  var exitPending = false;

  function showHome(text) {
    clearTimeout(timer);
    if (frame) {
      frame.onload = null;
      frame.onerror = null;
      frame.remove();
      frame = null;
    }
    container.hidden = true;
    notice.hidden = true;
    home.hidden = false;
    exitPending = false;
    message.textContent = text || '';
    watch.focus();
    console.info('[KickTV] home');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var url;
    try { url = window.KickChannel.playerURL(input.value); }
    catch (error) {
      message.textContent = error.message;
      input.focus();
      return;
    }
    showHome();
    home.hidden = true;
    container.hidden = false;
    frame = document.createElement('iframe');
    var current = frame;
    current.className = 'screen';
    current.title = 'Player oficial da Kick';
    current.tabIndex = -1;
    current.setAttribute('allow', 'autoplay; fullscreen');
    current.setAttribute('allowfullscreen', '');
    current.onload = function () {
      if (frame !== current) return;
      clearTimeout(timer);
      notice.hidden = true;
      document.body.focus();
      // load não comprova que a live está online nem que houve reprodução.
      console.info('[KickTV] iframe_load; status da live e reprodução desconhecidos');
    };
    current.onerror = function () {
      if (frame === current) showHome('Não foi possível abrir o player da Kick. Verifique a conexão e tente novamente.');
    };
    notice.textContent = 'Abrindo o player da Kick…';
    notice.hidden = false;
    timer = setTimeout(function () {
      if (frame === current) {
        notice.textContent = 'Não foi possível confirmar a abertura do player. Pressione Voltar para tentar novamente.';
      }
    }, 25000);
    current.src = url;
    container.appendChild(current);
    document.body.focus();
    console.info('[KickTV] embed_requested');
  });

  document.addEventListener('keyboardStateChange', function (event) {
    keyboardVisible = event.visibility === true || !!(event.detail && event.detail.visibility);
  });
  window.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (code === 461 || event.key === 'Escape') {
      // Primeiro Voltar pertence ao teclado virtual quando ele está aberto.
      if (keyboardVisible) return;
      event.preventDefault();
      if (frame) { showHome(); return; }
      if (exitPending) { window.close(); return; }
      exitPending = true;
      message.textContent = 'Pressione Voltar novamente para sair.';
      return;
    }
    if (frame || keyboardVisible) return;
    exitPending = false;
    if (code === 40 && document.activeElement === input) {
      event.preventDefault();
      watch.focus();
    } else if (code === 38 && document.activeElement === watch) {
      event.preventDefault();
      input.focus();
    }
    // OK/Enter usa o comportamento nativo do campo, formulário e botão.
    // Esquerda/direita ficam disponíveis para editar o texto.
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && frame) showHome('Reprodução encerrada ao sair do aplicativo.');
  });
  input.focus();
}());
