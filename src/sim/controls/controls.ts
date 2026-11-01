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
import { CHANNEL_PPM, type Co2 } from '../inputs/co2';
import type { Imu } from '../inputs/imu';
import type { IrReceiver } from '../inputs/ir';
import { type InputContext, type InputSpec, SimInput } from '../inputs/input';
import type { Knob } from '../inputs/knob';
import type { Joystick } from '../inputs/joystick';
import type { Keypad } from '../inputs/keypad';
import { type LD2410, MAX_RANGE_M } from '../inputs/ld2410';
import type { LightSensor } from '../inputs/light';
import { LEVEL_RANGE, type Mic } from '../inputs/mic';
import type { Pir } from '../inputs/pir';
import type { Pot } from '../inputs/pot';
import { BPM_RANGE, type Pulse } from '../inputs/pulse';
import type { RfidReader } from '../inputs/rfid';
import type { Switch } from '../inputs/switch';
import { SIZE, type Thermal } from '../inputs/thermal';
import { CHANNEL_MM, type Tof } from '../inputs/tof';
import type { Touch } from '../inputs/touch';
import { type Bench, type Connection, connectionId, parseConnection, type Preference } from './bench';

/** Hardware a dial asks for first (`via`). Any absolute or relative channel on the bench will do. */
export const DIAL_VIA: Record<string, Preference> = {
  encoder: { kind: 'knob', channel: 'rotate' },
  pot: { kind: 'pot', channel: 'position' },
  'joystick-x': { kind: 'joystick', channel: 'x' },
  'joystick-y': { kind: 'joystick', channel: 'y' },
  'imu-x': { kind: 'imu', channel: 'tilt-x' },
  'imu-y': { kind: 'imu', channel: 'tilt-y' },
  radar: { kind: 'ld2410', channel: 'distance' },
  distance: { kind: 'tof', channel: 'distance' },
  'heat-x': { kind: 'thermal', channel: 'hot-x' },
  'heat-y': { kind: 'thermal', channel: 'hot-y' },
  light: { kind: 'light', channel: 'level' },
  sound: { kind: 'mic', channel: 'level' },
  temperature: { kind: 'climate', channel: 'temperature' },
  humidity: { kind: 'climate', channel: 'humidity' },
  co2: { kind: 'co2', channel: 'co2' },
  pulse: { kind: 'pulse', channel: 'bpm' },
};
/** Hardware a trigger asks for first (`via`). */
export const TRIGGER_VIA: Record<string, Preference> = {
  button: { kind: 'button' },
  'external-button': { kind: 'button', external: true },
  switch: { kind: 'switch', channel: 'on' },
  'encoder-push': { kind: 'knob', channel: 'push' },
  'joystick-press': { kind: 'joystick', channel: 'press' },
  touch: { kind: 'touch' },
  ir: { kind: 'ir', channel: 'any' },
  keypad: { kind: 'keypad', channel: 'any' },
  rfid: { kind: 'rfid', channel: 'tag' },
  shake: { kind: 'imu', channel: 'shake' },
  presence: { kind: 'ld2410', channel: 'presence' },
  near: { kind: 'tof', channel: 'near' },
  warm: { kind: 'thermal', channel: 'warm' },
  motion: { kind: 'pir', channel: 'motion' },
  dark: { kind: 'light', channel: 'dark' },
  clap: { kind: 'mic', channel: 'clap' },
  stuffy: { kind: 'co2', channel: 'stuffy' },
  heartbeat: { kind: 'pulse', channel: 'beat' },
  finger: { kind: 'pulse', channel: 'finger' },
};

/** A `connect` option as a preference: that part's channel first. */
function asked(connect?: string): Preference {
  const c = connect ? parseConnection(connect) : null;
  return c ? { part: c.part, channel: c.channel } : {};
}

/** Something with a button's edges: a push button, an encoder's push, a touch pad, a remote's key. */
export interface Pushable {
  isPressed(): boolean;
  wasPressed(): boolean;
  wasReleased(): boolean;
  setDown(down: boolean): void;
  /** Edges so far, never consumed. */
  readonly presses: number;
  readonly releases: number;
  /** What the n-th press (1 = the first) carried: the key's name, a card's UID. Unset: nothing. */
  codeOf?(press: number): string | null;
  /** When it last went down (or its n-th press did), in sim ms, for a part that knows (else: when the trigger noticed). */
  pressedAt?(press?: number): number;
}

/**
 * How the controls read each kind of part's channels: an absolute channel as 0..1 (and the keyboard
 * moving the part itself), a momentary one as something with edges, or as a level that's on or off.
 */
interface ChannelIO {
  /** An absolute channel's reading, 0..1, or null when the part has nothing to say (radar: no one). */
  absolute?(part: SimInput, channel: string): number | null;
  /** Move the part so an absolute channel reads `f` (keyboard nudges move the hardware itself). */
  setAbsolute?(part: SimInput, channel: string, f: number): void;
  /** Where the part is set, 0..1, for a sensor whose reading lags or wanders from it: nudges start here. */
  setting?(part: SimInput, channel: string): number | null;
  /** The part behind a momentary channel, if it has real press/release edges. */
  pushable?(part: SimInput, channel: string): Pushable | undefined;
  /** A level-style momentary channel (shake, presence, motion, dark): is it on right now? */
  level?(part: SimInput, channel: string): boolean;
  /** A trigger's key on a level channel: work the hardware (wave at the PIR, shake the IMU). */
  key?(part: SimInput, channel: string, down: boolean): void;
}

const IO: Partial<Record<SimInput['kind'], ChannelIO>> = {
  button: { pushable: (p) => p as Button },
  touch: { pushable: (p) => p as Touch },
  // On is a press that lasts: a trigger reads is_pressed() for as long as it's on.
  switch: { pushable: (p) => p as Switch },
  ir: { pushable: (p, ch) => (p as IrReceiver).keys.get(ch) },
  keypad: { pushable: (p, ch) => (p as Keypad).keys.get(ch) },
  rfid: { pushable: (p, ch) => (p as RfidReader).keys.get(ch) },
  knob: { pushable: (p, ch) => (ch === 'push' ? (p as Knob).button : undefined) },
  pot: {
    absolute: (p) => (p as Pot).value,
    setAbsolute: (p, _, f) => (p as Pot).set(f),
  },
  joystick: {
    // Where the stick is, without the driver's dead zone, so keyboard nudges move it from the middle.
    absolute: (p, ch) => ((p as Joystick).position[ch === 'x' ? 'x' : 'y'] + 1) / 2,
    setAbsolute(p, ch, f) {
      const j = p as Joystick;
      const { x, y } = j.position;
      j.set(ch === 'x' ? f * 2 - 1 : x, ch === 'y' ? f * 2 - 1 : y);
    },
    pushable: (p, ch) => (ch === 'press' ? (p as Joystick).button : undefined),
  },
  imu: {
    absolute(p, ch) {
      const t = (p as Imu).getTilt();
      return ((ch === 'tilt-x' ? t.x : t.y) + 1) / 2;
    },
    setAbsolute(p, ch, f) {
      const imu = p as Imu;
      const t = imu.getTilt();
      imu.setTilt(ch === 'tilt-x' ? f * 2 - 1 : t.x, ch === 'tilt-y' ? f * 2 - 1 : t.y);
    },
    // A shake is a flick: a short press at its start, so it reads as a tap rather than a hold.
    level: (p) => (p as Imu).shakeAge() < 150,
    key: (p, _, down) => down && (p as Imu).shake(),
  },
  mic: {
    absolute: (p) => (p as Mic).level(),
    // The keyboard turns the room up or down; a key held for a trigger claps.
    setAbsolute: (p, _, f) => (p as Mic).setRoom(LEVEL_RANGE[0] + f * (LEVEL_RANGE[1] - LEVEL_RANGE[0])),
    setting: (p) => ((p as Mic).roomLevel - LEVEL_RANGE[0]) / (LEVEL_RANGE[1] - LEVEL_RANGE[0]),
    pushable: (p, ch) => (ch === 'clap' ? (p as Mic).keys.get('clap') : undefined),
  },
  ld2410: {
    absolute(p) {
      const r = p as LD2410;
      r.outPin(); // pumps the sensor model
      const rep = r.latest().report;
      return rep.state ? rep.detectionDistance / (MAX_RANGE_M * 100) : null;
    },
    level: (p) => !!(p as LD2410).outPin(),
  },
  tof: {
    // Across a hand's reach; past it reads as the far end, and nothing there holds the dial.
    absolute(p) {
      const mm = (p as Tof).mm();
      return mm === null ? null : Math.min(1, mm / CHANNEL_MM);
    },
    setAbsolute: (p, _, f) => (p as Tof).setTarget(f * CHANNEL_MM),
    setting(p) {
      const mm = (p as Tof).targetMm;
      return mm === null ? null : Math.min(1, mm / CHANNEL_MM);
    },
    level: (p) => (p as Tof).near(),
    key: (p, _, down) => (p as Tof).setTarget(down ? 100 : null), // a hand held over it
  },
  thermal: {
    // Where the warm spot is across the view; with no one in view, the dial holds.
    absolute(p, ch) {
      const h = (p as Thermal).hotspot();
      return h.warm ? (ch === 'hot-x' ? h.x : h.y) / (SIZE - 1) : null;
    },
    setAbsolute(p, ch, f) {
      const t = p as Thermal;
      const now = t.target ?? { x: 0.5, y: 0.5, r: 1.2 };
      t.setFigure({ ...now, [ch === 'hot-x' ? 'x' : 'y']: (0.5 + f * (SIZE - 1)) / SIZE });
    },
    setting(p, ch) {
      const f = (p as Thermal).target;
      return f && ((ch === 'hot-x' ? f.x : f.y) * SIZE - 0.5) / (SIZE - 1);
    },
    level: (p) => (p as Thermal).hotspot().warm,
    key: (p, _, down) => (p as Thermal).setFigure(down ? { x: 0.5, y: 0.5, r: 1.2 } : null), // someone steps in front
  },
  pir: {
    level: (p) => (p as Pir).motion(),
    key: (p, _, down) => (p as Pir).setMoving(down), // wave at the real sensor
  },
  light: {
    absolute: (p) => (p as LightSensor).level,
    setAbsolute: (p, _, f) => (p as LightSensor).set(f),
    level: (p, ch) => ch === 'dark' && (p as LightSensor).level < 0.15,
  },
  climate: {
    absolute(p, ch) {
      const c = p as Climate;
      return ch === 'humidity' ? c.humidity / 100 : (c.temperature - TEMP_RANGE[0]) / (TEMP_RANGE[1] - TEMP_RANGE[0]);
    },
    setAbsolute(p, ch, f) {
      const c = p as Climate;
      if (ch === 'humidity') c.setHumidity(f * 100);
      else c.setTemperature(TEMP_RANGE[0] + f * (TEMP_RANGE[1] - TEMP_RANGE[0]));
    },
  },
  co2: {
    // Nothing yet in its first 5 s: the dial holds.
    absolute(p) {
      const r = (p as Co2).read();
      return r ? (r.co2 - CHANNEL_PPM[0]) / (CHANNEL_PPM[1] - CHANNEL_PPM[0]) : null;
    },
    setAbsolute: (p, _, f) => (p as Co2).setRoom(CHANNEL_PPM[0] + f * (CHANNEL_PPM[1] - CHANNEL_PPM[0])),
    setting: (p) => ((p as Co2).roomPpm - CHANNEL_PPM[0]) / (CHANNEL_PPM[1] - CHANNEL_PPM[0]),
    level: (p) => (p as Co2).stuffy(),
    key: (p, _, down) => down && (p as Co2).breathe(),
  },
  pulse: {
    // No rate until it has a few steady beats: the dial holds.
    absolute(p) {
      const bpm = (p as Pulse).read().bpm;
      return bpm === null ? null : (bpm - BPM_RANGE[0]) / (BPM_RANGE[1] - BPM_RANGE[0]);
    },
    setAbsolute: (p, _, f) => (p as Pulse).setBpm(BPM_RANGE[0] + f * (BPM_RANGE[1] - BPM_RANGE[0])),
    setting: (p) => ((p as Pulse).heartRate - BPM_RANGE[0]) / (BPM_RANGE[1] - BPM_RANGE[0]),
    pushable: (p, ch) => (ch === 'beat' ? (p as Pulse).keys.get('beat') : undefined),
    level: (p, ch) => ch === 'finger' && (p as Pulse).read().finger,
    key: (p, _, down) => (p as Pulse).setFinger(down), // a fingertip on it while the key is down
  },
};

const absolute = (part: SimInput, channel: string): number | null => IO[part.kind]?.absolute?.(part, channel) ?? null;
function setAbsolute(part: SimInput, channel: string, f: number): void {
  IO[part.kind]?.setAbsolute?.(part, channel, Math.min(1, Math.max(0, f)));
}
const pushableOf = (part: SimInput, channel: string): Pushable | undefined => IO[part.kind]?.pushable?.(part, channel);
const levelOn = (part: SimInput, channel: string): boolean => !!IO[part.kind]?.level?.(part, channel);

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
      const io = IO[hw.part.kind];
      const f = io?.setting?.(hw.part, hw.channel.id) ?? absolute(hw.part, hw.channel.id) ?? this.fraction;
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
  /** On a part with several keys (a remote, a keypad, an RFID reader's cards), the one to ask for first. */
  code?: string;
}

/** A momentary action. Same API as a button, so code written for one works with any source. */
export class Trigger extends SimInput {
  readonly kind = 'trigger';
  readonly key?: string;
  private keyDown = false;
  /** Whether this trigger's key is down: a held key repeats its keydown, and only the first presses. */
  private keyHeld = false;
  private prev = false;
  private pressed = false;
  private released = false;
  private since = 0;
  /** What the latest press carried (a remote's key, a card's UID), when its part says. */
  private lastCode: string | null = null;
  /** The connected button's edge counts as far as this trigger has taken them. */
  private seenPresses = 0;
  private seenReleases = 0;
  /** Press and release edges so far: a host can turn them into events without consuming them. */
  presses = 0;
  releases = 0;
  /** The code of each of the last few presses, by press number. */
  private codes = new Map<number, string>();

  constructor(
    opts: TriggerOptions,
    private bench: Bench,
  ) {
    super(opts.label ?? 'Trigger');
    this.key = opts.key;
    const via = TRIGGER_VIA[opts.via ?? 'button'] ?? {};
    const c = bench.suggest('trigger', this, { ...via, ...(opts.code !== undefined ? { channel: opts.code } : {}), builtin: opts.builtin, ...asked(opts.connect) });
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
  /** What the latest press carried: the remote's or keypad's key, an RFID card's UID; null for a plain press. */
  code(): string | null {
    this.poll();
    return this.lastCode;
  }
  /** The code of the n-th press (1 = the first) this trigger saw, while it's among the last few. */
  codeOf(press: number): string | null {
    return this.codes.get(press) ?? null;
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
    if (down === this.keyHeld) return true; // a switch would flip, a CO₂ sensor be breathed on, at each repeat
    this.keyHeld = down;
    const hw = this.bench.resolve(this.connection);
    const p = hw && pushableOf(hw.part, hw.channel.id);
    const work = hw && IO[hw.part.kind]?.key;
    if (p) p.setDown(down); // press the real part, so it animates
    else if (hw && work) work(hw.part, hw.channel.id, down);
    else {
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
          this.edge(true, p.codeOf?.(this.seenPresses) ?? null, p.pressedAt?.(this.seenPresses));
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

  private edge(down: boolean, code: string | null = null, at = this.bench.clock.now()) {
    if (down) {
      this.pressed = true;
      this.presses++;
      this.lastCode = code;
      if (code !== null) this.codes.set(this.presses, code);
      this.codes.delete(this.presses - 32);
      this.since = at;
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
