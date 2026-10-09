import type { SimClock } from '../clock';
import { SimInput } from './input';

export interface BuzzerOptions {
  label?: string;
}

/** Piezo buzzer (an output, shown with the inputs). The UI widget turns the state into sound. */
export class Buzzer extends SimInput {
  readonly kind = 'buzzer';
  /** Hz, 0 = silent. */
  freq = 0;
  /** Sim time the current tone started / stops (Infinity = until stop()). */
  startedAt = 0;
  until = 0;

  constructor(
    opts: BuzzerOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Buzzer');
  }

  beep(freq: number, durationMs: number): void {
    this.freq = freq;
    this.startedAt = this.clock.now();
    this.until = this.startedAt + durationMs;
    this.changed();
  }
  tone(freq: number): void {
    this.freq = freq;
    this.startedAt = this.clock.now();
    this.until = Infinity;
    this.changed();
  }
  stop(): void {
    this.freq = 0;
    this.until = 0;
    this.changed();
  }
  isSounding(now = this.clock.now()): boolean {
    return this.freq > 0 && now < this.until;
  }
}
