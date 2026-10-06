import type { SimClock } from '../clock';
import { type InputSpec, SimInput } from './input';

export interface ButtonOptions {
  label?: string;
  /** KeyboardEvent.code that presses it, e.g. 'Space', 'KeyA', 'Enter'. */
  key?: string;
  /** For your notes when wiring it up, e.g. 9 for the ESP32-C6 BOOT button. */
  gpio?: number;
}

/** Momentary push button, wired to GND with INPUT_PULLUP (pressed = LOW). API in the style of JC_Button/Bounce2. */
export class Button extends SimInput {
  readonly kind = 'button';
  readonly key?: string;
  readonly gpio?: number;
  private down = false;
  private pressed = false;
  private released = false;
  private since = 0;

  constructor(
    opts: ButtonOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Button');
    this.key = opts.key;
    this.gpio = opts.gpio;
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
  /** True once per press. */
  wasPressed(): boolean {
    const r = this.pressed;
    this.pressed = false;
    return r;
  }
  /** True once per release. */
  wasReleased(): boolean {
    const r = this.released;
    this.released = false;
    return r;
  }
  pressedFor(ms: number): boolean {
    return this.down && this.clock.now() - this.since >= ms;
  }
  /** What digitalRead(pin) returns with INPUT_PULLUP: 0 while pressed. */
  digitalRead(): 0 | 1 {
    return this.down ? 0 : 1;
  }
}

export const button = (opts: ButtonOptions = {}): InputSpec<Button> => ({
  create: ({ clock }) => new Button(opts, clock),
});
