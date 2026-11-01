import type { SimClock } from '../clock';
import { SimInput } from './input';

export interface TofOptions {
  label?: string;
}

/** A reading every timing budget (the driver's default: 50 ms, 20 a second). */
export const BUDGET_MS = 50;
/** Long mode in the dark: 4 m; it reads nothing nearer than 4 cm. */
export const RANGE_MM: [number, number] = [40, 4000];
/** What the distance channel spans: a hand's reach, where most apps want it. */
export const CHANNEL_MM = 1200;
/** Nearer than this is `near`, until it's this much further again (so a hand held at 30 cm doesn't chatter). */
export const NEAR_MM = 300;
const NEAR_BACK_MM = 20;

/** The same small error for the same reading, so reads between two readings agree. */
function noise(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

/**
 * Time-of-flight distance sensor (VL53L1X): the distance to whatever is in front of it (a hand, a
 * wall), in mm, within its 27° cone. The UI moves the target, or takes it away. Each reading takes
 * the timing budget (50 ms) and carries a few mm of noise, more far off; past 4 m, or with nothing
 * there, it reads out of range.
 */
export class Tof extends SimInput {
  readonly kind = 'tof';
  private target: number | null = 250;
  private reading: { n: number; mm: number | null; near: boolean } = { n: -1, mm: null, near: false };

  constructor(
    opts: TofOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Distance');
  }

  // UI side
  /** What's in front of it, mm away (null: nothing). */
  setTarget(mm: number | null): void {
    this.target = mm === null ? null : Math.min(5000, Math.max(0, mm));
    this.changed();
  }
  get targetMm(): number | null {
    return this.target;
  }

  // Sketch side
  /** The latest reading: mm, or null when out of range. */
  mm(): number | null {
    const n = Math.floor(this.clock.now() / BUDGET_MS);
    if (n !== this.reading.n) {
      const t = this.target;
      const mm = t === null || t > RANGE_MM[1] ? null : Math.max(RANGE_MM[0], Math.round(t + noise(n) * (1.5 + t * 0.004)));
      this.reading = { n, mm, near: mm !== null && mm < NEAR_MM + (this.reading.near ? NEAR_BACK_MM : 0) };
    }
    return this.reading.mm;
  }
  near(): boolean {
    this.mm();
    return this.reading.near;
  }
}
