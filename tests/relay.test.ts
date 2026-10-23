import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResidentRelay } from '../src/resident/relay';

/** A socket that opens at once and never closes by itself: what a dead one looks like to the page. */
class FakeSocket {
  static made: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.made.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send() {}
  close() {
    this.closed = true;
  }
}

function relay(answer: number, host = 'resident.inanimate.tech') {
  FakeSocket.made = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  const posted: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    posted.push(url);
    return { status: answer };
  });
  const logs: string[] = [];
  const r = new ResidentRelay('sim-1a2b3c4d', host, {
    onApp() {},
    onChunk() {},
    onEvent() {},
    onForget() {},
    onTimezone() {},
    onStatus() {},
    onLog: (t) => logs.push(t),
  });
  return { r, posted, logs };
}

describe('relay connection check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reconnects when the relay no longer has a connection Bench thinks is open', async () => {
    const { r, posted, logs } = relay(503);
    r.connect();
    await Promise.resolve();
    expect(r.status).toBe('online');
    await r.check();
    expect(posted).toEqual(['/relay/devices/sim-1a2b3c4d/send']);
    expect(FakeSocket.made).toHaveLength(2);
    expect(FakeSocket.made[0].closed).toBe(true);
    expect(logs.some((l) => l.includes('reconnecting'))).toBe(true);
    r.disconnect();
  });

  it("keeps one connection through disconnect-then-connect, even when the old socket's close comes late", async () => {
    vi.useFakeTimers();
    const { r } = relay(200);
    r.connect();
    await Promise.resolve();
    // New ID / a quick Disconnect and Connect: the old socket reports its close only afterwards.
    r.disconnect();
    r.connect();
    await Promise.resolve();
    FakeSocket.made[0].onclose?.();
    vi.advanceTimersByTime(5000);
    expect(r.status).toBe('online');
    expect(FakeSocket.made).toHaveLength(2);
    expect(r.publish('ping', '{}', false)).toBe('sent');
    r.disconnect();
  });

  it('leaves a connection the relay still has alone', async () => {
    const { r } = relay(200);
    r.connect();
    await Promise.resolve();
    await r.check();
    expect(FakeSocket.made).toHaveLength(1);
    r.disconnect();
  });

  it("stops and says so when the page isn't allowed to reach the relay", async () => {
    let violation: ((e: { blockedURI: string }) => void) | undefined;
    vi.stubGlobal('document', {
      addEventListener: (type: string, fn: typeof violation) => type === 'securitypolicyviolation' && (violation = fn),
      removeEventListener: () => {},
    });
    const { r } = relay(503, 'relay.example.com');
    r.connect();
    violation!({ blockedURI: 'wss://relay.example.com/devices/sim-1a2b3c4d?type=simulator' });
    expect(r.status).toBe('blocked');
    await new Promise((ok) => setTimeout(ok, 1100));
    expect(FakeSocket.made).toHaveLength(1); // no retries
  });

  it("doesn't check a relay Bench has no proxy for", async () => {
    const { r, posted } = relay(503, 'relay.example.com');
    r.connect();
    await Promise.resolve();
    await r.check();
    expect(posted).toEqual([]);
    expect(FakeSocket.made).toHaveLength(1);
    r.disconnect();
  });
});
