// Abstract controls: what an app *means* ("a speed", "next"), not which part provides it. Each one
// connects to a channel of a part on the bench (a slide pot's position, an encoder's push, the
// light level), chosen in the Connections panel and changeable while the app runs. Unconnected,
// a control still answers to its keyboard keys.
//
//   local speed = dial.new("speed", { min = 1, max = 20, start = 6 })   -- Lua (Bench driver)
//   local next = trigger.new("next", { key = "Space" })
//   speed:value() · speed:delta() · next:was_pressed()

import type { Button } from '../inputs/button';
import { type Climate, TEMP_RANGE } from '../inputs/climate';
import type { Imu } from '../inputs/imu';
import { type InputContext, type InputSpec, SimInput } from '../inputs/input';
import type { Knob } from '../inputs/knob';
import { type LD2410, MAX_RANGE_M } from '../inputs/ld2410';
import type { LightSensor } from '../inputs/light';
import type { Pir } from '../inputs/pir';
import type { Pot } from '../inputs/pot';
import type { Touch } from '../inputs/touch';
import { type Bench, type Connection, connectionId, parseConnection, type Preference } from './bench';

/** Hardware a dial asks for first (`via`). Any absolute or relative channel on the bench will do. */
export const DIAL_VIA: Record<string, Preference> = {
  encoder: { kind: 'knob', channel: 'rotate' },
  pot: { kind: 'pot', channel: 'position' },
  'imu-x': { kind: 'imu', channel: 'tilt-x' },
  'imu-y': { kind: 'imu', channel: 'tilt-y' },
  radar: { kind: 'ld2410', channel: 'distance' },
  light: { kind: 'light', channel: 'level' },
  temperature: { kind: 'climate', channel: 'temperature' },
  humidity: { kind: 'climate', channel: 'humidity' },
};
/** Hardware a trigger asks for first (`via`). */
export const TRIGGER_VIA: Record<string, Preference> = {
  button: { kind: 'button' },
  'external-button': { kind: 'button', external: true },
  'encoder-push': { kind: 'knob', channel: 'push' },
  touch: { kind: 'touch' },
  shake: { kind: 'imu', channel: 'shake' },
  presence: { kind: 'ld2410', channel: 'presence' },
  motion: { kind: 'pir', channel: 'motion' },
  dark: { kind: 'light', channel: 'dark' },
};

/** A `connect` option as a preference: that part's channel first. */
function asked(connect?: string): Preference {
  const c = connect ? parseConnection(connect) : null;
  return c ? { part: c.part, channel: c.channel } : {};
}

/** Something with a button's edges: a push button, an encoder's push, a touch pad. */
interface Pushable {
  isPressed(): boolean;
  wasPressed(): boolean;
  wasReleased(): boolean;
  setDown(down: boolean): void;
  /** Edges so far, never consumed. */
  readonly presses: number;
  readonly releases: number;
}

/** A 0..1 reading from an absolute channel, or null when the part has nothing to say (radar: no one). */
function absolute(part: SimInput, channel: string): number | null {
  switch (part.kind) {
    case 'pot':
      return (part as Pot).value;
    case 'imu': {
      const t = (part as Imu).getTilt();
      return ((channel === 'tilt-x' ? t.x : t.y) + 1) / 2;
    }
    case 'ld2410': {
      const r = part as LD2410;
      r.outPin(); // pumps the sensor model
      const rep = r.latest().report;
      return rep.state ? rep.detectionDistance / (MAX_RANGE_M * 100) : null;
    }
    case 'light':
      return (part as LightSensor).level;
    case 'climate': {
      const c = part as Climate;
      return channel === 'humidity' ? c.humidity / 100 : (c.temperature - TEMP_RANGE[0]) / (TEMP_RANGE[1] - TEMP_RANGE[0]);
    }
  }
  return null;
}

/** Move a part so an absolute channel reads `f` (keyboard nudges move the hardware itself). */
function setAbsolute(part: SimInput, channel: string, f: number): void {
  f = Math.min(1, Math.max(0, f));
  switch (part.kind) {
    case 'pot':
      (part as Pot).set(f);
      break;
    case 'imu': {
      const imu = part as Imu;
      const t = imu.getTilt();
      imu.setTilt(channel === 'tilt-x' ? f * 2 - 1 : t.x, channel === 'tilt-y' ? f * 2 - 1 : t.y);
      break;
    }
    case 'light':
      (part as LightSensor).set(f);
      break;
    case 'climate': {
      const c = part as Climate;
      if (channel === 'humidity') c.setHumidity(f * 100);
      else c.setTemperature(TEMP_RANGE[0] + f * (TEMP_RANGE[1] - TEMP_RANGE[0]));
      break;
    }
  }
}

/** The button behind a momentary channel, if it has real press/release edges. */
function pushableOf(part: SimInput, channel: string): Pushable | undefined {
  if (part.kind === 'button' || part.kind === 'touch') return part as Button | Touch;
  if (part.kind === 'knob' && channel === 'push') return (part as Knob).button;
  return undefined;
}

/** Is a level-style momentary channel (shake, presence, motion, dark) active right now? */
function levelOn(part: SimInput, channel: string): boolean {
  switch (part.kind) {
    case 'imu':
      // A shake is a flick: a short press at its start, so it reads as a tap rather than a hold.
      return (part as Imu).shakeAge() < 150;
    case 'ld2410':
      return !!(part as LD2410).outPin();
    case 'pir':
      return (part as Pir).motion();
    case 'light':
      return channel === 'dark' && (part as LightSensor).level < 0.15;
  }
  return false;
}

// ---- dial ----------------------------------------------------------------------------------

export interface DialOptions {
  label?: string;
  min?: number;
  max?: number;
  start?: number;
  step?: number;
  /** Wrap past min/max (relative sources only). */
  wrap?: boolean;
  /** Hardware to ask for first: a DIAL_VIA name. */
  via?: string;
  /** A specific part and channel to connect to, as 'part:channel' (wins over `via`). */
  connect?: string;
  keys?: { down?: string; up?: string };
}

/**
 * A value in a range. A relative channel (encoder) steps it; an absolute one (pot, tilt, light,
 * distance, temperature) sets it across the range. `delta()` counts steps either way.
 */
export class Dial extends SimInput {
  readonly kind = 'dial';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly wrap: boolean;
  readonly keys: { down: string; up: string };
  private v: number;
  private pending = 0;
  private knobBase: Knob | null = null;

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
    const c = bench.suggest('dial', this, { ...(DIAL_VIA[opts.via ?? 'encoder'] ?? {}), ...asked(opts.connect) });
    this.connect(c, connectionId(c) !== opts.connect);
  }

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
  get connection(): Connection | null {
    return this.bench.linkOf(this);
  }
  /** As a string for a <select>: 'part:channel', or 'none'. */
  get source(): string {
    return connectionId(this.connection);
  }
  /** `auto`: picked by the bench rather than asked for, so it gives way to a control that asks. */
  connect(c: Connection | null, auto = false): void {
    this.bench.link(this, c, auto);
    const hw = this.bench.resolve(c);
    // An encoder steps from where it is now.
    this.knobBase = hw?.channel.kind === 'relative' ? (hw.part as Knob) : null;
    this.knobBase?.delta();
    this.changed();
  }
  /** A stored or UI string: 'part:channel' or 'none'. Ignores connections the bench can't make. */
  bind(id: string): void {
    if (id === 'none') return this.connect(null);
    const c = parseConnection(id);
    const hw = this.bench.resolve(c);
    if (c && hw && hw.channel.kind !== 'momentary') this.connect(c);
  }
  /** The part this control reads right now. */
  parts(): SimInput[] {
    const hw = this.bench.resolve(this.connection);
    return hw ? [hw.part] : [];
  }
  /** Keyboard: move the hardware itself, so the widget and the 3D part follow. */
  handleKey(code: string, down: boolean): boolean {
    if (code !== this.keys.down && code !== this.keys.up) return false;
    if (down) this.nudge(code === this.keys.up ? 1 : -1);
    return true;
  }
  detach(): void {
    this.bench.unlink(this);
  }

  private poll() {
    const hw = this.bench.resolve(this.connection);
    if (!hw) return;
    if (hw.channel.kind === 'relative') {
      const knob = hw.part as Knob;
      if (knob !== this.knobBase) {
        knob.delta(); // reconnected to another encoder: count from here
        this.knobBase = knob;
      }
      this.stepBy(knob.delta());
    } else {
      const f = absolute(hw.part, hw.channel.id);
      if (f !== null) this.setFraction(f);
    }
  }

  private nudge(steps: number) {
    const hw = this.bench.resolve(this.connection);
    if (!hw) this.stepBy(steps);
    else if (hw.channel.kind === 'relative') (hw.part as Knob).turn(steps);
    else {
      const { span } = this.range();
      const f = absolute(hw.part, hw.channel.id) ?? this.fraction;
      setAbsolute(hw.part, hw.channel.id, f + (steps * this.step) / span);
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

  private setFraction(f: number) {
    const { base, span } = this.range();
    const next = this.clamp(base + Math.round((Math.min(1, Math.max(0, f)) * span) / this.step) * this.step);
    if (next === this.v) return;
    this.pending += Math.round((next - this.v) / this.step);
    this.v = next;
  }

  /** Where absolute channels map: the range, or ±12 steps around the start for open ranges. */
  private range(): { base: number; span: number } {
    if (Number.isFinite(this.min) && Number.isFinite(this.max)) return { base: this.min, span: Math.max(this.step, this.max - this.min) };
    const span = 24 * this.step;
    const base = Number.isFinite(this.min) ? this.min : Number.isFinite(this.max) ? this.max - span : -span / 2;
    return { base, span };
  }

  private clamp(v: number) {
    return Math.min(this.max, Math.max(this.min, v));
  }
}

export const dial = (opts: DialOptions = {}): InputSpec<Dial> => ({
  create: (ctx: InputContext) => new Dial(opts, ctx.bench),
});

// ---- trigger -------------------------------------------------------------------------------

export interface TriggerOptions {
  label?: string;
  /** KeyboardEvent.code that fires it, whatever the hardware. */
  key?: string;
  /** Hardware to ask for first: a TRIGGER_VIA name. */
  via?: string;
  /** Ask for the board's n-th button first (Resident's A and B). */
  builtin?: number;
  /** A specific part and channel to connect to, as 'part:channel' (wins over `via`). */
  connect?: string;
}

/** A momentary action. Same API as a button, so code written for one works with any source. */
export class Trigger extends SimInput {
  readonly kind = 'trigger';
  readonly key?: string;
  private keyDown = false;
  private prev = false;
  private pressed = false;
  private released = false;
  private since = 0;
  /** The connected button's edge counts as far as this trigger has taken them. */
  private seenPresses = 0;
  private seenReleases = 0;
  /** Press and release edges so far: a host can turn them into events without consuming them. */
  presses = 0;
  releases = 0;

  constructor(
    opts: TriggerOptions,
    private bench: Bench,
  ) {
    super(opts.label ?? 'Trigger');
    this.key = opts.key;
    const c = bench.suggest('trigger', this, { ...(TRIGGER_VIA[opts.via ?? 'button'] ?? {}), builtin: opts.builtin, ...asked(opts.connect) });
    // Its own board button, or the part the app named, is what it asked for; anything else was picked for it.
    const own = opts.builtin !== undefined && !!c && bench.part(c.part) === bench.builtinButton(opts.builtin);
    this.connect(c, !own && connectionId(c) !== opts.connect);
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
  get connection(): Connection | null {
    return this.bench.linkOf(this);
  }
  get source(): string {
    return connectionId(this.connection);
  }
  /** `auto`: picked by the bench rather than asked for, so it gives way to a control that asks. */
  connect(c: Connection | null, auto = false): void {
    this.bench.link(this, c, auto);
    this.prev = false;
    // Ignore edges that happened before this connection.
    const hw = this.bench.resolve(c);
    const p = hw && pushableOf(hw.part, hw.channel.id);
    p?.wasPressed();
    p?.wasReleased();
    this.seenPresses = p?.presses ?? 0;
    this.seenReleases = p?.releases ?? 0;
    this.changed();
  }
  bind(id: string): void {
    if (id === 'none') return this.connect(null);
    const c = parseConnection(id);
    const hw = this.bench.resolve(c);
    if (c && hw && hw.channel.kind === 'momentary') this.connect(c);
  }
  parts(): SimInput[] {
    const hw = this.bench.resolve(this.connection);
    return hw ? [hw.part] : [];
  }
  /** Connected to a sensor (motion, presence, shake, dark) rather than something you press and hold. */
  get sensed(): boolean {
    const hw = this.bench.resolve(this.connection);
    return !!hw && !pushableOf(hw.part, hw.channel.id);
  }
  handleKey(code: string, down: boolean): boolean {
    if (!this.key || code !== this.key) return false;
    const hw = this.bench.resolve(this.connection);
    const p = hw && pushableOf(hw.part, hw.channel.id);
    if (p) p.setDown(down); // press the real part, so it animates
    else if (hw?.part.kind === 'pir') (hw.part as Pir).setMoving(down); // wave at the real sensor
    else if (hw?.part.kind === 'imu') {
      if (down) (hw.part as Imu).shake();
    } else {
      this.keyDown = down;
      this.poll(); // latch the edge now: a tap can be over before the app next reads
      this.changed();
    }
    return true;
  }
  detach(): void {
    this.bench.unlink(this);
  }

  private poll() {
    const hw = this.bench.resolve(this.connection);
    const p = hw && pushableOf(hw.part, hw.channel.id);
    if (p) {
      // Buttons count their own edges, so every tap counts, even several between two reads.
      for (;;) {
        if (this.seenPresses <= this.seenReleases && this.seenPresses < p.presses) {
          this.seenPresses++;
          this.edge(true);
        } else if (this.seenReleases < p.releases) {
          this.seenReleases++;
          this.edge(false);
        } else break;
      }
      this.prev = p.isPressed();
      return;
    }
    const down = this.keyDown || (hw ? levelOn(hw.part, hw.channel.id) : false);
    if (down !== this.prev) this.edge(down);
    this.prev = down;
  }

  private edge(down: boolean) {
    if (down) {
      this.pressed = true;
      this.presses++;
      this.since = this.bench.clock.now();
    } else {
      this.released = true;
      this.releases++;
    }
  }
}

export const trigger = (opts: TriggerOptions = {}): InputSpec<Trigger> => ({
  create: (ctx: InputContext) => new Trigger(opts, ctx.bench),
});

export type Control = Dial | Trigger;
export const isControl = (i: SimInput): i is Control => i.kind === 'dial' || i.kind === 'trigger';
