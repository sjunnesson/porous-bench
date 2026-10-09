import type { SimClock } from '../clock';
import { SimInput } from './input';

export interface ImuOptions {
  label?: string;
}

/**
 * 6-axis IMU (e.g. MPU6886). The UI tilts the device; accel() returns gravity in the body frame
 * (face-up at rest ≈ (0, 0, +1) g) and gyro() the rotation rate in °/s. shake() adds a burst.
 */
export class Imu extends SimInput {
  readonly kind = 'imu';
  /** Gravity components along X/Y in g, |(x, y)| ≤ 1. */
  private tx = 0;
  private ty = 0;
  private rate = { x: 0, y: 0, t: 0 };
  private shakeAt = -Infinity;

  constructor(
    opts: ImuOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'IMU');
  }

  // UI side
  setTilt(x: number, y: number): void {
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    const now = this.clock.now();
    const dt = Math.max(1, now - this.rate.t) / 1000;
    // Rotation about X tilts gravity into Y, and vice versa.
    const deg = (v: number) => (Math.asin(Math.max(-1, Math.min(1, v))) * 180) / Math.PI;
    this.rate = { x: (deg(y) - deg(this.ty)) / dt, y: -(deg(x) - deg(this.tx)) / dt, t: now };
    this.tx = x;
    this.ty = y;
    this.changed();
  }
  getTilt(): { x: number; y: number } {
    return { x: this.tx, y: this.ty };
  }
  shake(): void {
    this.shakeAt = this.clock.now();
    this.changed();
  }
  isShaking(): boolean {
    return this.clock.now() - this.shakeAt < 700;
  }
  /** ms since the last shake started (Infinity if never). */
  shakeAge(): number {
    return this.clock.now() - this.shakeAt;
  }

  // Sketch side
  accel(): [number, number, number] {
    const t = this.clock.now();
    let x = this.tx;
    let y = this.ty;
    let z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const s = (t - this.shakeAt) / 1000;
    if (s >= 0 && s < 0.7) {
      const env = 1 - s / 0.7;
      x += 2.6 * env * Math.sin(s * 2 * Math.PI * 9);
      y += 1.4 * env * Math.sin(s * 2 * Math.PI * 7 + 1);
      z += 0.8 * env * Math.sin(s * 2 * Math.PI * 11 + 2);
    }
    const n = () => (Math.random() - 0.5) * 0.02;
    return [x + n(), y + n(), z + n()];
  }
  gyro(): [number, number, number] {
    const t = this.clock.now();
    const decay = Math.exp(-(t - this.rate.t) / 120);
    const s = (t - this.shakeAt) / 1000;
    const shake = s >= 0 && s < 0.7 ? 220 * (1 - s / 0.7) * Math.sin(s * 2 * Math.PI * 8) : 0;
    const n = () => (Math.random() - 0.5) * 0.6;
    return [this.rate.x * decay + shake + n(), this.rate.y * decay - shake * 0.6 + n(), shake * 0.3 + n()];
  }
}
