/* Player nativo de diagnóstico. Não resolve nem extrai URLs da Kick. */
(function () {
  'use strict';
  var video = document.getElementById('video');
  var panel = document.getElementById('test-panel');
  var message = document.getElementById('message');
  var start = document.getElementById('start');
  var timer;
  var active = false;
  var source = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8';

  function status(text) { message.textContent = text; }
  function stop(text) {
    active = false;
    clearTimeout(timer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
    panel.hidden = false;
    status(text || 'Teste encerrado.');
    start.focus();
  }
  function fail(text) {
    console.warn('[KickTV HLS]', text);
    stop(text);
  }
  function deadline() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      fail('O vídeo não avançou por 30 segundos. Verifique a conexão e tente novamente.');
    }, 30000);
  }
  start.addEventListener('click', function () {
    active = true;
    panel.hidden = true;
    video.hidden = false;
    document.body.focus();
    video.src = source;
    video.load();
    deadline();
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {
      if (active) fail('Não foi possível iniciar o vídeo. Verifique o suporte HLS e a permissão de reprodução.');
    });
  });
  video.addEventListener('playing', function () {
    if (!active) return;
    console.info('[KickTV HLS] playing');
    deadline();
  });
  video.addEventListener('timeupdate', function () { if (active) deadline(); });
  video.addEventListener('waiting', function () { console.info('[KickTV HLS] waiting'); });
  video.addEventListener('error', function () {
    if (!active) return;
    var code = video.error && video.error.code;
    var messages = {
      1: 'A reprodução foi interrompida.',
      2: 'Falha de rede ao carregar o vídeo.',
      3: 'A TV não conseguiu decodificar este vídeo.',
      4: 'Fluxo HLS indisponível ou formato não suportado.'
    };
    console.warn('[KickTV HLS] media_error', code);
    fail(messages[code] || 'Não foi possível reproduzir o vídeo.');
  });
  video.addEventListener('ended', function () { if (active) stop('O fluxo de teste terminou.'); });
  window.addEventListener('keydown', function (event) {
    if (event.keyCode !== 461 && event.key !== 'Escape') return;
    event.preventDefault();
    if (active) stop();
    else window.location.replace('index.html?home');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && active) stop('Teste interrompido ao sair do aplicativo.');
  });
  start.focus();
}());
