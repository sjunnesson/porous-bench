import type { SimClock } from '../clock';
import { Button } from './button';
import { type InputSpec, SimInput } from './input';

export interface KnobOptions {
  label?: string;
  min?: number;
  max?: number;
  start?: number;
  /** Wrap around past min/max instead of stopping. */
  wrap?: boolean;
  /** Detents per full turn (EC11 encoders are usually 20). */
  detents?: number;
  /** Keys that turn it (KeyboardEvent.code). Default ArrowLeft/ArrowRight, push = Enter. */
  keys?: { left?: string; right?: string; press?: string };
}

/** Rotary encoder (e.g. EC11) with a push switch. Count it with an encoder library on hardware. */
export class Knob extends SimInput {
  readonly kind = 'knob';
  readonly min: number;
  readonly max: number;
  readonly wrap: boolean;
  readonly detents: number;
  readonly keys: { left: string; right: string; press: string };
  /** The encoder's push switch. */
  readonly button: Button;
  private pos: number;
  private pending = 0;

  constructor(opts: KnobOptions, clock: SimClock) {
    super(opts.label ?? 'Knob');
    this.min = opts.min ?? -Infinity;
    this.max = opts.max ?? Infinity;
    this.wrap = opts.wrap ?? false;
    this.detents = opts.detents ?? 20;
    this.pos = Math.min(this.max, Math.max(this.min, opts.start ?? 0));
    this.keys = { left: 'ArrowLeft', right: 'ArrowRight', press: 'Enter', ...opts.keys };
    this.button = new Button({ label: `${this.label} push`, key: this.keys.press }, clock);
    this.button.subscribe(() => this.changed());
  }

  // UI side
  turn(clicks: number): void {
    if (!clicks) return;
    let next = this.pos + clicks;
    if (this.wrap && Number.isFinite(this.min) && Number.isFinite(this.max)) {
      const span = this.max - this.min + 1;
      next = ((((next - this.min) % span) + span) % span) + this.min;
    } else next = Math.min(this.max, Math.max(this.min, next));
    this.pending += clicks;
    if (next !== this.pos) this.pos = next;
    this.changed();
  }

  // Sketch side
  getPosition(): number {
    return this.pos;
  }
  setPosition(v: number): void {
    this.pos = Math.min(this.max, Math.max(this.min, Math.round(v)));
    this.changed();
  }
  /** Clicks turned since the last call (positive = clockwise). */
  delta(): number {
    const d = this.pending;
    this.pending = 0;
    return d;
  }
  isPressed(): boolean {
    return this.button.isPressed();
  }
  wasPressed(): boolean {
    return this.button.wasPressed();
  }
}

export const knob = (opts: KnobOptions = {}): InputSpec<Knob> => ({
  create: ({ clock }) => new Knob(opts, clock),
});
