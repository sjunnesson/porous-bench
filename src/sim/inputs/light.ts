import { SimInput } from './input';

export interface LightOptions {
  label?: string;
  /** 0..1, dark to bright sunlight (log scale; 0.5 ≈ a lit room). */
  start?: number;
}

/**
 * Ambient light sensor: an LDR on an ADC pin or a BH1750-style lux sensor. The UI sets a level
 * 0..1 on a log scale from 1 to 10 000 lux; read() is the LDR divider's 12-bit ADC value.
 */
export class LightSensor extends SimInput {
  readonly kind = 'light';
  private v: number;

  constructor(opts: LightOptions) {
    super(opts.label ?? 'Light sensor');
    this.v = Math.min(1, Math.max(0, opts.start ?? 0.55));
  }

  // UI side
  set(level: number): void {
    this.v = Math.min(1, Math.max(0, level));
    this.changed();
  }
  get level(): number {
    return this.v;
  }

  // Sketch side
  /** Illuminance in lux, 1 .. 10 000. */
  lux(): number {
    return Math.round(10 ** (this.v * 4));
  }
  /** 12-bit ADC reading of an LDR divider (brighter = higher), with a little noise. */
  read(): number {
    const n = Math.round((Math.random() * 2 - 1) * 4);
    return Math.min(4095, Math.max(0, Math.round(this.v * 4095) + n));
  }
}
