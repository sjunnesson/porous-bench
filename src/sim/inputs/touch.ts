import type { SimClock } from '../clock';
import { type InputSpec, SimInput } from './input';

export interface TouchOptions {
  label?: string;
  key?: string;
}

/**
 * Capacitive touch pad on an ESP32 touch pin. touchRead() falls when a finger is on it (≈70
 * untouched, ≈15 touched); the button-style edges make it a drop-in trigger.
 */
export class Touch extends SimInput {
  readonly kind = 'touch';
  readonly key?: string;
  private down = false;
  private pressed = false;
  private released = false;
  private since = 0;

  constructor(
    opts: TouchOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Touch pad');
    this.key = opts.key;
  }

  // UI side
  setDown(down: boolean): void {
    if (down === this.down) return;
    this.down = down;
    this.since = this.clock.now();
    if (down) this.pressed = true;
    else this.released = true;
    this.changed();
  }

  // Sketch side
  isPressed(): boolean {
    return this.down;
  }
  wasPressed(): boolean {
    const r = this.pressed;
    this.pressed = false;
    return r;
  }
  wasReleased(): boolean {
    const r = this.released;
    this.released = false;
    return r;
  }
  pressedFor(ms: number): boolean {
    return this.down && this.clock.now() - this.since >= ms;
  }
  /** ESP32 touchRead(): lower means touched. */
  touchRead(): number {
    const base = this.down ? 15 : 70;
    return base + Math.round((Math.random() * 2 - 1) * 2);
  }
}

export const touch = (opts: TouchOptions = {}): InputSpec<Touch> => ({ create: ({ clock }) => new Touch(opts, clock) });
