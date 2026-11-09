import type { SimClock } from '../clock';
import { Button } from './button';
import { SimInput } from './input';

// The SmartKnob's knob: a brushless motor under a magnetic encoder, making whatever detents and ends
// the app asks for. Modelled from the SmartKnob's firmware (scottbez1/smartknob,
// firmware/src/motor_task.cpp), not measured on one. The position moves on as that loop moves it:
// once the knob is `snap` of a position's width past the current detent's centre. Let go, the knob
// settles back to that centre as the motor pulls it, faster the stronger the detent, or the endstop
// past either end; with no pull it stays where it was left. A browser can't push back on a hand, so
// past an end the knob gives less the further it's turned, and springs back when let go. The press
// is the SmartKnob's strain gauge, and the motor clicks for it.

export interface HapticConfig {
  /** The position to set. Applied when it differs from the last config's, or `nonce` does. */
  position: number;
  nonce: number;
  /** The ends; `max` below `min`: no ends. */
  min: number;
  max: number;
  /** Degrees of turn a position. */
  width: number;
  /** How hard the knob pulls to a detent (0: no detents) and to an end. Typically 0..1. */
  detent: number;
  endstop: number;
  /** How far past a detent's centre the position moves on, in positions: past 1 holds it there. */
  snap: number;
  /** Positions it takes more turn to move away from 0 than towards it, in positions. */
  bias: number;
  /** Detents only at these positions (at most 5), turning freely between: "magnetic". */
  magnets: number[];
  /** Whatever the app calls this config, echoed in reads. */
  text: string;
}

/** Until an app sets its own: like Bench's rotary encoder, 20 detents a turn and no ends. */
export const DEFAULT_HAPTIC: HapticConfig = { position: 0, nonce: 0, min: 0, max: -1, width: 18, detent: 1, endstop: 1, snap: 1.1, bias: 0, magnets: [], text: '' };

/** The most magnetic detents a config has, as the SmartKnob's (detent_positions). */
export const MAX_MAGNETS = 5;
/** The longest `text`, as the SmartKnob's. */
export const MAX_TEXT = 50;

/** How long a detent at strength 1 takes to pull the knob most of the way back (ms, a time constant). */
const SETTLE_MS = 45;
/** Past an end, the furthest the knob gives at endstop 1, in positions (more as the end is weaker). */
const GIVE = 0.3;

export class Haptic extends SimInput {
  readonly kind = 'haptic';
  /** Pressing the knob: the strain gauge under it. */
  readonly press: Button;
  readonly keys = { left: 'ArrowLeft', right: 'ArrowRight', press: 'Enter' };
  config: HapticConfig = { ...DEFAULT_HAPTIC };
  private pos = 0;
  /** Where the knob is turned, in degrees, clockwise up; unbounded. */
  private deg = 0;
  /** Where a hand holding it has turned it (past an end the knob lags behind). */
  private hand = 0;
  /** The current position's detent centre, in degrees. */
  private centre = 0;
  private held = false;
  private settledAt: number;
  /** Positions turned so far (clockwise up), never consumed: each control counts from its own place. */
  clicks = 0;
  /** Clicks the motor has played (an app's, and one for each press): the views show each. */
  played = 0;

  constructor(
    opts: { label?: string },
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Knob');
    this.settledAt = clock.now();
    this.press = new Button({ label: `${this.label} press`, key: this.keys.press }, clock);
    this.press.subscribe(() => {
      // The SmartKnob's firmware answers a press with a strong click.
      if (this.press.isPressed()) this.played++;
      this.changed();
    });
  }

  /** A new config, as the SmartKnob takes one: whole, every field it leaves out at its default. */
  configure(next: Partial<HapticConfig>): void {
    this.advance();
    const was = this.config;
    const c: HapticConfig = { ...DEFAULT_HAPTIC, ...next, magnets: [...(next.magnets ?? [])] };
    const moved = c.position !== was.position || c.nonce !== was.nonce;
    if (moved) this.pos = Math.round(c.position);
    if (c.min <= c.max) this.pos = Math.min(c.max, Math.max(c.min, this.pos));
    // A new position or width puts the detent's centre where the knob is, keeping how far it's turned past it.
    if (moved || c.width !== was.width) {
      const sub = moved ? 0 : (this.deg - this.centre) / was.width;
      this.centre = this.deg - sub * c.width;
    }
    this.config = c;
    this.changed();
  }

  /** Back to the encoder it is until an app configures it, where it's turned now (a new app starts). */
  reset(): void {
    this.config = { ...DEFAULT_HAPTIC };
    this.pos = 0;
    this.centre = this.deg;
    this.changed();
  }

  // UI side

  /** A hand takes the knob. */
  grab(): void {
    this.advance();
    this.held = true;
    this.hand = this.deg;
  }
  /** The hand turns it by `deg` degrees (clockwise up). */
  turnBy(deg: number): void {
    if (!deg) return;
    if (!this.held) this.grab();
    this.hand += deg;
    this.follow();
  }
  /** Let go: the motor takes it back to the detent, or past an end, to the end. */
  release(): void {
    this.advance();
    this.held = false;
    this.changed();
  }
  /** The keyboard (or a dial's keys): `n` positions on, bumping into an end it can't pass. */
  turn(n: number): void {
    if (!n) return;
    this.advance();
    const c = this.config;
    const to = c.min <= c.max ? Math.min(c.max, Math.max(c.min, this.pos + n)) : this.pos + n;
    const moved = to - this.pos;
    this.pos = to;
    this.centre += moved * c.width;
    this.clicks += moved;
    // Held at an end, it bumps into it; the endstop takes it back.
    this.deg = this.hand = this.centre + (moved !== n ? Math.sign(n) * c.width * GIVE : 0);
    this.changed();
  }
  /** Play the motor's click: `strong` is the one a press gets. */
  click(_strong = false): void {
    this.played++;
    this.changed();
  }

  // Sketch side

  position(): number {
    this.advance();
    return this.pos;
  }
  /** How far it's turned past the position's detent centre, in positions (-snap..snap). */
  sub(): number {
    this.advance();
    return this.offset() / this.config.width;
  }
  /** Where it's turned, in degrees (clockwise up). */
  angle(): number {
    this.advance();
    return this.deg;
  }
  /** Where position `p`'s detent centre is, in degrees: the views draw the detents there. */
  centreOf(p: number): number {
    return this.centre + (p - this.pos) * this.config.width;
  }
  isPressed(): boolean {
    return this.press.isPressed();
  }
  isHeld(): boolean {
    return this.held;
  }
  /** Turned past an end, where the endstop pulls rather than the detent. */
  outOfBounds(): boolean {
    const c = this.config;
    const o = this.offset();
    return c.min <= c.max && ((o < 0 && this.pos === c.min) || (o > 0 && this.pos === c.max));
  }
  /** How hard the motor pulls the knob now: the endstop's past an end, else the detent's (none between magnets). */
  pull(): number {
    const c = this.config;
    if (this.outOfBounds()) return c.endstop;
    if (c.magnets.length && !c.magnets.includes(this.pos)) return 0;
    return c.detent;
  }

  /** Still moving on its own: let go off a detent's centre (or past an end) with a pull on it. Views animate while it is. */
  settling(): boolean {
    return !this.held && this.offset() !== 0 && this.pull() > 0;
  }

  /**
   * Bring the knob up to now: let go, it settles towards the detent's centre as the motor pulls it.
   * Every read does this; it doesn't notify (it runs inside renders), so views redraw while `settling()`.
   */
  advance(): void {
    const now = this.clock.now();
    const dt = now - this.settledAt;
    this.settledAt = now;
    if (this.held || dt <= 0) return;
    const pull = this.pull();
    const o = this.offset();
    if (pull <= 0 || o === 0) return;
    const left = o * Math.exp((-dt * Math.min(4, pull)) / SETTLE_MS);
    this.deg = this.centre + (Math.abs(left) < 0.01 ? 0 : left);
  }

  private offset(): number {
    return this.deg - this.centre;
  }

  /** The knob follows the hand: positions move on as the SmartKnob's loop moves them, and past an end it gives less and less. */
  private follow() {
    const c = this.config;
    const w = c.width;
    const bounded = c.min <= c.max;
    this.deg = this.hand;
    for (;;) {
      const o = this.offset();
      const up = w * (c.snap + (this.pos >= 0 ? c.bias : -c.bias));
      const down = w * (c.snap + (this.pos <= 0 ? c.bias : -c.bias));
      if (o > up && (!bounded || this.pos < c.max)) {
        this.pos++;
        this.centre += w;
        this.clicks++;
      } else if (o < -down && (!bounded || this.pos > c.min)) {
        this.pos--;
        this.centre -= w;
        this.clicks--;
      } else break;
    }
    if (this.outOfBounds()) {
      const give = w * GIVE * (2 - Math.min(1, c.endstop));
      const o = this.offset();
      this.deg = this.centre + Math.sign(o) * give * Math.tanh(Math.abs(o) / give);
    }
    this.changed();
  }
}
