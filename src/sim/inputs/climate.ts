import { type InputSpec, SimInput } from './input';

export interface ClimateOptions {
  label?: string;
  temperature?: number;
  humidity?: number;
}

export const TEMP_RANGE: [number, number] = [-10, 45];

/** Temperature and humidity sensor (DHT22 / BME280-style). The UI sets both; reads carry sensor-sized noise. */
export class Climate extends SimInput {
  readonly kind = 'climate';
  private t: number;
  private h: number;

  constructor(opts: ClimateOptions) {
    super(opts.label ?? 'Temp / humidity');
    this.t = opts.temperature ?? 21.5;
    this.h = opts.humidity ?? 45;
  }

  // UI side
  setTemperature(c: number): void {
    this.t = Math.min(TEMP_RANGE[1], Math.max(TEMP_RANGE[0], c));
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

  // Sketch side: one decimal, like the sensors report.
  readTemperature(): number {
    return Math.round((this.t + (Math.random() - 0.5) * 0.2) * 10) / 10;
  }
  readHumidity(): number {
    return Math.round(Math.min(100, Math.max(0, this.h + (Math.random() - 0.5) * 0.6)) * 10) / 10;
  }
}

export const climate = (opts: ClimateOptions = {}): InputSpec<Climate> => ({ create: () => new Climate(opts) });
