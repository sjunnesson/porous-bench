import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';

export interface Co2Options {
  label?: string;
}

/** A measurement every 5 s (periodic mode), the first 5 s after it starts. */
export const PERIOD_MS = 5000;
/** Where the UI sets the room: outdoor air to the top of its specified range, ppm. */
export const PPM_RANGE: [number, number] = [400, 5000];
/** What it reports, ppm: past its specified range it still reads, less accurately. */
const OUTPUT_PPM: [number, number] = [0, 40_000];
/** What the co2 channel spans: fresh air to a room you should air. */
export const CHANNEL_PPM: [number, number] = [400, 2000];
/** At or over this, the room is stuffy. */
export const STUFFY_PPM = 1000;
/** Breathing on it: what it adds, and how fast that clears (time constant, ms). */
const BREATH_PPM = 3000;
const BREATH_TAU = 20_000;

/** The same small error for the same measurement. */
function noise(n: number, k: number): number {
  const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

export interface Co2Reading {
  co2: number;
  temperature: number;
  humidity: number;
}

/**
 * CO₂ sensor (Sensirion SCD41, photoacoustic): CO₂ in ppm, with temperature and humidity, a new
 * measurement every 5 s in periodic mode (the first 5 s after it starts), the newest kept until the
 * next. The UI sets the room's CO₂ (400 ppm outdoors, ~1000 a stuffy room) and can breathe on it,
 * which adds ~3000 ppm that clears over a minute.
 */
export class Co2 extends SimInput {
  readonly kind = 'co2';
  readonly log = new EventLog();
  private room = 650;
  private t = 22;
  private h = 45;
  private breaths: number[] = [];
  private readonly started: number;
  private measured: { n: number; r: Co2Reading } | null = null;

  constructor(
    opts: Co2Options,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'CO₂');
    this.started = clock.now();
  }

  // ---- UI side ----
  setRoom(ppm: number): void {
    this.room = Math.min(PPM_RANGE[1], Math.max(PPM_RANGE[0], ppm));
    this.changed();
  }
  get roomPpm(): number {
    return this.room;
  }
  breathe(): void {
    this.breaths.push(this.clock.now());
    if (this.breaths.length > 8) this.breaths.shift();
    this.changed();
  }
  setTemperature(c: number): void {
    this.t = Math.min(60, Math.max(-10, c));
    this.changed();
  }
  setHumidity(pct: number): void {
    this.h = Math.min(100, Math.max(0, pct));
    this.changed();
  }
  get temperature(): number {
    return this.t;
  }
  get humidity(): number {
    return this.h;
  }
  /** What's around the sensor right now, before it measures. */
  ppmAt(t: number): number {
    const breath = this.breaths.reduce((s, b) => (t >= b ? s + BREATH_PPM * Math.exp(-(t - b) / BREATH_TAU) : s), 0);
    return Math.min(OUTPUT_PPM[1], this.room + breath);
  }

  // ---- sketch side ----
  /** The newest measurement (null before the first). */
  read(): Co2Reading | null {
    this.pump();
    return this.measured?.r ?? null;
  }
  stuffy(): boolean {
    const r = this.read();
    return !!r && r.co2 >= STUFFY_PPM;
  }

  /** Each measurement since the last read, at its time. */
  private pump() {
    const last = Math.floor((this.clock.now() - this.started) / PERIOD_MS);
    if (last < 1) return;
    // A long gap: only the latest few matter.
    for (let n = Math.max((this.measured?.n ?? 0) + 1, last - 3); n <= last; n++) {
      const at = this.started + n * PERIOD_MS;
      const r = {
        co2: Math.round(Math.min(OUTPUT_PPM[1], Math.max(OUTPUT_PPM[0], this.ppmAt(at) + noise(n, 0) * 10))),
        temperature: Math.round((this.t + noise(n, 1) * 0.1) * 10) / 10,
        humidity: Math.round((this.h + noise(n, 2) * 0.4) * 10) / 10,
      };
      this.measured = { n, r };
      this.log.push('co2', { ...r });
    }
  }
}
