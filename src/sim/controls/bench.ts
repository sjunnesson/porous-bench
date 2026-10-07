// The bench: the hardware on the desk. You choose the parts (the Hardware panel); the board's own
// buttons, IMU and buzzer come with the device. An app's controls (dial, trigger) connect to a
// part's channel, like a slide pot's position or an encoder's push. The bench outlives runs, so
// switching apps keeps your parts, where you left them and what they read.

import type { SimClock } from '../clock';
import type { DeviceProfile } from '../devices/types';
import { Button } from '../inputs/button';
import { Buzzer } from '../inputs/buzzer';
import { Climate } from '../inputs/climate';
import { Imu } from '../inputs/imu';
import type { SimInput } from '../inputs/input';
import { Knob } from '../inputs/knob';
import { LD2410 } from '../inputs/ld2410';
import { LightSensor } from '../inputs/light';
import { Pir } from '../inputs/pir';
import { Pot } from '../inputs/pot';
import { Touch } from '../inputs/touch';

export type PartKind = 'button' | 'knob' | 'pot' | 'imu' | 'ld2410' | 'light' | 'pir' | 'climate' | 'touch' | 'buzzer';

/** What you can add, in menu order. */
export const PART_KINDS: { kind: PartKind; label: string }[] = [
  { kind: 'button', label: 'Push button' },
  { kind: 'knob', label: 'Rotary encoder' },
  { kind: 'pot', label: 'Slide pot' },
  { kind: 'touch', label: 'Touch pad' },
  { kind: 'imu', label: 'IMU' },
  { kind: 'ld2410', label: 'LD2410 radar' },
  { kind: 'pir', label: 'PIR motion' },
  { kind: 'light', label: 'Light sensor' },
  { kind: 'climate', label: 'Temp / humidity' },
  { kind: 'buzzer', label: 'Buzzer' },
];
const SHORT: Record<PartKind, string> = {
  button: 'Button', knob: 'Encoder', pot: 'Slide pot', touch: 'Touch pad', imu: 'IMU', ld2410: 'Radar',
  pir: 'PIR', light: 'Light', climate: 'Climate', buzzer: 'Buzzer',
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
  knob: [
    { id: 'rotate', label: 'turn', kind: 'relative' },
    { id: 'push', label: 'push', kind: 'momentary' },
  ],
  pot: [{ id: 'position', label: 'position', kind: 'absolute' }],
  touch: [{ id: 'touch', label: 'touch', kind: 'momentary' }],
  imu: [
    { id: 'tilt-x', label: 'tilt ←→', kind: 'absolute' },
    { id: 'tilt-y', label: 'tilt ↑↓', kind: 'absolute' },
    { id: 'shake', label: 'shake', kind: 'momentary' },
  ],
  ld2410: [
    { id: 'distance', label: 'distance', kind: 'absolute' },
    { id: 'presence', label: 'presence', kind: 'momentary' },
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
  buzzer: [],
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
    case 'knob':
      return new Knob({ label }, clock);
    case 'pot':
      return new Pot({ label, noise: 0 });
    case 'touch':
      return new Touch({ label }, clock);
    case 'imu':
      return new Imu({ label }, clock);
    case 'ld2410':
      return new LD2410({ label, mode: 'wander' }, clock);
    case 'pir':
      return new Pir({ label }, clock);
    case 'light':
      return new LightSensor({ label });
    case 'climate':
      return new Climate({ label });
    case 'buzzer':
      return new Buzzer({ label }, clock);
  }
}

/** A bench for a board: its built-in buttons, IMU and buzzer, then the parts you saved. */
export function boardBench(device: DeviceProfile, clock: SimClock, saved: PartSpec[]): Bench {
  const b = new Bench(clock);
  for (const p of device.enclosure?.parts ?? []) {
    if (p.kind !== 'button' || p.input === undefined) continue;
    const name = p.label ?? `Button ${'AB'[p.input] ?? p.input}`;
    b.addBuiltin(`builtin-button-${p.input}`, new Button({ label: name.replace(/\s*\(.*\)$/, '') }, clock), p.input);
  }
  for (const k of device.builtins ?? []) b.addBuiltin(`builtin-${k}`, createPart(k, k === 'imu' ? 'IMU' : 'Buzzer', clock));
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
  /** Put there by a sketch for its own use (concrete hardware), not saved with the bench. */
  declared?: boolean;
}

/** What a control would like to connect to first. */
export interface Preference {
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
  private listeners = new Set<() => void>();
  private version = 0;
  /** Called when you add or remove parts, with what to save. */
  onEdit?: (parts: PartSpec[]) => void;

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
      if (this.list.some((e) => e.id === s.id) || !CHANNELS[s.kind]) continue;
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
    const count = this.list.filter((e) => e.part.kind === kind && !e.builtin).length + 1;
    const id = `${kind}-${n}`;
    const part = createPart(kind, `${SHORT[kind]} ${count}`, this.clock);
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
    this.edited();
  }

  /** A part a sketch declared for its own use (old-style concrete hardware). */
  addDeclared(part: SimInput): void {
    let id = part.name || part.kind;
    while (this.list.some((e) => e.id === id)) id += '+';
    part.name = id;
    this.list.push({ id, part, declared: true });
    this.changed();
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
  /** What to save: the parts you added. */
  specs(): PartSpec[] {
    return this.list.filter((e) => !e.builtin && !e.declared).map((e) => ({ id: e.id, kind: e.part.kind as PartKind, label: e.part.label }));
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
    const inUse = (c: Connection) => [...this.links].some(([o, l]) => o !== owner && l?.part === c.part && l.channel === c.channel);
    const builtinIndex = (id: string) => this.list.find((e) => e.id === id)?.builtin?.index;
    const score = (o: (typeof opts)[number]) => {
      let s = 0;
      if (prefer.builtin !== undefined) s += builtinIndex(o.connection.part) === prefer.builtin ? 100 : 0;
      if (prefer.kind && o.part.kind === prefer.kind) s += 20;
      if (prefer.channel && o.channel.id === prefer.channel) s += 10;
      if (prefer.external && o.builtin) s -= 50;
      // A free part beats a busy one of the kind asked for: two "next" buttons shouldn't share one.
      if (inUse(o.connection)) s -= 30;
      // Without a preference, controls take the plain controls first: buttons, encoders, pots.
      if (!prefer.kind && ['button', 'knob', 'pot', 'touch'].includes(o.part.kind)) s += 2;
      return s;
    };
    let best: (typeof opts)[number] | null = null;
    for (const o of opts) if (!best || score(o) > score(best)) best = o;
    // A preference for a kind that isn't on the bench doesn't grab something unrelated that's busy.
    if (best && prefer.builtin === undefined && inUse(best.connection)) return null;
    return best?.connection ?? null;
  }

  link(owner: object, c: Connection | null): void {
    this.links.set(owner, c);
    this.changed();
  }
  linkOf(owner: object): Connection | null {
    return this.links.get(owner) ?? null;
  }
  unlink(owner: object): void {
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
