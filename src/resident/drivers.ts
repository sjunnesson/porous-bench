// Bench's drivers for the sensors on the desk, one per kind of part, each a Lua module named after
// the kind (`light`, `keypad`): what its read() returns, the driver events it raises, and what the mirror sends a real board for the shim's
// stand-in (lua/remote.lua). The host (Bench) and the mirror (a real board) both read parts through
// here, so what an app sees can't differ between the two. The radar and the IMU have drivers of their
// own (host.ts): the radar takes a mode, and the IMU belongs to the board.

import type { PartKind } from '../sim/controls/bench';
import type { Climate } from '../sim/inputs/climate';
import type { Co2 } from '../sim/inputs/co2';
import type { EventLog, SimInput } from '../sim/inputs/input';
import { type IrReceiver, REMOTE_ADDRESS, REMOTE_KEYS } from '../sim/inputs/ir';
import type { Joystick } from '../sim/inputs/joystick';
import type { Keypad } from '../sim/inputs/keypad';
import type { LightSensor } from '../sim/inputs/light';
import { BAND_RANGE, type Mic } from '../sim/inputs/mic';
import type { Pir } from '../sim/inputs/pir';
import type { Pulse } from '../sim/inputs/pulse';
import type { RfidReader } from '../sim/inputs/rfid';
import type { Switch } from '../sim/inputs/switch';
import type { Thermal } from '../sim/inputs/thermal';
import type { Tof } from '../sim/inputs/tof';
import type { Touch } from '../sim/inputs/touch';
import { minifyLua } from './minify';

export interface DriverEvent {
  name: string;
  data: Record<string, unknown>;
}

/** What one app's driver has reported of one part so far (the events' starting point). */
export type Memo = Record<string, unknown>;

export interface PartDriver<P extends SimInput = SimInput> {
  /** What `<module>.read()` returns on Bench. */
  read(part: P): Record<string, unknown>;
  /** The module's other functions, those that take an argument or keep their own place (`pulse.samples()`). */
  calls?: Record<string, (part: P, arg: unknown, memo: Memo) => unknown>;
  /**
   * The driver events since the last call. The first call, when the app first uses the module, sets
   * where they start: what happened before isn't the app's.
   */
  events?(part: P, memo: Memo): DriverEvent[];
  /** What the mirror sends the stand-in: read() unless that's too big for the relay. */
  mirror?(part: P): unknown;
}

/** An event on each change of `now`; the first value is where it starts, not a change. */
export function changes<T>(memo: Memo, now: T, event: (now: T) => DriverEvent): DriverEvent[] {
  if (!('last' in memo)) {
    memo.last = now;
    return [];
  }
  if (memo.last === now) return [];
  memo.last = now;
  return [event(now)];
}

/** The part's logged events since the last call; the first call starts from now. */
export function drain(memo: Memo, log: EventLog): DriverEvent[] {
  if (typeof memo.seq !== 'number') {
    memo.seq = log.seq;
    return [];
  }
  const out = log.since(memo.seq);
  memo.seq = log.seq;
  return out.map(({ name, data }) => ({ name, data }));
}

const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;
/** Only the fields that are set: Lua reads a missing one as nil. */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/** A driver for one kind of part, kept with the others (which take any part). */
const driver = <P extends SimInput>(d: PartDriver<P>) => d as unknown as PartDriver;

const light = driver<LightSensor>({
  read: (p) => ({ level: p.level, lux: p.lux(), raw: p.read() }),
  mirror: (p) => ({ level: round(p.level), lux: Math.round(p.lux()), raw: p.read() }),
});

const pir = driver<Pir>({
  read: (p) => ({ motion: p.motion() }),
  events: (p, memo) => changes(memo, p.motion(), (moving) => ({ name: 'motion', data: { moving } })),
});

const climate = driver<Climate>({
  read: (p) => ({ temperature: p.readTemperature(), humidity: p.readHumidity() }),
});

const touch = driver<Touch>({
  read: (p) => ({ touched: p.isPressed(), raw: p.touchRead() }),
  events: (p, memo) => changes(memo, p.isPressed(), (touched) => ({ name: 'touch', data: { touched } })),
});

const joystick = driver<Joystick>({
  read: (p) => ({ x: p.axis('x'), y: p.axis('y'), pressed: p.isPressed(), raw_x: p.raw('x'), raw_y: p.raw('y') }),
  // A stick pushed past halfway is a direction, as a d-pad's: "stick" { dir } each time it changes.
  events: (p, memo) => changes(memo, p.direction(typeof memo.last === 'string' ? memo.last : 'center'), (dir) => ({ name: 'stick', data: { dir } })),
  mirror: (p) => ({ x: round(p.axis('x'), 2), y: round(p.axis('y'), 2), pressed: p.isPressed(), raw_x: p.raw('x'), raw_y: p.raw('y') }),
});

// `switch` is a word JavaScript keeps for itself, not Lua.
const toggle = driver<Switch>({
  read: (p) => ({ on: p.isOn() }),
  // Each flip, `switch` { on }, even on and off again between two polls.
  events: (p, memo) => drain(memo, p.log),
});

/** The latest block: its level 0..1 and in dB SPL, and each octave band 0..1. */
function micBlock(p: Mic, places: number) {
  const b = p.read();
  const band = (db: number) => round(Math.min(1, Math.max(0, (db - BAND_RANGE[0]) / (BAND_RANGE[1] - BAND_RANGE[0]))), places);
  return { level: round(p.level(), places), db: b.db, bands: b.bands.map(band) };
}
const mic = driver<Mic>({
  read: (p) => micBlock(p, 3),
  // Listening is what finds claps: the driver listens whether or not the app reads.
  events: (p, memo) => (p.read(), drain(memo, p.log)),
  mirror: (p) => micBlock(p, 2),
});

const ir = driver<IrReceiver>({
  // The key held now (nil when none), and the last one decoded with its NEC command.
  read(p) {
    const { key, last } = p.read();
    return defined({ key, last, code: REMOTE_KEYS.find((k) => k.id === last)?.code, address: REMOTE_ADDRESS });
  },
  // Every frame the remote sends: `ir` { key, code, address, held } (held: a repeat code, the key still down).
  events: (p, memo) => (p.read(), drain(memo, p.log)),
});

const keypad = driver<Keypad>({
  read: (p) => defined(p.read()),
  // Each pad touched and let go: `key` { key, pressed }.
  events: (p, memo) => drain(memo, p.log),
});

const rfid = driver<RfidReader>({
  read: (p) => p.read(),
  // A tag arriving and leaving: `tag` { present, uid, type }.
  events: (p, memo) => (p.read(), drain(memo, p.log)),
});

const tof = driver<Tof>({
  read(p) {
    const mm = p.mm();
    return mm === null ? { status: 'out of range' } : { mm, status: 'ok' };
  },
  // Something coming within 30 cm, and going: `near` { near, mm }.
  events: (p, memo) => changes(memo, p.near(), (near) => ({ name: 'near', data: defined({ near, mm: p.mm() }) })),
});

const co2 = driver<Co2>({
  // Nothing in its first 5 s; then the newest measurement.
  read: (p) => ({ ...p.read() }),
  // Each new measurement: `co2` { co2, temperature, humidity }.
  events: (p, memo) => (p.read(), drain(memo, p.log)),
});

const pulse = driver<Pulse>({
  // `bpm` is nil until it has a few steady beats.
  read: (p) => defined(p.read()),
  calls: {
    // The IR samples since this app last asked, as many as the FIFO held (32 at most).
    samples(p, _arg, memo) {
      const { ir, last } = p.samplesSince(typeof memo.sample === 'number' ? memo.sample : -1);
      memo.sample = last;
      return ir;
    },
  },
  // A finger on and off, `finger` { on }, and each beat once it has a rate, `beat` { bpm }.
  events: (p, memo) => (p.read(), drain(memo, p.log)),
  // The FIFO's samples go too, numbered by the last one's index: an update that comes late (the relay
  // can take a while) still has every sample the board hasn't had, as a FIFO read late does. Packed
  // from their lowest, 4 counts a step, or as many as spans them (a finger coming down).
  mirror(p) {
    const r = p.read();
    const { ir, last } = p.samplesSince(-1);
    const base = ir.length ? Math.min(...ir) : 0;
    const step = Math.max(4, Math.ceil((Math.max(base, ...ir) - base) / 4095));
    return defined({ ...r, n: last, b: base, st: step, w: pack(ir, base, step) });
  },
});

/** The frame, and what the driver makes of it: its hottest pixel, and where the warm part is (0..7). */
function thermalFrame(p: Thermal) {
  const h = p.hotspot();
  return { thermistor: p.thermistor(), max: h.max, warm: h.warm, hot_x: h.x, hot_y: h.y };
}
const thermal = driver<Thermal>({
  read: (p) => ({ pixels: p.pixels(), ...thermalFrame(p) }),
  // Someone warm coming into view, and leaving: `warm` { warm, x, y }.
  events: (p, memo) => changes(memo, p.hotspot().warm, (warm) => ({ name: 'warm', data: { warm, x: p.hotspot().x, y: p.hotspot().y } })),
  // The 64 pixels in 128 characters: quarter degrees from -20 °C, as the sensor's own 12 bits.
  mirror: (p) => ({ p: pack(p.pixels(), -20, 0.25), ...thermalFrame(p) }),
});

export const DRIVERS: Partial<Record<PartKind, PartDriver>> = { light, pir, climate, touch, joystick, switch: toggle, mic, ir, keypad, rfid, tof, co2, pulse, thermal };

/** The sensors' modules an app's code names (not in a comment): the ones whose readings it can use. */
export function modulesNamed(app: string): Set<PartKind> {
  const code = minifyLua(app);
  return new Set((Object.keys(DRIVERS) as PartKind[]).filter((k) => new RegExp(`\\b${k}\\b`).test(code)));
}

// ---- packing arrays for the relay -------------------------------------------------------------

/** base64url's alphabet: safe in JSON and Lua strings without escaping. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Numbers as two characters each (12 bits), for readings that are arrays (a thermal camera's 64
 * pixels): `(v - lo) / step`, clamped to 0..4095. The shim's `__unpack(s, lo, step)` turns them back.
 */
export function pack(values: number[], lo: number, step: number): string {
  return values
    .map((v) => {
      const n = Math.min(4095, Math.max(0, Math.round((v - lo) / step)));
      return ALPHABET[n >> 6] + ALPHABET[n & 63];
    })
    .join('');
}

export function unpack(s: string, lo: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(lo + ((ALPHABET.indexOf(s[i]) << 6) | ALPHABET.indexOf(s[i + 1])) * step);
  return out;
}
