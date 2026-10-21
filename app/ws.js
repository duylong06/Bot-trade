// app/ws.js — WebSocket công khai của OKX: tự nối lại, tự ping, nhớ các kênh đã đăng ký.

export class OkxSocket {
  constructor(url, name) {
    this.url = url; this.name = name;
    this.subs = new Map();          // key → { arg, fn }
    this.ws = null; this.timer = null; this.retry = 0; this.alive = false;
    this.onState = () => {};
    this.onReconnect = () => {};
    this.connect();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > 1)) this.connect(true);
    });
    addEventListener('online', () => this.connect(true));
  }

  key(arg) { return arg.channel + ':' + (arg.instId || arg.instType || ''); }

  connect(force) {
    if (this.ws && this.ws.readyState <= 1 && !force) return;
    try { this.ws && this.ws.close(); } catch {}
    clearInterval(this.timer);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      const wasDown = this.retry > 0 || force;
      this.retry = 0; this.alive = true; this.onState(true);
      const args = [...this.subs.values()].map(s => s.arg);
      if (args.length) this.send({ op: 'subscribe', args });
      this.timer = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 20000);
      if (wasDown) this.onReconnect();
    };
    ws.onmessage = ev => {
      if (ev.data === 'pong') return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m.arg || !m.data) return;
      const s = this.subs.get(this.key(m.arg));
      if (s) s.fn(m.data, m.arg);
    };
    ws.onclose = () => {
      this.alive = false; this.onState(false); clearInterval(this.timer);
      if (this.ws !== ws) return;
      const wait = Math.min(15000, 500 * 2 ** this.retry++);
      setTimeout(() => { if (this.ws === ws) this.connect(); }, wait);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  sub(arg, fn) {
    const k = this.key(arg);
    this.subs.set(k, { arg, fn });
    this.send({ op: 'subscribe', args: [arg] });
    return () => this.unsub(arg);
  }

  unsub(arg) {
    const k = this.key(arg);
    if (!this.subs.has(k)) return;
    this.subs.delete(k);
    this.send({ op: 'unsubscribe', args: [arg] });
  }
}

export const businessWS = () => new OkxSocket('wss://ws.okx.com:8443/ws/v5/business', 'business');
export const publicWS = () => new OkxSocket('wss://ws.okx.com:8443/ws/v5/public', 'public');
