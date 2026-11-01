import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';

export interface SwitchOptions {
  label?: string;
  on?: boolean;
}

/**
 * A switch that stays where it's put: a toggle switch, or a reed switch that closes while a magnet is
 * near (a door, a lid). Wired to GND with INPUT_PULLUP, so it reads LOW while on. It has a button's
 * edges (on is a press, off a release), so a trigger connected to it reads `is_pressed()` while it's on.
 */
export class Switch extends SimInput {
  readonly kind = 'switch';
  /** Each flip, `switch` { on }: one on and off again between two reads is still two. */
  readonly log = new EventLog();
  private state: boolean;
  private flags = { pressed: false, released: false };
  /** Times it was switched on and off. */
  presses = 0;
  releases = 0;
  private since = 0;

  constructor(
    opts: SwitchOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Switch');
    this.state = opts.on ?? false;
  }

  // UI side
  set(on: boolean): void {
    if (on === this.state) return;
    this.state = on;
    this.since = this.clock.now();
    if (on) {
      this.presses++;
      this.flags.pressed = true;
    } else {
      this.releases++;
      this.flags.released = true;
    }
    this.log.push('switch', { on });
    this.changed();
  }
  flip(): void {
    this.set(!this.state);
  }
  /** A key held for a trigger flips it as it goes down, as a hand flicks a toggle. */
  setDown(down: boolean): void {
    if (down) this.flip();
  }

  // Sketch side
  isOn(): boolean {
    return this.state;
  }
  isPressed(): boolean {
    return this.state;
  }
  wasPressed(): boolean {
    const r = this.flags.pressed;
    this.flags.pressed = false;
    return r;
  }
  wasReleased(): boolean {
    const r = this.flags.released;
    this.flags.released = false;
    return r;
  }
  /** When it was last switched, in sim ms. */
  pressedAt(): number {
    return this.since;
  }
  /** digitalRead() with INPUT_PULLUP: 0 while on. */
  digitalRead(): 0 | 1 {
    return this.state ? 0 : 1;
  }
}
