(function () {
  'use strict';
  var params = {};
  try { params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}'); }
  catch (error) { console.warn('[KickTV] Parâmetros de abertura inválidos.'); }
  var query = new URLSearchParams(window.location.search);
  if (params.mode === 'native-hls' && !query.has('iframe')) {
    window.location.replace('native-hls.html');
    return;
  }
  if (params.mode === 'hls-test' && window.location.search !== '?home') {
    window.location.replace('hls-test.html');
    return;
  }

  var home = document.getElementById('home');
  var form = document.getElementById('channel-form');
  var input = document.getElementById('channel');
  if (query.has('iframe') && query.has('channel')) {
    try { input.value = window.KickChannel.normalizeChannel(query.get('channel')); } catch (error) { /* Mantém a entrada vazia se inválida. */ }
  }
  var watch = document.getElementById('watch');
  var message = document.getElementById('message');
  var player = window.createKickPlayer(showHome);
  var keyboardVisible = false;
  var exitPending = false;

  function showHome(text) {
    player.close();
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
    player.open(url);
  });

  document.addEventListener('keyboardStateChange', function (event) {
    keyboardVisible = event.visibility === true || !!(event.detail && event.detail.visibility);
  });
  window.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (player.isActive()) { player.handleKey(event); return; }
    if (code === 461 || event.key === 'Escape') {
      // Primeiro Voltar pertence ao teclado virtual quando ele está aberto.
      if (keyboardVisible) return;
      event.preventDefault();
      if (exitPending) { window.close(); return; }
      exitPending = true;
      message.textContent = 'Pressione Voltar novamente para sair.';
      return;
    }
    if (keyboardVisible) return;
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
    if (document.hidden && player.isActive()) showHome('Reprodução encerrada ao sair do aplicativo.');
  });
  input.focus();
}());
