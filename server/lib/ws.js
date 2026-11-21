'use strict';
// Minimal, dependency-free WebSocket server (RFC 6455): text frames, fragmentation,
// ping/pong and close. Enough for browsers and Node's built-in WebSocket client.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = null;
    this.open = true; this.max = maxPayload; this.alive = true; this._done = false;
    sock.setNoDelay(true);
    sock.on('data', d => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (!this.open || this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) return this.close(1009, 'message too big');
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (len > this.max) return this.close(1009, 'message too big');
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this._send(0xA, data); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x2) {
        if (this.frag) return this.close(1002, 'unexpected new message');
        if (fin) { if (op === 0x1) this.emit('message', data.toString('utf8')); }
        else this.frag = { op, parts: [data], size: len };
        continue;
      }
      if (op === 0x0) {
        if (!this.frag) return this.close(1002, 'bad continuation');
        this.frag.parts.push(data); this.frag.size += len;
        if (this.frag.size > this.max) return this.close(1009, 'message too big');
        if (fin) { const all = Buffer.concat(this.frag.parts), o = this.frag.op; this.frag = null; if (o === 0x1) this.emit('message', all.toString('utf8')); }
        continue;
      }
      return this.close(1002, 'unknown opcode');
    }
  }
  _send(op, payload) {
    if (!this.open) return;
    const len = payload.length; let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
    try { this.sock.write(Buffer.concat([h, payload])); } catch (e) { /* socket already gone */ }
  }
  send(str) { this._send(0x1, Buffer.from(str, 'utf8')); }
  get buffered() { return this.sock.writableLength || 0; }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 100));
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
    this._send(0x8, p); this.open = false;
    try { this.sock.end(); } catch (e) {}
    setTimeout(() => { try { this.sock.destroy(); } catch (e) {} }, 1000).unref();
    this._closed();
  }
  _closed() { if (this._done) return; this._done = true; this.open = false; this.emit('close'); }
}

function attach(server, { path = null, maxPayload = 1 << 20, verifyOrigin = null }, onConnection) {
  server.on('upgrade', (req, sock, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (path && url.pathname !== path) { sock.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
    if (verifyOrigin && !verifyOrigin(req.headers.origin || '')) {
      sock.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); sock.destroy(); return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const ws = new Socket(sock, maxPayload);
    onConnection(ws, req);
    if (head && head.length) ws._data(head);
  });
}

module.exports = { attach };
