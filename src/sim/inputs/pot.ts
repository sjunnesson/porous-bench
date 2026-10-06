import { type InputSpec, SimInput } from './input';

export interface PotOptions {
  label?: string;
  /** 0..1 */
  start?: number;
  /** ADC noise in counts (ESP32 ADCs are noisy; ~±5 counts is typical). */
  noise?: number;
}

/** Potentiometer or slider on an ADC pin. read() matches ESP32 analogRead(): 12-bit, 0..4095. */
export class Pot extends SimInput {
  readonly kind = 'pot';
  private v: number;
  private noise: number;

  constructor(opts: PotOptions) {
    super(opts.label ?? 'Pot');
    this.v = Math.min(1, Math.max(0, opts.start ?? 0.5));
    this.noise = opts.noise ?? 3;
  }

  // UI side
  set(value: number): void {
    this.v = Math.min(1, Math.max(0, value));
    this.changed();
  }
  get value(): number {
    return this.v;
  }

  // Sketch side
  read(): number {
    const n = this.noise ? Math.round((Math.random() * 2 - 1) * this.noise) : 0;
    return Math.min(4095, Math.max(0, Math.round(this.v * 4095) + n));
  }
  analogRead(): number {
    return this.read();
  }
  /** 0..1 without noise. */
  readFloat(): number {
    return this.v;
  }
  readMilliVolts(): number {
    return Math.round((this.read() / 4095) * 3300);
  }
}

export const pot = (opts: PotOptions = {}): InputSpec<Pot> => ({ create: () => new Pot(opts) });
