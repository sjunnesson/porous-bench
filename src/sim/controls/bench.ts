// The bench: the hardware on the desk. You choose the parts (the Hardware panel); the board's own
// buttons, IMU and buzzer come with the device. An app's controls (dial, trigger) connect to a
// part's channel, like a slide pot's position or an encoder's push. The bench outlives runs, so
// switching apps keeps your parts, where you left them and what they read.

import type { SimClock } from '../clock';
import type { DeviceProfile } from '../devices/types';
import { Button } from '../inputs/button';
import { Buzzer } from '../inputs/buzzer';
import { Climate } from '../inputs/climate';
import { Co2 } from '../inputs/co2';
import { Haptic } from '../inputs/haptic';
import { Imu } from '../inputs/imu';
import type { SimInput } from '../inputs/input';
import { IrReceiver, REMOTE_KEYS } from '../inputs/ir';
import { Joystick } from '../inputs/joystick';
import { Keypad, KEYPAD_KEYS } from '../inputs/keypad';
import { Knob } from '../inputs/knob';
import { LD2410 } from '../inputs/ld2410';
import { LedRing } from '../inputs/ledring';
import { LightSensor } from '../inputs/light';
import { Mic } from '../inputs/mic';
import { Pir } from '../inputs/pir';
import { Pot } from '../inputs/pot';
import { Pulse } from '../inputs/pulse';
import { RfidReader, TAGS } from '../inputs/rfid';
import { Switch } from '../inputs/switch';
import { Thermal } from '../inputs/thermal';
import { Tof } from '../inputs/tof';
import { Touch } from '../inputs/touch';
import { PINOUTS } from '../wiring';

export type PartKind = 'button' | 'switch' | 'knob' | 'pot' | 'joystick' | 'keypad' | 'ir' | 'rfid' | 'imu' | 'mic' | 'ld2410' | 'tof' | 'thermal' | 'light' | 'pir' | 'climate' | 'co2' | 'pulse' | 'touch' | 'buzzer' | 'haptic' | 'leds';
/** Parts only a board has built in (the SmartKnob's motor knob, LEDs beside a display): never added, saved or wired. */
export const BUILT_IN_ONLY: ReadonlySet<PartKind> = new Set(['haptic', 'leds']);

/** What you can add, in menu order. */
export const PART_KINDS: { kind: PartKind; label: string }[] = [
  { kind: 'button', label: 'Push button' },
  { kind: 'switch', label: 'Switch (toggle / reed)' },
  { kind: 'knob', label: 'Rotary encoder' },
  { kind: 'pot', label: 'Slide pot' },
  { kind: 'joystick', label: 'Joystick' },
  { kind: 'touch', label: 'Touch pad' },
  { kind: 'keypad', label: 'Keypad (12 keys)' },
  { kind: 'ir', label: 'IR receiver + remote' },
  { kind: 'rfid', label: 'RFID / NFC reader' },
  { kind: 'imu', label: 'IMU' },
  { kind: 'mic', label: 'Microphone' },
  { kind: 'ld2410', label: 'LD2410 radar' },
  { kind: 'tof', label: 'Distance (time of flight)' },
  { kind: 'thermal', label: 'Thermal camera (8×8)' },
  { kind: 'pir', label: 'PIR motion' },
  { kind: 'light', label: 'Light sensor' },
  { kind: 'climate', label: 'Temp / humidity' },
  { kind: 'co2', label: 'CO₂ (SCD41)' },
  { kind: 'pulse', label: 'Pulse (MAX30102)' },
  { kind: 'buzzer', label: 'Buzzer' },
];
const SHORT: Record<PartKind, string> = {
  button: 'Button', switch: 'Switch', knob: 'Encoder', pot: 'Slide pot', joystick: 'Joystick', touch: 'Touch pad', keypad: 'Keypad', ir: 'IR', rfid: 'RFID', imu: 'IMU', mic: 'Mic', ld2410: 'Radar', tof: 'Distance', thermal: 'Thermal',
  pir: 'PIR', light: 'Light', climate: 'Climate', co2: 'CO₂', pulse: 'Pulse', buzzer: 'Buzzer', haptic: 'Knob', leds: 'LED ring',
};

/**
 * What a control can read from a part. Relative and absolute channels drive a dial (an encoder
 * steps it; a pot or a sensor sets it across its range); momentary ones fire a trigger.
 */
export type ChannelKind = 'relative' | 'absolute' | 'momentary';
export interface Channel {
  id: string;
  label: string;
  kind: ChannelKind;
}
export const CHANNELS: Record<PartKind, Channel[]> = {
  button: [{ id: 'press', label: 'press', kind: 'momentary' }],
  switch: [{ id: 'on', label: 'on', kind: 'momentary' }],
  knob: [
    { id: 'rotate', label: 'turn', kind: 'relative' },
    { id: 'push', label: 'push', kind: 'momentary' },
  ],
  pot: [{ id: 'position', label: 'position', kind: 'absolute' }],
  joystick: [
    { id: 'x', label: 'stick ←→', kind: 'absolute' },
    { id: 'y', label: 'stick ↓↑', kind: 'absolute' },
    { id: 'press', label: 'press', kind: 'momentary' },
  ],
  touch: [{ id: 'touch', label: 'touch', kind: 'momentary' }],
  // Any key, then each key; a trigger's `code` picks one ("5", or the remote's "ok").
  keypad: [{ id: 'any', label: 'any key', kind: 'momentary' }, ...KEYPAD_KEYS.map((k): Channel => ({ id: k.id, label: `key ${k.label}`, kind: 'momentary' }))],
  ir: [{ id: 'any', label: 'any key', kind: 'momentary' }, ...REMOTE_KEYS.map((k): Channel => ({ id: k.id, label: `key ${k.label}`, kind: 'momentary' }))],
  // Any tag, then each one, held while it lies on the reader.
  rfid: [{ id: 'tag', label: 'any tag', kind: 'momentary' }, ...TAGS.map((t): Channel => ({ id: t.id, label: t.label, kind: 'momentary' }))],
  imu: [
    { id: 'tilt-x', label: 'tilt ←→', kind: 'absolute' },
    { id: 'tilt-y', label: 'tilt ↑↓', kind: 'absolute' },
    { id: 'shake', label: 'shake', kind: 'momentary' },
  ],
  mic: [
    { id: 'level', label: 'sound level', kind: 'absolute' },
    { id: 'clap', label: 'clap', kind: 'momentary' },
  ],
  ld2410: [
    { id: 'distance', label: 'distance', kind: 'absolute' },
    { id: 'presence', label: 'presence', kind: 'momentary' },
  ],
  tof: [
    { id: 'distance', label: 'distance', kind: 'absolute' },
    { id: 'near', label: 'something near', kind: 'momentary' },
  ],
  thermal: [
    { id: 'hot-x', label: 'warm spot ←→', kind: 'absolute' },
    { id: 'hot-y', label: 'warm spot ↑↓', kind: 'absolute' },
    { id: 'warm', label: 'someone warm in view', kind: 'momentary' },
  ],
  pir: [{ id: 'motion', label: 'motion', kind: 'momentary' }],
  light: [
    { id: 'level', label: 'light level', kind: 'absolute' },
    { id: 'dark', label: 'goes dark', kind: 'momentary' },
  ],
  climate: [
    { id: 'temperature', label: 'temperature', kind: 'absolute' },
    { id: 'humidity', label: 'humidity', kind: 'absolute' },
  ],
  co2: [
    { id: 'co2', label: 'CO₂', kind: 'absolute' },
    { id: 'stuffy', label: 'stuffy (1000 ppm)', kind: 'momentary' },
  ],
  pulse: [
    { id: 'bpm', label: 'heart rate', kind: 'absolute' },
    { id: 'beat', label: 'heartbeat', kind: 'momentary' },
    { id: 'finger', label: 'finger on it', kind: 'momentary' },
  ],
  buzzer: [],
  // The SmartKnob's knob: positions turned as an encoder's clicks, and a press on it.
  haptic: [
    { id: 'rotate', label: 'turn', kind: 'relative' },
    { id: 'push', label: 'press', kind: 'momentary' },
  ],
  leds: [],
};

export interface Connection {
  part: string;
  channel: string;
}
export const connectionId = (c: Connection | null) => (c ? `${c.part}:${c.channel}` : 'none');
export function parseConnection(id: string): Connection | null {
  const i = id.lastIndexOf(':');
  return i > 0 ? { part: id.slice(0, i), channel: id.slice(i + 1) } : null;
}

/** A part as saved: what it is and what it's called. */
export interface PartSpec {
  id: string;
  kind: PartKind;
  label: string;
}

export function createPart(kind: PartKind, label: string, clock: SimClock): SimInput {
  switch (kind) {
    case 'button':
      return new Button({ label }, clock);
    case 'switch':
      return new Switch({ label }, clock);
    case 'knob':
      return new Knob({ label }, clock);
    case 'pot':
      return new Pot({ label, noise: 0 });
    case 'joystick':
      return new Joystick({ label }, clock);
    case 'touch':
      return new Touch({ label }, clock);
    case 'keypad':
      return new Keypad({ label }, clock);
    case 'ir':
      return new IrReceiver({ label }, clock);
    case 'rfid':
      return new RfidReader({ label }, clock);
    case 'imu':
      return new Imu({ label }, clock);
    case 'mic':
      return new Mic({ label }, clock);
    case 'ld2410':
      return new LD2410({ label, mode: 'wander' }, clock);
    case 'tof':
      return new Tof({ label }, clock);
    case 'thermal':
      return new Thermal({ label }, clock);
    case 'pir':
      return new Pir({ label }, clock);
    case 'light':
      return new LightSensor({ label });
    case 'climate':
      return new Climate({ label });
    case 'co2':
      return new Co2({ label }, clock);
    case 'pulse':
      return new Pulse({ label }, clock);
    case 'buzzer':
      return new Buzzer({ label }, clock);
    case 'haptic':
      return new Haptic({ label }, clock);
    case 'leds':
      return new LedRing(8, { label });
  }
}

/**
 * A bench for a board: its built-in buttons (the output's own, or keys on the board driving it that
 * Bench's firmware reads, like the e-paper driver board's IO12), IMU and buzzer, then the parts you saved.
 */
export function boardBench(device: DeviceProfile, clock: SimClock, saved: PartSpec[], board?: string): Bench {
  const b = new Bench(clock);
  for (const p of device.enclosure?.parts ?? []) {
    if (p.kind !== 'button' || p.input === undefined) continue;
    const name = p.label ?? `Button ${'AB'[p.input] ?? p.input}`;
    b.addBuiltin(`builtin-button-${p.input}`, new Button({ label: name.replace(/\s*\(.*\)$/, '') }, clock), p.input);
  }
  (PINOUTS[board ?? '']?.keys ?? []).forEach((k, i) => {
    if (!k.onBoard || (k.output && k.output !== device.id) || b.builtinButton(i)) return;
    b.addBuiltin(`builtin-button-${i}`, new Button({ label: `Button ${'AB'[i] ?? i}` }, clock), i);
  });
  for (const k of device.builtins ?? []) {
    // A knob that's the board's only control (the SmartKnob's): pressing it is button A.
    if (k === 'haptic') b.addBuiltin('builtin-haptic', new Haptic({ label: 'Knob' }, clock), b.builtinButton(0) ? undefined : 0);
    else b.addBuiltin(`builtin-${k}`, createPart(k, { imu: 'IMU', buzzer: 'Buzzer', mic: 'Microphone' }[k], clock));
  }
  if (device.ring) b.addBuiltin('builtin-leds', new LedRing(device.ring.count));
  b.load(saved);
  return b;
}

/** A starting bench for someone new: something to turn, something to slide, something to press. */
export const DEFAULT_PARTS: PartSpec[] = [
  { id: 'knob-1', kind: 'knob', label: 'Encoder 1' },
  { id: 'pot-1', kind: 'pot', label: 'Slide pot 1' },
  { id: 'button-1', kind: 'button', label: 'Button 1' },
];

interface Entry {
  id: string;
  part: SimInput;
  /** Built into the board: its n-th button (`button`), or its IMU / buzzer. Not removable. */
  builtin?: { index?: number };
}

/** What a control would like to connect to first. */
export interface Preference {
  /** A specific part on the bench (`connect = "knob-2:rotate"`), with `channel`. */
  part?: string;
  kind?: PartKind;
  channel?: string;
  /** The board's n-th button. */
  builtin?: number;
  /** Not a built-in part. */
  external?: boolean;
}

export class Bench {
  private list: Entry[] = [];
  private links = new Map<object, Connection | null>();
  private auto = new Set<object>();
  private listeners = new Set<() => void>();
  private version = 0;
  /** Called when you add or remove parts, with what to save. */
  onEdit?: (parts: PartSpec[]) => void;
  /** A part was taken off: whatever was saved for it (its connections, its place on the desk) goes too,
   *  or the next part given its id would inherit them. */
  onRemove?: (id: string) => void;

  constructor(readonly clock: SimClock) {}

  // ---- parts ---------------------------------------------------------------------------------

  /** The board's own hardware. */
  addBuiltin(id: string, part: SimInput, index?: number): void {
    part.name = id;
    this.list.push({ id, part, builtin: { index } });
    this.changed();
  }

  /** Restore saved parts (ids and labels kept). */
  load(specs: PartSpec[]): void {
    for (const s of specs) {
      if (this.list.some((e) => e.id === s.id) || !CHANNELS[s.kind] || BUILT_IN_ONLY.has(s.kind)) continue;
      const part = createPart(s.kind, s.label, this.clock);
      part.name = s.id;
      this.list.push({ id: s.id, part });
    }
    this.changed();
  }

  /** Add a part of `kind`, numbered after its siblings. */
  add(kind: PartKind): SimInput {
    let n = 1;
    while (this.list.some((e) => e.id === `${kind}-${n}`)) n++;
    const id = `${kind}-${n}`;
    // Numbered as its id is: a part added after one was taken off takes its number, not a sibling's.
    const part = createPart(kind, `${SHORT[kind]} ${n}`, this.clock);
    part.name = id;
    this.list.push({ id, part });
    this.edited();
    return part;
  }

  /** Take a part off the desk; controls connected to it fall back to the keyboard. */
  remove(id: string): void {
    const e = this.list.find((x) => x.id === id);
    if (!e || e.builtin) return;
    this.list = this.list.filter((x) => x !== e);
    for (const [owner, c] of this.links) if (c?.part === id) this.links.set(owner, null);
    this.onRemove?.(id);
    this.edited();
  }

  parts(): SimInput[] {
    return this.list.map((e) => e.part);
  }
  part(id: string): SimInput | undefined {
    return this.list.find((e) => e.id === id)?.part;
  }
  idOf(part: SimInput): string | undefined {
    return this.list.find((e) => e.part === part)?.id;
  }
  isBuiltin(part: SimInput): boolean {
    return !!this.list.find((e) => e.part === part)?.builtin;
  }
  /** The board's n-th physical button. */
  builtinButton(index: number): Button | undefined {
    return this.list.find((e) => e.builtin?.index === index && e.part.kind === 'button')?.part as Button | undefined;
  }
  /** The first part of a kind (a sensor module's default). */
  first<T extends SimInput>(kind: PartKind): T | undefined {
    return this.list.find((e) => e.part.kind === kind)?.part as T | undefined;
  }
  /** The part of `kind` on the bench, adding one if there isn't (an app asked for that sensor). */
  ensure<T extends SimInput>(kind: PartKind): { part: T; added: boolean } {
    const found = this.first<T>(kind);
    if (found) return { part: found, added: false };
    return { part: this.add(kind) as T, added: true };
  }
  /** Everything on the bench: the board's own hardware, then yours. */
  hardware(): (PartSpec & { builtin: boolean })[] {
    return this.list.map((e) => ({ id: e.id, kind: e.part.kind as PartKind, label: e.part.label, builtin: !!e.builtin }));
  }
  /** What to save: the parts you added. */
  specs(): PartSpec[] {
    return this.list.filter((e) => !e.builtin).map((e) => ({ id: e.id, kind: e.part.kind as PartKind, label: e.part.label }));
  }

  // ---- connections ---------------------------------------------------------------------------

  /** Every channel on the bench a control of this kind could read. */
  options(control: 'dial' | 'trigger'): { connection: Connection; part: SimInput; channel: Channel; builtin: boolean }[] {
    const fits = (c: Channel) => (control === 'trigger' ? c.kind === 'momentary' : c.kind !== 'momentary');
    return this.list.flatMap((e) =>
      (CHANNELS[e.part.kind as PartKind] ?? []).filter(fits).map((channel) => ({ connection: { part: e.id, channel: channel.id }, part: e.part, channel, builtin: !!e.builtin })),
    );
  }

  /** The best connection for a new control: what it prefers, unused parts first. */
  suggest(control: 'dial' | 'trigger', owner: object, prefer: Preference = {}): Connection | null {
    const opts = this.options(control);
    // A part asked for by id is free if the bench only picked it for another control.
    const inUse = (c: Connection) =>
      [...this.links].some(([o, l]) => o !== owner && l?.part === c.part && l.channel === c.channel && !(c.part === prefer.part && this.auto.has(o)));
    const builtinIndex = (id: string) => this.list.find((e) => e.id === id)?.builtin?.index;
    const score = (o: (typeof opts)[number]) => {
      let s = 0;
      if (prefer.part && o.connection.part === prefer.part) s += 200;
      if (prefer.builtin !== undefined) s += builtinIndex(o.connection.part) === prefer.builtin ? 100 : 0;
      if (prefer.kind && o.part.kind === prefer.kind) s += 20;
      // A knob with a motor in it is an encoder too, and the board's own before one on the desk: it's the knob in your hand.
      if (prefer.kind === 'knob' && o.part.kind === 'haptic') s += 22;
      if (prefer.channel && o.channel.id === prefer.channel) s += 10;
      if (prefer.external && o.builtin) s -= 50;
      // A free part beats a busy one of the kind asked for: two "next" buttons shouldn't share one.
      if (inUse(o.connection)) s -= 30;
      // Short of the kind asked for, controls take the plain controls first: buttons, encoders, pots;
      // and your own parts before the board's (its IMU or mic isn't a second dial).
      if (o.part.kind !== prefer.kind && ['button', 'knob', 'haptic', 'pot', 'touch'].includes(o.part.kind)) s += 2;
      if (o.builtin && prefer.builtin === undefined) s -= 1;
      return s;
    };
    let best: (typeof opts)[number] | null = null;
    for (const o of opts) if (!best || score(o) > score(best)) best = o;
    // A preference for a kind that isn't on the bench doesn't grab something unrelated that's busy.
    if (best && prefer.builtin === undefined && inUse(best.connection)) return null;
    return best?.connection ?? null;
  }

  /**
   * Connect a control. `auto`: the bench picked it, not the app or you, so it gives way: a control
   * that asks for that part and channel (or you, in Connections) takes it over.
   */
  link(owner: object, c: Connection | null, auto = false): void {
    this.links.set(owner, c);
    if (auto) this.auto.add(owner);
    else {
      this.auto.delete(owner);
      if (c) for (const [o, l] of this.links) if (o !== owner && this.auto.has(o) && l?.part === c.part && l.channel === c.channel) this.links.set(o, null);
    }
    this.changed();
  }
  linkOf(owner: object): Connection | null {
    return this.links.get(owner) ?? null;
  }
  unlink(owner: object): void {
    this.auto.delete(owner);
    if (this.links.delete(owner)) this.changed();
  }
  /** The part and channel a connection points at, if both still exist. */
  resolve(c: Connection | null): { part: SimInput; channel: Channel } | null {
    if (!c) return null;
    const part = this.part(c.part);
    const channel = part && CHANNELS[part.kind as PartKind]?.find((ch) => ch.id === c.channel);
    return part && channel ? { part, channel } : null;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  private edited() {
    this.onEdit?.(this.specs());
    this.changed();
  }
  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
