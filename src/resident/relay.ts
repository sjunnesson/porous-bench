// Bench as a Resident device on a relay (default: the public resident.inanimate.tech).
// Same wire as the firmware: a WebSocket at wss://<host>/devices/<deviceId>; the relay forwards
// whatever is POSTed to https://<host>/devices/<deviceId>/send, so `send-app.sh`, the agent
// plugin's push-app and curl all work against the simulator.

import type { SendResult } from './host';

export type RelayStatus = 'off' | 'connecting' | 'online' | 'retrying';

export interface IncomingApp {
  code: string;
  generationId?: string;
  storeNs?: string;
  description?: string;
}

export interface WireEvent {
  name: string;
  data: Record<string, unknown>;
  from?: string;
  src?: string;
  seq?: number;
  channel: 'app' | 'runtime';
}

export interface RelayHandlers {
  onApp(app: IncomingApp): void;
  onChunk(code: string): void;
  onEvent(e: WireEvent): void;
  onForget(): void;
  onTimezone(tz: string): void;
  onStatus(s: RelayStatus): void;
  onLog(text: string): void;
}

/** 4 random bytes as hex, like the Resident site's simulator: sim-1a2b3c4d. */
export function newDeviceId(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return `sim-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const RATE = 5; // events/s sustained
const BURST = 10;
const QUEUE = 16;

export class ResidentRelay {
  status: RelayStatus = 'off';
  private ws: WebSocket | null = null;
  private wanted = false;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private bootId = Math.floor(Math.random() * 0xffffffff).toString(16);
  private seenNonces: string[] = [];
  private tokens = BURST;
  private lastRefill = Date.now();
  private queue: { frame: Record<string, unknown>; keep: boolean }[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    public deviceId: string,
    public host: string,
    private h: RelayHandlers,
  ) {}

  connect(): void {
    this.wanted = true;
    this.open();
    this.drainTimer ??= setInterval(() => this.drain(), 100);
  }

  disconnect(): void {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.drainTimer) clearInterval(this.drainTimer);
    this.drainTimer = null;
    this.ws?.close();
    this.ws = null;
    this.setStatus('off');
  }

  get pushUrl(): string {
    return `https://${this.host}/devices/${this.deviceId}/send`;
  }

  /** events.send: rate-limited, queued while offline. Standalone (relay off) → dropped. */
  publish(name: string, dataJson: string, keep: boolean): SendResult {
    if (!this.wanted) return 'dropped';
    const seq = ++this.seq;
    const frame = {
      channel: 'app',
      type: name,
      data: JSON.parse(dataJson),
      from: this.deviceId,
      src: 'device',
      seq,
      nonce: `${this.bootId}-${seq}`,
      ts_ms: Math.floor(performance.now()),
    };
    if (this.status === 'online' && !this.queue.length && this.take()) {
      this.ws!.send(JSON.stringify(frame));
      return 'sent';
    }
    if (this.queue.length >= QUEUE) {
      const i = this.queue.findIndex((q) => !q.keep);
      if (i < 0) return 'dropped';
      this.queue.splice(i, 1);
    }
    this.queue.push({ frame, keep });
    return 'queued';
  }

  /** Control-plane frame (telemetry, hello). Best effort. */
  sendSystem(type: string, data: Record<string, unknown>): void {
    if (this.status !== 'online') return;
    this.ws?.send(JSON.stringify({ channel: 'system', type, data }));
  }

  private open() {
    if (this.ws) return;
    this.setStatus(this.retryMs > 1000 ? 'retrying' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://${this.host}/devices/${this.deviceId}?type=simulator`);
    } catch (err) {
      this.h.onLog(`relay: ${String(err)}`);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      this.setStatus('online');
      this.h.onLog(`relay: connected as ${this.deviceId}`);
      this.sendSystem('hello', {
        protocol: 1,
        deviceType: 'porous-bench',
        firmware: 'porous.systems Bench',
        bootId: this.bootId,
        limits: { eventBytes: 1024, replyBytes: 1024, storeBytes: 2048, storeNsChars: 32, eventsPerSec: RATE },
      });
    };
    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onclose = () => {
      this.ws = null;
      if (this.wanted) this.scheduleRetry();
    };
    ws.onerror = () => this.h.onLog('relay: connection error');
  }

  private scheduleRetry() {
    this.setStatus('retrying');
    this.retryTimer = setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(30_000, this.retryMs * 2);
  }

  private receive(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.h.onLog('relay: dropped a non-JSON message');
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const type = String(msg.type ?? '');
    const channel = msg.channel as string | undefined;

    if (channel === 'app' || channel === 'runtime') {
      const nonce = typeof msg.nonce === 'string' ? msg.nonce : null;
      if (msg.from === this.deviceId) return; // self-echo
      if (nonce) {
        if (this.seenNonces.includes(nonce)) return;
        this.seenNonces = [...this.seenNonces.slice(-15), nonce];
      }
      this.h.onEvent({
        name: type,
        data: (msg.data as Record<string, unknown>) ?? {},
        from: typeof msg.from === 'string' ? msg.from : '',
        src: typeof msg.src === 'string' ? msg.src : undefined,
        seq: typeof msg.seq === 'number' ? msg.seq : undefined,
        channel,
      });
      return;
    }

    if (channel && channel !== 'system') {
      this.h.onLog(`relay: no handler for channel '${channel}' (type '${type}'); dropped`);
      return;
    }
    if (!channel && type !== 'status') this.h.onLog(`[deprecated] un-channelled '${type}' message; sender should stamp channel`);

    switch (type) {
      case 'app':
        if (typeof msg.code === 'string')
          this.h.onApp({
            code: msg.code,
            generationId: typeof msg.generationId === 'string' ? msg.generationId : undefined,
            storeNs: typeof msg.storeNs === 'string' ? msg.storeNs.slice(0, 32) : undefined,
            description: typeof msg.description === 'string' ? msg.description : undefined,
          });
        break;
      case 'chunk':
        if (typeof msg.code === 'string') this.h.onChunk(msg.code);
        break;
      case 'app_event':
        if (!channel && typeof msg.name === 'string')
          this.h.onEvent({ name: msg.name, data: (msg.data as Record<string, unknown>) ?? {}, channel: 'app' });
        break;
      case 'forget':
        this.h.onForget();
        break;
      case 'hello': {
        const tz = (msg.data as { tz?: unknown } | undefined)?.tz;
        if (typeof tz === 'string') this.h.onTimezone(tz);
        break;
      }
      case 'goodbye':
        this.h.onLog('relay: host said goodbye');
        break;
      case 'status':
        break; // relay presence info for monitors
      default:
        this.h.onLog(`relay: unhandled system message '${type}'`);
    }
  }

  private take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(BURST, this.tokens + ((now - this.lastRefill) / 1000) * RATE);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private drain() {
    while (this.queue.length && this.status === 'online' && this.take()) {
      this.ws!.send(JSON.stringify(this.queue.shift()!.frame));
    }
  }

  private setStatus(s: RelayStatus) {
    if (s === this.status) return;
    this.status = s;
    this.h.onStatus(s);
  }
}
