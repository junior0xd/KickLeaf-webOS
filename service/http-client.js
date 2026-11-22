'use strict';
const https = require('https');
const { AGENT, destination } = require('./config');
class HttpClient {
  constructor(metrics, transport = https, channel = null) { this.channel = channel; this.metrics = metrics; this.transport = transport; this.agent = new https.Agent({keepAlive:true, maxSockets:1, maxFreeSockets:1, timeout:10000}); this.active = new Set(); this.cancelled = false; }
  request(value, body, phase, redirects = 0) {
    if (this.cancelled) return Promise.reject(new Error('cancelled'));
    let u;
    try { u = destination(value, 'https', this.channel); } catch (e) { return Promise.reject(e); }
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const record = { phase, endpoint: u.origin + u.pathname, method: bytes ? 'POST' : 'GET', status: null, response_bytes: 0, request_body_bytes: bytes ? bytes.length : 0 };
    this.metrics.http.push(record); this.metrics.add(phase, 'http_requests'); this.metrics.add(phase, 'http_body_tx', record.request_body_bytes);
    return new Promise((resolve, reject) => {
      let settled = false, response, timer, writtenStart = 0, readStart = 0;
      const captureSocket = () => {
        const s = req.socket; record.reused_socket = req.reusedSocket === true;
        record.socket_bytes_written = s ? s.bytesWritten - writtenStart : 0;
        record.socket_bytes_read = s ? s.bytesRead - readStart : 0;
      };
      const started = Date.now();
      const finish = (error, data) => {
        if (settled) return; settled = true; clearTimeout(timer); this.active.delete(req);
        record.elapsed_ms = Date.now() - started;
        captureSocket();
        if (error) reject(error); else resolve(data);
      };
      const headers = { 'User-Agent': AGENT, Accept: 'application/json' };
      if (bytes) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = bytes.length; }
      const req = this.transport.request(u, { method: record.method, headers, agent: this.agent, rejectUnauthorized: true }, res => {
        response = res; record.status = res.statusCode;
        record.tls_authorized = res.socket.authorized === true; record.tls_protocol = res.socket.getProtocol();
        if (!record.tls_authorized) { finish(new Error('tls_not_verified')); res.destroy(); req.destroy(); return; }
        let total = 0; const chunks = [];
        res.on('data', chunk => {
          total += chunk.length; record.response_bytes = total; this.metrics.add(phase, 'http_body_rx', chunk.length);
          if (total > 65536) { finish(new Error('http_body_limit')); res.destroy(); req.destroy(); return; }
          chunks.push(chunk);
        });
        res.on('error', () => finish(new Error('http_response_error')));
        res.on('aborted', () => finish(new Error('http_response_aborted')));
        res.on('end', () => {
          if (settled) return;
          if ([301,302,303,307,308].includes(res.statusCode)) {
            if (redirects >= 1 || ![307,308].includes(res.statusCode)) { finish(new Error('redirect_not_supported')); return; }
            let target;
            try { target = destination(new URL(res.headers.location, u).href, 'https', this.channel); if (target.origin !== u.origin || target.pathname !== u.pathname) throw new Error(); }
            catch (_) { finish(new Error('redirect_not_allowed')); return; }
            clearTimeout(timer); settled = true; this.active.delete(req); captureSocket(); record.elapsed_ms = Date.now() - started;
            this.request(target.href, body, phase, redirects + 1).then(resolve, reject); return;
          }
          if (res.statusCode !== 200) {
            const header = res.headers['retry-after'];
            const retry = /^\d+$/.test(header ?? '') ? Number(header) * 1000 : Date.parse(header) - Date.now();
            const error = new Error('http_' + res.statusCode);
            if (Number.isFinite(retry)) {
              error.retryAfterMs = Math.max(0, retry);
              record.retry_after_seconds = error.retryAfterMs / 1000;
            }
            // Never retain a raw error body: it may include credentials or request context.
            finish(error); return;
          }
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (_) { finish(new Error('http_invalid_json')); }
        });
      });
      req.on('socket', s => { writtenStart = s.bytesWritten; readStart = s.bytesRead; });
      this.active.add(req);
      req.on('error', e => finish(new Error(typeof e.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(e.code) ? e.code : 'http_network_error')));
      req.on('close', () => { if (!settled) finish(new Error('http_closed')); });
      timer = setTimeout(() => { finish(new Error('http_timeout')); if (response) response.destroy(); req.destroy(); }, 10000);
      if (bytes) req.write(bytes); req.end();
    });
  }
  releaseIdle() { this.agent.destroy(); }
  cancel() { this.cancelled = true; this.agent.destroy(); this.active.forEach(req => req.destroy()); }
}
module.exports = { HttpClient };
