(function (root) {
  'use strict';
  function normalizeChannel(value) {
    var input = String(value || '').trim();
    if (/^(?:https?:\/\/|(?:www\.)?kick\.com\/)/i.test(input)) {
      var url;
      try { url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input); }
      catch (error) { throw new Error('Digite um nome de canal ou uma URL válida da Kick.'); }
      if (!/^https?:$/.test(url.protocol) || !/^(www\.)?kick\.com$/i.test(url.hostname) || url.port || url.username || url.password) {
        throw new Error('Use uma URL de canal de kick.com.');
      }
      // URL() normaliza segmentos como /../; recuse-os em vez de aceitar outro canal.
      if (/%|\\|\/\.{1,2}(?:\/|$)/.test(input)) throw new Error('URL de canal inválida.');
      var match = /^\/([a-zA-Z0-9_-]{1,25})\/?$/.exec(url.pathname);
      if (!match) throw new Error('Use somente a URL inicial do canal da Kick.');
      input = match[1];
    }
    if (!/^[a-zA-Z0-9_-]{1,25}$/.test(input)) {
      throw new Error('Digite o nome do canal, com até 25 letras, números, hífen ou sublinhado.');
    }
    return input.toLowerCase();
  }
  function playerURL(channel) {
    return 'https://player.kick.com/' + encodeURIComponent(normalizeChannel(channel)) + '?autoplay=true&muted=false';
  }
  var api = { normalizeChannel: normalizeChannel, playerURL: playerURL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KickChannel = api;
}(typeof window !== 'undefined' ? window : this));
