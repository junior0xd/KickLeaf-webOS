(function (root) {
  'use strict';
  function failure(code, message) { var error = new Error(message); error.code = code; return error; }
  // A browser intentionally exposes CORS, DNS, TLS and many network failures as TypeError.
  // Do not claim that JavaScript alone can distinguish them.
  function networkError() { return failure('network_or_cors', 'Falha de rede, TLS ou CORS.'); }
  async function request(url, {type = 'json', signal, timeout, onStatus = () => {}}) {
    var controller = new AbortController();
    var expired = false;
    function cancel() { controller.abort(); }
    if (signal.aborted) cancel();
    signal.addEventListener('abort', cancel, { once: true });
    var timer = setTimeout(function () { expired = true; controller.abort(); }, timeout);
    try {
      var response = await fetch(url, { signal: controller.signal, credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error', headers: type === 'json' ? {Accept: 'application/json'} : undefined });
      onStatus(response.status);
      if (!response.ok) {
        const error = failure('http_' + response.status, 'HTTP ' + response.status);
        error.retryAfter = response.headers.get('Retry-After');
        if (response.body) void response.body.cancel().catch(() => {});
        throw error;
      }
      // Bound response bodies, including chunked responses. Never log their contents.
      var reader = response.body.getReader(), size = 0, chunks = [], decoder = new TextDecoder();
      try {
        while (true) {
          var part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 524288) throw failure('body_too_large', 'Resposta excedeu o limite de tamanho.');
          chunks.push(decoder.decode(part.value, { stream: true }));
        }
      } finally { await reader.cancel().catch(function () {}); reader.releaseLock(); }
      var text = chunks.join('') + decoder.decode();
      if (type === 'text') return text;
      try { return JSON.parse(text); } catch (error) { throw failure('invalid_json', 'Resposta JSON inválida.'); }
    } catch (error) {
      if (expired) throw failure('timeout', 'Tempo limite da consulta.');
      if (signal.aborted) throw failure('cancelled', 'Consulta cancelada.');
      if (typeof error.code === 'string') throw error;
      throw networkError();
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
    }
  }
  var api = {request: request, failure: failure};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KickHTTP = api;
}(globalThis));
