'use strict';
const dns = require('dns');
const { AGENT, destination } = require('./config');
class Transport {
  constructor({ Socket, metrics, receive, fail, phase = () => 'F', lookup = dns.lookup }) {
    this.phase = phase; this.Socket = Socket; this.metrics = metrics; this.receive = receive; this.fail = fail; this.lookup = lookup;
    this.ws = null; this.ending = false; this.frames = 0; this.rx = 0;
  }
  open(value) {
    if (this.ws || this.ending) return Promise.reject(new Error('duplicate_connection'));
    destination(value,'wss');
    this.metrics.add('C','connection_attempts'); this.metrics.network.endpoint = value;
    return new Promise((resolve,reject) => {
      let done = false, failed = false;
      const rejectOnce = code => { if (failed) return; failed = true; if (!done) { done = true; reject(new Error(code)); } else if (!this.ending) this.fail(code); };
      const ws = this.ws = new this.Socket(value, { headers: {'User-Agent': AGENT}, rejectUnauthorized: true,
        followRedirects: false, perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 65536,
        lookup: (host,options,callback) => this.lookup(host,options,(error,address,family) => {
          this.metrics.network.dns = {resolved:!error, family:family || null}; callback(error,address,family);
        }) });
      if (ws._req) ws._req.on('socket', s => {
        this.rawSocket = s;
        s.once('connect',()=>{this.metrics.network.tcp_established = true;});
        s.once('secureConnect',()=>{this.metrics.network.tls = {authorized:s.authorized === true,protocol:s.getProtocol()};});
      });
      ws.on('upgrade',res=>{
        this.metrics.network.upgrade_status = res.statusCode;
        this.rawSocket = res.socket;
        this.metrics.network.tls = {authorized:res.socket.authorized === true,protocol:res.socket.getProtocol()};
        this.metrics.network.tcp_established = true;
      });
      ws.on('open',()=>{
        if (!this.metrics.network.tls || !this.metrics.network.tls.authorized) { rejectOnce('tls_not_verified'); return; }
        this.metrics.add('C','connections_opened'); done = true; resolve();
      });
      ws.on('unexpected-response',(req,res)=>{
        this.metrics.network.upgrade_status = res.statusCode;
        this.metrics.network.tls = {authorized:res.socket.authorized === true,protocol:res.socket.getProtocol()};
        this.metrics.network.tcp_established = true;
        this.metrics.network.refusal_body_retained = false;
        rejectOnce('upgrade_http_' + res.statusCode); res.destroy(); req.destroy();
      });
      ws.on('message',(bytes,binary)=>{
        if (this.ending) return;
        this.frames++; this.rx += bytes.length; this.metrics.add(this.phase(),'frames_received'); this.metrics.add(this.phase(),'ws_payload_rx',bytes.length);
        if (this.frames > 12000 || this.rx > 16*1024*1024) { this.fail('incoming_budget'); return; }
        try { this.receive(bytes,binary); } catch (_) { this.fail('invalid_protocol_frame'); }
      });
      ws.on('ping',bytes=>{ this.metrics.add('F','ws_control_pings_received'); this.metrics.add('F','ws_control_pongs_auto_sent'); this.metrics.add('F','ws_control_rx',bytes.length); this.metrics.add('F','ws_control_tx',bytes.length); });
      ws.on('pong',bytes=>{this.metrics.add('F','ws_control_pongs_received');this.metrics.add('F','ws_control_rx',bytes.length);});
      ws.on('error',e=>{
        const code=typeof e.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(e.code) ? e.code : 'wss_error';
        if (!this.metrics.network.upgrade_status || this.metrics.network.upgrade_status === 101) rejectOnce(code);
      });
      ws.on('close',code=>{
        this.capture(); this.metrics.network.close_code = code; this.metrics.add('cleanup','socket_close_events');
        if (this.ws === ws) this.ws = null;
        if (!this.ending) rejectOnce('socket_closed_' + code);
        ws.removeAllListeners();
      });
    });
  }
  send(text,phase) {
    if (!this.ws || this.ws.readyState !== 1 || this.ending || this.ws.bufferedAmount > 8192) throw new Error('socket_not_ready');
    const size=Buffer.byteLength(text);
    this.metrics.add(phase,'ws_payload_tx',size); this.metrics.add(phase,'frames_sent');
    this.ws.send(text,error=>{if(error && !this.ending)this.fail('socket_send_error');});
  }
  capture() {
    if (this.rawSocket) this.metrics.network.socket_plaintext_bytes = {written:this.rawSocket.bytesWritten,read:this.rawSocket.bytesRead};
  }
  close() {
    this.ending = true; const ws = this.ws;
    if (!ws) { this.capture(); return Promise.resolve(); }
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{ws.terminate();},2000);
      ws.once('close',()=>{clearTimeout(timer);this.capture();this.rawSocket=null;resolve();});
      if (ws.readyState === 3) {clearTimeout(timer);this.ws=null;resolve();}
      else if(ws.readyState === 1)ws.close(1000,'experiment finished');else ws.terminate();
    });
  }
}
module.exports={Transport};
