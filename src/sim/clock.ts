// Simulated time. Everything time-based (delays, bus transfers, e-paper refreshes, sensor frames)
// runs on this clock, so pausing, stepping and slow-motion apply to all of it.

export class SketchStopped extends Error {
  constructor() {
    super('sketch stopped');
    this.name = 'SketchStopped';
  }
}

interface Timer {
  due: number;
  resolve: () => void;
}

const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SimClock {
  private simMs = 0;
  private lastReal = realNow();
  private speedFactor = 1;
  private isPaused = false;
  private timers: Timer[] = [];
  private handle: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  now(): number {
    this.sync();
    return this.simMs;
  }

  get speed(): number {
    return this.speedFactor;
  }
  set speed(v: number) {
    this.sync();
    this.speedFactor = Math.max(0.01, v);
    this.reschedule();
    this.emit();
  }

  get paused(): boolean {
    return this.isPaused;
  }
  set paused(p: boolean) {
    this.sync();
    this.isPaused = p;
    this.reschedule();
    this.emit();
  }

  /** Jump forward (e.g. single-step while paused). */
  advance(ms: number): void {
    this.sync();
    this.simMs += ms;
    this.fire();
    this.reschedule();
    this.emit();
  }

  /** Resolve after `ms` of simulated time. Rejects with SketchStopped if `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new SketchStopped());
    return new Promise((resolve, reject) => {
      const timer: Timer = { due: this.now() + Math.max(0, ms), resolve: () => {} };
      const onAbort = () => {
        this.timers = this.timers.filter((t) => t !== timer);
        reject(new SketchStopped());
      };
      timer.resolve = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.timers.push(timer);
      this.fire();
      this.reschedule();
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private sync() {
    const r = realNow();
    if (!this.isPaused) this.simMs += (r - this.lastReal) * this.speedFactor;
    this.lastReal = r;
  }

  private fire() {
    const due = this.timers.filter((t) => t.due <= this.simMs);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.due > this.simMs);
    due.sort((a, b) => a.due - b.due).forEach((t) => t.resolve());
  }

  private reschedule() {
    if (this.handle !== null) clearTimeout(this.handle);
    this.handle = null;
    if (this.isPaused || !this.timers.length) return;
    const next = Math.min(...this.timers.map((t) => t.due));
    const wait = Math.max(0, (next - this.simMs) / this.speedFactor);
    this.handle = setTimeout(() => {
      this.handle = null;
      this.sync();
      this.fire();
      this.reschedule();
    }, wait);
  }
}

/** Yield to the browser event loop without the 4 ms nested-setTimeout clamp. */
export function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}
