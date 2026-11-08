const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeChannel, playerURL } = require('../app/channel');

test('aceita nome e URL do canal, normaliza caixa e ignora query/fragmento', () => {
  for (const value of [' xQc ', 'https://kick.com/xqc', 'https://www.kick.com/XQC/?ref=test#top', 'kick.com/xqc']) {
    assert.equal(normalizeChannel(value), 'xqc');
  }
  assert.equal(normalizeChannel('canal-123_abc'), 'canal-123_abc');
});
test('recusa origens falsas, credenciais, caminhos extras e entradas inválidas', () => {
  for (const value of ['', ' ', 'a'.repeat(26), '<script>', 'x qc', 'https://kick.com.evil.test/xqc',
    'https://evil.test/xqc', 'https://kick.com@evil.test/xqc', 'https://a:b@kick.com/xqc',
    'https://kick.com:8080/xqc', 'https://kick.com/xqc/videos', 'https://kick.com/',
    'https://kick.com/%78qc', 'https://kick.com/a/../xqc', 'javascript:alert(1)']) {
    assert.throws(() => normalizeChannel(value), undefined, value);
  }
});
test('gera exclusivamente o embed documentado, sem tokens', () => {
  assert.equal(playerURL('XQC'), 'https://player.kick.com/xqc?autoplay=true&muted=false');
});
