// Abstract controls: what a sketch *means* ("a speed", "next"), not which part provides it.
// The user picks the hardware per control in the sidebar and can swap it while the sketch runs.
//
//   inputs: {
//     speed: dial({ label: 'Speed', min: 1, max: 20, start: 6 }),   // encoder by default
//     next: trigger({ label: 'Next', key: 'Space' }),              // push button by default
//   }
//   inputs.speed.value · inputs.speed.delta() · inputs.next.wasPressed()

import { Button } from '../inputs/button';
import { Imu } from '../inputs/imu';
import { type InputContext, type InputSpec, SimInput } from '../inputs/input';
import { Knob } from '../inputs/knob';
import { LD2410, MAX_RANGE_M } from '../inputs/ld2410';
import { Pot } from '../inputs/pot';
import type { Bench } from './bench';

// ---- dial ----------------------------------------------------------------------------------

export type DialSource = 'encoder' | 'pot' | 'imu-x' | 'imu-y' | 'buttons' | 'radar';

export const DIAL_SOURCES: { id: DialSource; label: string }[] = [
  { id: 'encoder', label: 'Rotary encoder' },
  { id: 'pot', label: 'Slide pot' },
  { id: 'imu-x', label: 'IMU tilt ←→' },
  { id: 'imu-y', label: 'IMU tilt ↑↓' },
  { id: 'buttons', label: 'Buttons − / +' },
  { id: 'radar', label: 'LD2410 distance' },
];

export interface DialOptions {
  label?: string;
  min?: number;
  max?: number;
  start?: number;
  step?: number;
  /** Wrap past min/max (relative sources only). */
  wrap?: boolean;
  /** Hardware to start with. */
  via?: DialSource;
  keys?: { down?: string; up?: string };
}

/**
 * A value in a range. Relative sources (encoder, buttons) step it; absolute ones (pot, tilt,
 * distance) set it from where the hardware is. `delta()` counts steps either way.
 */
export class Dial extends SimInput {
  readonly kind = 'dial';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly wrap: boolean;
  readonly keys: { down: string; up: string };
  source: DialSource;
  private v: number;
  private pending = 0;
  private hw: { knob?: Knob; pot?: Pot; imu?: Imu; minus?: Button; plus?: Button; radar?: LD2410 } = {};

  constructor(
    opts: DialOptions,
    private bench: Bench,
  ) {
    super(opts.label ?? 'Dial');
    this.min = opts.min ?? -Infinity;
    this.max = opts.max ?? Infinity;
    this.step = opts.step ?? 1;
    this.wrap = opts.wrap ?? false;
    this.keys = { down: 'ArrowLeft', up: 'ArrowRight', ...opts.keys };
    this.v = this.clamp(opts.start ?? (Number.isFinite(this.min) ? this.min : 0));
    this.source = opts.via ?? 'encoder';
    this.attach();
  }

  // ---- sketch side ----
  get value(): number {
    this.poll();
    return this.v;
  }
  getValue(): number {
    return this.value;
  }
  /** Steps moved since the last call (positive = up / clockwise). */
  delta(): number {
    this.poll();
    const d = this.pending;
    this.pending = 0;
    return d;
  }
  /** Position within the range, 0..1. */
  get fraction(): number {
    const { base, span } = this.range();
    return Math.min(1, Math.max(0, (this.value - base) / span));
  }

  // ---- UI side ----
  setSource(source: DialSource): void {
    if (source === this.source) return;
    this.bench.release(this);
    this.hw = {};
    this.source = source;
    this.attach();
    this.changed();
  }
  /** setSource from a stored or UI string; ignores unknown ids. */
  bind(id: string): void {
    const s = DIAL_SOURCES.find((x) => x.id === id);
    if (s) this.setSource(s.id);
  }
  /** The parts this control uses right now. */
  parts(): SimInput[] {
    return Object.values(this.hw).filter(Boolean) as SimInput[];
  }
  /** Keyboard: move the hardware itself, so the widget and the 3D part follow. */
  handleKey(code: string, down: boolean): boolean {
    if (code !== this.keys.down && code !== this.keys.up) return false;
    if (down) this.nudge(code === this.keys.up ? 1 : -1);
    return true;
  }
  detach(): void {
    this.bench.release(this);
  }

  private attach() {
    const b = this.bench;
    const label = this.label;
    switch (this.source) {
      case 'encoder':
        this.hw.knob = b.claim(this, 'rotate', 'knob', () => new Knob({ label, keys: { left: this.keys.down, right: this.keys.up } }, b.clock));
        this.hw.knob.delta(); // start counting from here
        break;
      case 'pot':
        this.hw.pot = b.claim(this, 'pot', 'pot', () => new Pot({ label, noise: 0 }));
        this.hw.pot.set(this.fractionOf(this.v)); // take over at the current value
        break;
      case 'imu-x':
      case 'imu-y': {
        const imu = (this.hw.imu = b.claim(this, 'imu', 'imu', () => new Imu({}, b.clock)));
        // Take over at the current value: tilt the board along this axis to match it.
        const t = imu.getTilt();
        const want = this.fractionOf(this.v) * 2 - 1;
        imu.setTilt(this.source === 'imu-x' ? want : t.x, this.source === 'imu-y' ? want : t.y);
        break;
      }
      case 'buttons':
        this.hw.minus = b.claim(this, 'minus', 'button', () => new Button({ label: `${label} −`, key: this.keys.down }, b.clock));
        this.hw.plus = b.claim(this, 'plus', 'button', () => new Button({ label: `${label} +`, key: this.keys.up }, b.clock));
        break;
      case 'radar':
        this.hw.radar = b.claim(this, 'radar', 'ld2410', () => new LD2410({}, b.clock));
        break;
    }
  }

  private poll() {
    const { knob, pot, imu, minus, plus, radar } = this.hw;
    switch (this.source) {
      case 'encoder':
        if (knob) this.stepBy(knob.delta());
        break;
      case 'buttons':
        if (minus?.wasPressed()) this.stepBy(-1);
        if (plus?.wasPressed()) this.stepBy(1);
        break;
      case 'pot':
        if (pot) this.setAbsolute(pot.value);
        break;
      case 'imu-x':
      case 'imu-y':
        if (imu) {
          const t = imu.getTilt();
          this.setAbsolute(((this.source === 'imu-x' ? t.x : t.y) + 1) / 2);
        }
        break;
      case 'radar':
        if (radar) {
          radar.outPin(); // pumps the sensor model
          const r = radar.latest().report;
          if (r.state) this.setAbsolute(r.detectionDistance / (MAX_RANGE_M * 100));
        }
        break;
    }
  }

  private nudge(steps: number) {
    const { knob, pot, imu, minus, plus } = this.hw;
    const { span } = this.range();
    switch (this.source) {
      case 'encoder':
        knob?.turn(steps);
        break;
      case 'buttons':
        (steps > 0 ? plus : minus)?.setDown(true);
        (steps > 0 ? plus : minus)?.setDown(false);
        break;
      case 'pot':
        pot?.set(pot.value + (steps * this.step) / span);
        break;
      case 'imu-x':
      case 'imu-y':
        if (imu) {
          const t = imu.getTilt();
          const d = (2 * steps * this.step) / span;
          imu.setTilt(this.source === 'imu-x' ? t.x + d : t.x, this.source === 'imu-y' ? t.y + d : t.y);
        }
        break;
      case 'radar':
        break; // the distance is wherever the person is
    }
    this.changed();
  }

  private stepBy(clicks: number) {
    if (!clicks) return;
    let next = this.v + clicks * this.step;
    if (this.wrap && Number.isFinite(this.min) && Number.isFinite(this.max)) {
      const span = this.max - this.min + this.step;
      next = ((((next - this.min) % span) + span) % span) + this.min;
      this.pending += clicks;
    } else {
      next = this.clamp(next);
      this.pending += Math.round((next - this.v) / this.step);
    }
    this.v = next;
  }

  private setAbsolute(f: number) {
    const { base, span } = this.range();
    const next = this.clamp(base + Math.round((Math.min(1, Math.max(0, f)) * span) / this.step) * this.step);
    if (next === this.v) return;
    this.pending += Math.round((next - this.v) / this.step);
    this.v = next;
  }

  /** Where absolute sources map: the range, or ±12 steps around the start for open ranges. */
  private range(): { base: number; span: number } {
    if (Number.isFinite(this.min) && Number.isFinite(this.max)) return { base: this.min, span: Math.max(this.step, this.max - this.min) };
    const span = 24 * this.step;
    const base = Number.isFinite(this.min) ? this.min : Number.isFinite(this.max) ? this.max - span : -span / 2;
    return { base, span };
  }

  private fractionOf(v: number): number {
    const { base, span } = this.range();
    return Math.min(1, Math.max(0, (v - base) / span));
  }

  private clamp(v: number) {
    return Math.min(this.max, Math.max(this.min, v));
  }
}

export const dial = (opts: DialOptions = {}): InputSpec<Dial> => ({
  create: (ctx: InputContext) => new Dial(opts, ctx.bench),
});

// ---- trigger -------------------------------------------------------------------------------

export type TriggerSource = 'button' | 'encoder-push' | 'shake' | 'presence';

export const TRIGGER_SOURCES: { id: TriggerSource; label: string }[] = [
  { id: 'button', label: 'Push button' },
  { id: 'encoder-push', label: 'Encoder push' },
  { id: 'shake', label: 'IMU shake' },
  { id: 'presence', label: 'LD2410 presence' },
];

export interface TriggerOptions {
  label?: string;
  /** KeyboardEvent.code that fires it, whatever the hardware. */
  key?: string;
  via?: TriggerSource;
}

/** A momentary action. Same API as a button, so code written for one works with any source. */
export class Trigger extends SimInput {
  readonly kind = 'trigger';
  readonly key?: string;
  source: TriggerSource;
  private hw: { button?: Button; knob?: Knob; imu?: Imu; radar?: LD2410 } = {};
  private keyDown = false;
  private prev = false;
  private pressed = false;
  private released = false;
  private since = 0;

  constructor(
    opts: TriggerOptions,
    private bench: Bench,
  ) {
    super(opts.label ?? 'Trigger');
    this.key = opts.key;
    this.source = opts.via ?? 'button';
    this.attach();
  }

  // ---- sketch side (Button-compatible) ----
  isPressed(): boolean {
    this.poll();
    return this.prev;
  }
  wasPressed(): boolean {
    this.poll();
    const r = this.pressed;
    this.pressed = false;
    return r;
  }
  wasReleased(): boolean {
    this.poll();
    const r = this.released;
    this.released = false;
    return r;
  }
  pressedFor(ms: number): boolean {
    return this.isPressed() && this.bench.clock.now() - this.since >= ms;
  }
  digitalRead(): 0 | 1 {
    return this.isPressed() ? 0 : 1;
  }

  // ---- UI side ----
  setSource(source: TriggerSource): void {
    if (source === this.source) return;
    this.bench.release(this);
    this.hw = {};
    this.source = source;
    this.prev = false;
    this.attach();
    this.changed();
  }
  /** setSource from a stored or UI string; ignores unknown ids. */
  bind(id: string): void {
    const s = TRIGGER_SOURCES.find((x) => x.id === id);
    if (s) this.setSource(s.id);
  }
  parts(): SimInput[] {
    return Object.values(this.hw).filter(Boolean) as SimInput[];
  }
  /** The push button behind this trigger, when its source is one (to put it on the device). */
  get buttonPart(): Button | undefined {
    return this.source === 'button' ? this.hw.button : undefined;
  }
  handleKey(code: string, down: boolean): boolean {
    if (!this.key || code !== this.key) return false;
    const b = this.pushable();
    if (b) b.setDown(down); // press the real part, so it animates
    else {
      this.keyDown = down;
      this.changed();
    }
    return true;
  }
  detach(): void {
    this.bench.release(this);
  }

  private pushable(): Button | undefined {
    return this.hw.button ?? this.hw.knob?.button;
  }

  private attach() {
    const b = this.bench;
    const label = this.label;
    switch (this.source) {
      case 'button':
        this.hw.button = b.claim(this, 'button', 'button', () => new Button({ label, key: this.key }, b.clock));
        break;
      case 'encoder-push':
        this.hw.knob = b.claim(this, 'push', 'knob', () => new Knob({ label, keys: this.key ? { press: this.key } : undefined }, b.clock));
        break;
      case 'shake':
        this.hw.imu = b.claim(this, 'imu', 'imu', () => new Imu({}, b.clock));
        break;
      case 'presence':
        this.hw.radar = b.claim(this, 'radar', 'ld2410', () => new LD2410({}, b.clock));
        break;
    }
    // Ignore edges that happened before this source was attached.
    const p = this.pushable();
    p?.wasPressed();
    p?.wasReleased();
  }

  private poll() {
    const p = this.pushable();
    if (p) {
      // Buttons keep their own edge flags, so even a tap shorter than the sketch's loop counts.
      if (p.wasPressed()) {
        this.pressed = true;
        this.since = this.bench.clock.now();
      }
      if (p.wasReleased()) this.released = true;
      this.prev = p.isPressed();
      return;
    }
    let down = this.keyDown;
    // A shake is a flick: a short press at its start, so it reads as a tap rather than a hold.
    if (this.source === 'shake') down ||= (this.hw.imu?.shakeAge() ?? Infinity) < 150;
    if (this.source === 'presence') down ||= !!this.hw.radar?.outPin();
    if (down && !this.prev) {
      this.pressed = true;
      this.since = this.bench.clock.now();
    }
    if (!down && this.prev) this.released = true;
    this.prev = down;
  }
}

export const trigger = (opts: TriggerOptions = {}): InputSpec<Trigger> => ({
  create: (ctx: InputContext) => new Trigger(opts, ctx.bench),
});

export type Control = Dial | Trigger;
export const isControl = (i: SimInput): i is Control => i.kind === 'dial' || i.kind === 'trigger';
