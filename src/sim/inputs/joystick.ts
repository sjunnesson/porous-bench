import type { SimClock } from '../clock';
import { Button } from './button';
import { SimInput } from './input';

export interface JoystickOptions {
  label?: string;
}

/** Where a KY-023's pots rest, as a fraction of the supply: a little off the middle. */
const REST = 0.48;
/** The driver's dead zone around where the stick rests, as a fraction of its throw. */
export const DEAD_ZONE = 0.06;

/**
 * Analog thumb joystick (KY-023): two 10 kΩ pots on ADC pins and a push switch to GND. The UI pushes
 * the stick, which springs back to the middle when let go. `raw()` is what analogRead() gives on an
 * ESP32 with the module powered from 3V3: the stick rests a little off the middle of the range, and
 * the ADC reads 0 below ~0.1 V and 4095 above ~3.1 V. `x()` and `y()` are what Bench's driver makes
 * of them: -1..1 from where the stick rested at start (right and away from you are +), with a small
 * dead zone around it.
 */
export class Joystick extends SimInput {
  readonly kind = 'joystick';
  /** The stick pressed down (SW). */
  readonly button: Button;
  private sx = 0;
  private sy = 0;

  constructor(opts: JoystickOptions, clock: SimClock) {
    super(opts.label ?? 'Joystick');
    this.button = new Button({ label: `${this.label} push` }, clock);
    this.button.subscribe(() => this.changed());
  }

  // UI side
  /** Push the stick to (x, y), each -1..1; its round gate keeps it within the circle. */
  set(x: number, y: number): void {
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    if (x === this.sx && y === this.sy) return;
    this.sx = x;
    this.sy = y;
    this.changed();
  }
  /** Where the stick is pushed, -1..1 on each axis. */
  get position(): { x: number; y: number } {
    return { x: this.sx, y: this.sy };
  }

  // Sketch side
  /** analogRead() of VRx or VRy: 12 bits, with a few counts of noise. */
  raw(axis: 'x' | 'y'): number {
    const p = axis === 'x' ? this.sx : this.sy;
    // The wiper's voltage: from the rest point to either end of the pot.
    const f = p >= 0 ? REST + p * (1 - REST) : REST + p * REST;
    const volts = f * 3.3;
    const n = Math.round((Math.random() * 2 - 1) * 6);
    return Math.min(4095, Math.max(0, Math.round(((volts - 0.1) / 3.0) * 4095) + n));
  }
  /** -1..1 from the rest point, with the driver's dead zone. */
  axis(axis: 'x' | 'y'): number {
    const p = axis === 'x' ? this.sx : this.sy;
    if (Math.abs(p) < DEAD_ZONE) return 0;
    return Math.round(Math.sign(p) * ((Math.abs(p) - DEAD_ZONE) / (1 - DEAD_ZONE)) * 1000) / 1000;
  }
  isPressed(): boolean {
    return this.button.isPressed();
  }
  /** The way the stick is pushed past halfway ("left", "right", "up", "down"), or "center". It stays
   *  in a direction until the stick comes back inside a third, or until another way leads it by 0.15,
   *  so a stick held near halfway or along a diagonal doesn't flicker. */
  direction(was = 'center'): string {
    const x = this.axis('x');
    const y = this.axis('y');
    const m = Math.max(Math.abs(x), Math.abs(y));
    if (m < (was === 'center' ? 0.5 : 0.33)) return 'center';
    if (was !== 'center' && m < 0.5) return was;
    const best = Math.abs(x) >= Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'up' : 'down';
    const lean: Record<string, number> = { right: x, left: -x, up: y, down: -y };
    return was in lean && lean[best] - lean[was] < 0.15 ? was : best;
  }
}
