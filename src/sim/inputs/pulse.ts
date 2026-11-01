import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';
import { KeySet } from './keys';

export interface PulseOptions {
  label?: string;
}

/** 100 samples a second, as the driver sets it up. */
export const SAMPLE_MS = 10;
/** The chip's FIFO: samples not read within 32 of them (320 ms) are gone. */
export const FIFO = 32;
export const BPM_RANGE: [number, number] = [40, 180];
/** IR counts (18 bits): what comes back through a fingertip, and with nothing on it. */
const FINGER_DC = 120_000;
const AIR_DC = 2_000;
/** The driver's finger threshold (IR counts), and how long the signal takes to settle once one's on. */
const FINGER_AT = 50_000;
const SETTLE_MS = 2_000;
/** Beats it averages before it gives a rate. */
const LOCK_BEATS = 4;

/** The same small offset for the same index. */
function noise(n: number, k = 0): number {
  const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

/** One beat's pulse, 0..1, by its phase: a quick rise to the peak, a notch, and a slow fall. */
function wave(phase: number): number {
  if (phase < 0.15) return Math.sin((phase / 0.15) * (Math.PI / 2));
  const fall = Math.exp(-(phase - 0.15) * 4.5);
  return fall + 0.12 * Math.exp(-(((phase - 0.42) / 0.05) ** 2));
}

/**
 * Pulse sensor (MAX30102): an IR and a red LED shine into a fingertip and a photodiode reads what comes
 * back, 100 samples a second, 18 bits, into a 32-sample FIFO. Each heartbeat swells the blood in the
 * fingertip, so less comes back: the samples dip by about 1% at every beat. The UI rests a finger on it
 * and sets the heart rate. The driver sees a finger once the IR count passes 50 000, waits for the
 * signal to settle, and gives a rate once it has a few steady beats.
 */
export class Pulse extends SimInput {
  readonly kind = 'pulse';
  /** `beat`: a short press at each beat the driver finds. */
  readonly keys: KeySet;
  readonly log = new EventLog();
  private bpm = 72;
  private fingerOn = false;
  private placedAt = -Infinity;
  private liftedAt = -Infinity;
  /** The heart's beats, as they come (only while a finger is on). */
  private beats: number[] = [];
  /** Samples taken so far: the newest FIFO of them, with the index of the first. */
  private ring: { ir: number; red: number }[] = [];
  private next = 0;
  private readonly t0: number;
  /** The driver's view: the beats it found, and whether it sees a finger. */
  private found: number[] = [];
  private beatUp: number | null = null;
  private detected = false;

  constructor(
    opts: PulseOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Pulse');
    // A key held for a `beat` trigger rests a fingertip on it, as on the `finger` channel.
    this.keys = new KeySet({ pump: () => this.pump(), press: (_, down) => this.setFinger(down) }, [{ id: 'beat', label: 'beat' }]);
    this.t0 = clock.now();
    this.next = 0;
  }

  // ---- UI side ----
  setFinger(on: boolean): void {
    if (on === this.fingerOn) return;
    this.pump();
    this.fingerOn = on;
    const now = this.clock.now();
    if (on) {
      this.placedAt = now;
      this.beats = [now + 300 + Math.abs(noise(now)) * 400]; // the heart doesn't wait for the finger
    } else {
      this.liftedAt = now;
      this.beats = [];
    }
    this.changed();
  }
  get finger(): boolean {
    return this.fingerOn;
  }
  setBpm(bpm: number): void {
    this.bpm = Math.min(BPM_RANGE[1], Math.max(BPM_RANGE[0], bpm));
    this.changed();
  }
  get heartRate(): number {
    return this.bpm;
  }

  // ---- sketch side ----
  /** Whether the driver sees a finger, its rate (null until it has one), and the newest sample. */
  read(): { finger: boolean; bpm: number | null; ir: number; red: number } {
    this.pump();
    const last = this.ring[this.ring.length - 1] ?? { ir: AIR_DC, red: AIR_DC };
    return { finger: this.detected, bpm: this.rate(), ir: last.ir, red: last.red };
  }
  /** The IR samples after index `since` (at most the FIFO's 32), and the index of the newest. */
  samplesSince(since: number): { ir: number[]; last: number } {
    this.pump();
    const last = this.next - 1;
    const from = Math.max(since + 1, this.next - FIFO);
    const first = this.next - this.ring.length;
    return { ir: this.ring.slice(from - first).map((s) => s.ir), last };
  }

  private rate(): number | null {
    if (!this.detected || this.found.length < LOCK_BEATS + 1) return null;
    const recent = this.found.slice(-(LOCK_BEATS + 1));
    return Math.round(60_000 / ((recent[recent.length - 1] - recent[0]) / LOCK_BEATS));
  }

  /** Every sample up to now, and the beats the driver finds among them. */
  private pump() {
    const now = this.clock.now();
    const due = Math.floor((now - this.t0) / SAMPLE_MS);
    // A long gap: the FIFO only holds the last 32, and the driver only cares about the last few seconds.
    // It starts its count over, as a driver whose FIFO overflowed would: beats across the gap aren't a rate.
    if (due - this.next > 600) {
      this.next = due - 600;
      this.found = [];
    }
    for (; this.next <= due; this.next++) this.sample(this.t0 + this.next * SAMPLE_MS, this.next);
  }

  private sample(t: number, n: number) {
    if (this.beatUp !== null && t >= this.beatUp) {
      this.keys.edge('beat', false, this.beatUp);
      this.beatUp = null;
    }
    // The heart's next beat, ±3% after the last, at the rate set now.
    while (this.fingerOn && this.beats[this.beats.length - 1] <= t) {
      const b = this.beats.length;
      this.beats.push(this.beats[b - 1] + (60_000 / this.bpm) * (1 + noise(b, 7) * 0.03));
    }
    while (this.beats.length > 2 && this.beats[1] < t - 2000) this.beats.shift();
    let pulse = 0;
    let beatAt: number | null = null;
    for (let i = 0; i + 1 < this.beats.length; i++) {
      if (this.beats[i] <= t && t < this.beats[i + 1]) {
        pulse = wave((t - this.beats[i]) / (this.beats[i + 1] - this.beats[i]));
        // The driver finds a beat at its peak, a moment after it starts.
        const peak = this.beats[i] + 0.15 * (this.beats[i + 1] - this.beats[i]);
        if (t - SAMPLE_MS < peak && peak <= t) beatAt = t;
        break;
      }
    }
    // A fingertip coming down or lifting off moves the count over half a second; a fresh one wanders.
    const on = this.fingerOn ? 1 - Math.exp(-(t - this.placedAt) / 150) : Math.exp(-(t - this.liftedAt) / 80);
    const settling = this.fingerOn ? Math.max(0, 1 - (t - this.placedAt) / SETTLE_MS) : 0;
    const dc = AIR_DC + (FINGER_DC - AIR_DC) * Math.min(1, Math.max(0, on));
    const wander = settling * 4000 * Math.sin(t / 230);
    const ir = Math.round(dc + wander - (this.fingerOn ? dc * 0.01 * pulse : 0) + noise(n) * 40);
    const red = Math.round(dc * 0.75 + wander * 0.8 - (this.fingerOn ? dc * 0.75 * 0.006 * pulse : 0) + noise(n, 1) * 40);
    this.ring.push({ ir, red });
    if (this.ring.length > FIFO * 2) this.ring.shift();
    // The driver.
    const finger = ir > FINGER_AT;
    if (finger !== this.detected) {
      this.detected = finger;
      this.found = [];
      this.log.push('finger', { on: finger });
    }
    if (finger && beatAt !== null && t - this.placedAt >= SETTLE_MS) {
      this.found.push(beatAt);
      if (this.found.length > 8) this.found.shift();
      this.keys.edge('beat', true, beatAt);
      this.beatUp = beatAt + 100;
      const bpm = this.rate();
      if (bpm !== null) this.log.push('beat', { bpm });
    }
  }
}
