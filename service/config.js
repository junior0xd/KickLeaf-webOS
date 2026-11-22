'use strict';
const VERSION = '0.2.8';
const AGENT = 'KickTV/' + VERSION + ' (webOS TV; independent experimental client)';
const DEFAULT_CHANNEL = null;
function slug(value) {
  if (typeof value !== 'string' || value.length > 25 || !/^[a-zA-Z0-9][a-zA-Z0-9_]{0,24}$/.test(value)) throw new Error('invalid_slug');
  return value.toLowerCase();
}
function destination(value, kind, channel) {
  const u = new URL(value);
  if (u.username || u.password || u.port || u.search || u.hash) throw new Error('invalid_destination');
  const metadata = channel && u.hostname === 'kick.com' && u.pathname === '/api/v2/channels/' + slug(channel);
  const ok = kind === 'wss'
    ? u.protocol === 'wss:' && /^realtime\.[a-z0-9-]+\.platform\.kick\.com$/.test(u.hostname) && u.pathname === '/connection/websocket'
    : u.protocol === 'https:' && ((u.hostname === 'web.kick.com' && ['/api/v1/realtime/connection','/api/v1/realtime/auth/connection'].includes(u.pathname)) || metadata);
  if (!ok) throw new Error('invalid_destination');
  return u;
}
module.exports = { VERSION, AGENT, DEFAULT_CHANNEL, slug, destination };
