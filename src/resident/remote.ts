// Mirror an app onto a real Resident device: Bench pushes the app (wrapped in a small shim that
// stands in for Bench's drivers) and then streams the state of its virtual inputs to it as "bench"
// events, so the real display is driven by the virtual sensors. Everything goes through the relay,
// via Bench's own /relay path (a same-origin proxy: the relay itself doesn't allow browser calls).

import { track } from '../analytics';
import type { Bench, PartKind } from '../sim/controls/bench';
import type { Control, Dial, Trigger } from '../sim/controls/controls';
import type { Imu } from '../sim/inputs/imu';
import type { LD2410 } from '../sim/inputs/ld2410';
import { DRIVERS, modulesNamed } from './drivers';
import { minifyLua } from './minify';
import remoteSrc from './lua/remote.lua?raw';

/**
 * The shim with only the stand-ins `code` names: an app that never mentions `pir` doesn't pay for it,
 * and a word in a comment doesn't count. A section for several (`-- @@part thermal pulse`) goes to an
 * app that names any of them.
 */
function shimFor(app: string): string {
  const code = minifyLua(app);
  const names = (name: string) => new RegExp(`\\b${name}\\b`).test(code);
  return remoteSrc.replace(/^-- @@part ([\w ]+)\n([\s\S]*?)^-- @@end\n/gm, (_, list: string, body: string) => (list.split(' ').some(names) ? body : ''));
}

/**
 * The app as the real device runs it: Bench's driver shim around it, trimmed to the stand-ins the app
 * uses and minified. A board without PSRAM has only ~50-85 KB to receive and compile it in. `spaced`:
 * with a space kept between tokens (see `minifyLua`).
 */
export function remoteApp(code: string, spaced = false): string {
  const [head, foot] = shimFor(code).split('-- @@APP@@');
  return minifyLua(`${head}\n${code}\n${foot}`, spaced);
}

export interface Snapshot {
  /** Dials: [value, fraction, steps so far]. */
  d: Record<string, [number, number, number]>;
  /** The app's triggers: [presses, releases, down], then what each press the board hasn't had carried
   *  (a key, a card's UID; "" for nothing), the last for the newest press: at least that one. */
  t: Record<string, [number, number, 0 | 1, ...string[]]>;
  /** Bench's buttons A and B: [taps, holds started, holds ended] as Bench itself recognised them, so
   *  the device replays the same gestures rather than judging press lengths again. */
  g?: [number, number, number][];
  /** The newest touch-panel events Bench raised, numbered: [seq, "d" | "m" | "u" | "t", x, y]. The
   *  device replays the ones it hasn't seen, in order, with their points. */
  te?: [number, string, number, number][];
  /** The newest sensor driver events Bench raised (a key pressed, a card arriving), numbered:
   *  [seq, name, data]. The device delivers the ones it hasn't seen, in order. */
  ev?: [number, string, Record<string, unknown>][];
  /** Sensor readings, as their Lua modules return them (or packed smaller: drivers.ts). */
  s: Record<string, unknown>;
}

const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/** Reads the app's controls and the bench's sensors into an update, counting dial steps as it goes. */
export class SnapshotReader {
  private steps = new Map<Dial, { last: number; total: number }>();
  /** Per trigger, the presses the board has had (from updates it got), and as far as the last read went. */
  private had = new Map<Trigger, number>();
  private reading = new Map<Trigger, number>();

  /** `modules`: the sensor modules the app names (unset: every sensor on the bench is sent). */
  constructor(private modules?: Set<PartKind>) {}

  read(
    controls: Control[],
    bench: Bench,
    buttons: { a?: unknown; b?: unknown },
    gestures?: [number, number, number][],
    touches?: [number, string, number, number][],
    events?: [number, string, Record<string, unknown>][],
  ): Snapshot {
    const snap: Snapshot = { d: {}, t: {}, s: {} };
    if (gestures) snap.g = gestures;
    if (touches?.length) snap.te = touches;
    if (events?.length) snap.ev = events;
    for (const c of controls) {
      if (c.kind === 'dial') {
        const d = c as Dial;
        const v = d.value;
        let s = this.steps.get(d);
        if (!s) this.steps.set(d, (s = { last: v, total: 0 }));
        let diff = (v - s.last) / (d.step || 1);
        // A wrapping dial that went round: the short way is the real one.
        const span = (d.max - d.min) / (d.step || 1) + 1;
        if (d.wrap && Number.isFinite(span) && Math.abs(diff) > span / 2) diff -= Math.sign(diff) * span;
        s.total += Math.round(diff);
        s.last = v;
        snap.d[c.name] = [round(v), round(d.fraction), s.total];
      } else {
        if (c === buttons.a || c === buttons.b) continue; // A and B travel as gestures (g)
        const t = c as Trigger;
        const down = t.isPressed() ? 1 : 0; // also brings the edge counts up to date
        // Each new press's own code (two keys between updates are two keys), the newest 4 at most.
        const from = Math.max(Math.min((this.had.get(t) ?? 0) + 1, t.presses), t.presses - 3, 1);
        const codes: string[] = [];
        for (let n = from; n <= t.presses; n++) codes.push(t.codeOf(n) ?? '');
        this.reading.set(t, t.presses);
        snap.t[c.name] = codes.some((x) => x) ? [t.presses, t.releases, down, ...codes] : [t.presses, t.releases, down];
      }
    }
    // The sensors the app can read, as their drivers send them to a real board.
    for (const kind of Object.keys(DRIVERS) as PartKind[]) {
      if (this.modules && !this.modules.has(kind)) continue;
      const part = bench.first(kind);
      const driver = DRIVERS[kind]!;
      if (part) snap.s[kind] = driver.mirror ? driver.mirror(part) : driver.read(part);
    }
    // The IMU and radar too, only for an app that names them: the IMU's noise would make every update new.
    const named = (kind: PartKind) => !this.modules || this.modules.has(kind);
    const imu = named('imu') ? bench.first<Imu>('imu') : undefined;
    // Acceleration in g, then the rotation rate in °/s.
    if (imu) snap.s.imu = [...imu.accel().map((x) => round(x)), ...imu.gyro().map((x) => round(x, 1))];
    const radar = named('ld2410') ? bench.first<LD2410>('ld2410') : undefined;
    if (radar) {
      radar.read();
      snap.s.radar = {
        connected: radar.isConnected(),
        moving: radar.movingTargetDetected(),
        still: radar.stationaryTargetDetected(),
        distance_cm: radar.detectionDistance(),
        moving_cm: radar.movingTargetDistance(),
        moving_energy: radar.movingTargetEnergy(),
        still_cm: radar.stationaryTargetDistance(),
        still_energy: radar.stationaryTargetEnergy(),
        out: radar.outPin(),
      };
    }
    return snap;
  }

  /** The board got the last update read: its presses' codes needn't go again. */
  confirm(): void {
    for (const [t, n] of this.reading) this.had.set(t, n);
  }
}

/**
 * An update as JSON, under the 1 KB the device takes. Too big and the device drops the whole update,
 * so shed what matters least first: older touches (the newest 4 stay; the board has had most), then
 * sensor readings one by one (the device keeps the last reading it had of each), the biggest first
 * but those left out of the last update (`waiting`) last, so none is left out for good; then older
 * sensor events, and at the last every touch and event. Dials, triggers and A/B gestures always go.
 */
export function shed(snap: Snapshot, waiting: ReadonlySet<string> = new Set()): string {
  let json = JSON.stringify(snap);
  const size = (k: string) => bytes(JSON.stringify(snap.s[k]));
  const readings = Object.keys(snap.s).sort((a, b) => Number(waiting.has(a)) - Number(waiting.has(b)) || size(b) - size(a));
  const steps = [
    () => snap.te && (snap.te = snap.te.slice(-4)),
    ...readings.map((k) => () => delete snap.s[k]),
    () => snap.ev && (snap.ev = snap.ev.slice(-4)),
    () => delete snap.te,
    () => delete snap.ev,
  ];
  for (const step of steps) {
    if (bytes(json) <= MAX_BYTES) break;
    step();
    json = JSON.stringify(snap);
  }
  return json;
}

/** What a mirror reads on every update. */
export interface MirrorSource {
  controls: Control[];
  bench: Bench;
  buttons: { a?: unknown; b?: unknown };
  /** Bench's own taps and holds on A and B, from the app's host. */
  gestures?: [number, number, number][];
  /** The touch-panel events the app's host raised. */
  touches?: [number, string, number, number][];
  /** The sensor driver events the app's host raised. */
  events?: [number, string, Record<string, unknown>][];
}

export type RemoteStatus = 'off' | 'pushing' | 'live' | 'offline' | 'error';

const KEY = 'bench:remote-device';
const SAVED_KEY = 'bench:remote-devices';
const PERIOD_MS = 100; // up to 10 updates a second, and only when something changed
const HEARTBEAT_MS = 2000; // …or this often anyway, so a device that just connected catches up
const MAX_BYTES = 1000; // Resident drops events over 1024 bytes
const SEND_TIMEOUT_MS = 10_000; // a request the relay never answers would hold every update after it
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Sends to a real device through the relay, from this page's origin. */
async function send(deviceId: string, body: unknown): Promise<number> {
  const res = await fetch(`/relay/devices/${encodeURIComponent(deviceId)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  return res.status;
}

/** A board this browser has mirrored to: its device ID and the display it was last mirrored from. */
export interface SavedDevice {
  id: string;
  /** The display profile Bench showed then, and its name. Unset for an ID remembered before the list. */
  display?: string;
  displayName?: string;
}

function readSaved(): SavedDevice[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && d.id) : [];
  } catch {
    return [];
  }
}

export class RemoteMirror {
  deviceId: string;
  /** The boards this browser has reached, most recently mirrored first. */
  saved: SavedDevice[];
  status: RemoteStatus = 'off';
  message = '';
  sent = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Mirroring was asked for and not stopped: from the first push on, even before it lands or after it fails. */
  private wanted = false;
  /** After a failed update, the next waits this long (doubling up to the heartbeat), not 100 ms. */
  private backoff = 0;
  private retryAt = 0;
  private source: (() => MirrorSource) | null = null;
  private reader = new SnapshotReader();
  private last = '';
  private lastAt = 0;
  /** The newest sensor event the device has had: later updates carry only the ones after it. */
  private eventsSent = 0;
  /** The readings the last update left out, to go first in the next. */
  private waiting = new Set<string>();
  private inFlight = false;
  /** Bumped by start and stop: an await that comes back to an older run leaves the status alone. */
  private run = 0;
  /** The display Bench showed when mirroring began, as analytics names it. */
  private shown = 'unknown';
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    let id = '';
    try {
      id = localStorage.getItem(KEY) ?? '';
    } catch {
      /* not remembered */
    }
    this.deviceId = id;
    this.saved = readSaved();
    // The one ID Bench remembered before it kept a list.
    if (!this.saved.length && id) this.saved = [{ id }];
  }

  /** Keep a board the relay reached at the top of the list, with the display it was mirrored from. */
  private remember(display?: { id: string; name: string }): void {
    const old = this.saved.find((d) => d.id === this.deviceId);
    const entry: SavedDevice = display ? { id: this.deviceId, display: display.id, displayName: display.name } : (old ?? { id: this.deviceId });
    this.saved = [entry, ...this.saved.filter((d) => d.id !== this.deviceId)];
    this.store();
  }

  /** Take a board off the list (the device ID field keeps it until changed). */
  forget(id: string): void {
    this.saved = this.saved.filter((d) => d.id !== id);
    this.store();
    this.notify();
  }

  private store(): void {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(this.saved));
    } catch {
      /* not remembered */
    }
  }

  setDeviceId(id: string): void {
    this.deviceId = id.trim();
    try {
      localStorage.setItem(KEY, this.deviceId);
    } catch {
      /* not remembered */
    }
    this.notify();
  }

  /**
   * Push the app to the device, then keep its inputs in step with Bench's. Once the relay delivers
   * it, the board joins the saved list, labelled with `display` (the one Bench shows).
   *
   * `tz`, the zone Bench's apps run in, goes first, so the app's local time matches Bench's from its
   * `init`. It travels on Bench's own channel, which Bench's firmware listens to, and not as a
   * Resident `hello`: a hello also makes the board drop un-channelled messages until it reboots, and
   * /resident:push-app still sends those. Other firmware drops it and stays on UTC.
   */
  async start(app: { name: string; code: string }, source: NonNullable<RemoteMirror['source']>, opts: { display?: { id: string; name: string }; tz?: string } = {}): Promise<void> {
    if (!this.deviceId) return;
    const run = ++this.run;
    this.wanted = true;
    this.source = source;
    this.reader = new SnapshotReader(modulesNamed(app.code));
    this.last = '';
    this.eventsSent = 0;
    this.waiting = new Set();
    this.backoff = this.retryAt = 0;
    this.shown = opts.display?.id ?? 'unknown';
    this.set('pushing', `Sending ${app.name}…`);
    try {
      if (opts.tz) await send(this.deviceId, { channel: 'bench', type: 'timezone', data: { tz: opts.tz } }).catch(() => 0);
      if (run !== this.run) return;
      const status = await send(this.deviceId, { channel: 'system', type: 'app', code: remoteApp(app.code), description: `${app.name} (from Bench)` });
      if (run !== this.run) return;
      track('mirror', { result: status === 200 ? 'live' : status === 503 ? 'offline' : 'refused', display: this.shown });
      if (!this.result(status)) return this.halt();
      this.remember(opts.display);
    } catch (e) {
      if (run !== this.run) return;
      track('mirror', { result: 'unreachable', display: this.shown });
      this.set('error', `Couldn't reach the relay: ${e instanceof Error ? e.message : e}`);
      return this.halt();
    }
    this.set('live', `${app.name} is running on the device, driven by this bench.`);
    if (!this.timer) this.timer = setInterval(() => void this.tick(), PERIOD_MS);
  }

  /** The board didn't get the app: it still runs another, so this one's updates don't go. */
  private halt(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.run++;
    this.wanted = false;
    this.halt();
    this.source = null;
    this.set('off', '');
  }

  /** Mirroring, or about to: a new run (another app, a restart) is pushed too. */
  get active(): boolean {
    return this.wanted;
  }

  private async tick(): Promise<void> {
    // While an app is on its way, an update would go to the one it replaces.
    if (!this.source || this.inFlight || this.status === 'pushing' || Date.now() < this.retryAt) return;
    const { controls, bench, buttons, gestures, touches, events } = this.source();
    const sent = this.eventsSent;
    const fresh = events?.filter((e) => e[0] > sent) ?? [];
    const snap = this.reader.read(controls, bench, buttons, gestures, touches, fresh);
    const offered = Object.keys(snap.s);
    const json = shed(snap, this.waiting);
    if (bytes(json) > MAX_BYTES) {
      if (this.status !== 'error') this.set('error', 'This app has too many controls to mirror: an update is over the 1 KB the device takes.');
      track('mirror', { result: 'too_big', display: this.shown });
      return;
    }
    const now = Date.now();
    if (json === this.last && now - this.lastAt < HEARTBEAT_MS) return;
    this.inFlight = true;
    const run = this.run;
    try {
      const status = await send(this.deviceId, { channel: 'app', type: 'bench', data: snap });
      if (run !== this.run) return;
      if (this.result(status)) {
        this.last = json;
        this.lastAt = now;
        // Those shed to fit are gone: they'd only crowd out the next ones.
        if (fresh.length) this.eventsSent = fresh[fresh.length - 1][0];
        this.waiting = new Set(offered.filter((k) => !(k in snap.s)));
        this.reader.confirm();
        this.sent++;
        this.backoff = this.retryAt = 0;
        if (this.status !== 'live') this.set('live', 'Back in touch with the device.');
        else this.notify();
      } else this.wait();
    } catch {
      if (run === this.run) {
        this.set('error', "Couldn't reach the relay. Still trying…");
        this.wait();
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** Try again later, and later still while the board stays out of reach. */
  private wait(): void {
    this.backoff = Math.min(HEARTBEAT_MS, this.backoff ? this.backoff * 2 : 2 * PERIOD_MS);
    this.retryAt = Date.now() + this.backoff;
  }

  /** True when the relay delivered it. */
  private result(status: number): boolean {
    if (status === 200) return true;
    if (status === 503) this.set('offline', "The device isn't connected to the relay. Is it on and online?");
    else this.set('error', `The relay answered ${status}.`);
    return false;
  }

  private set(status: RemoteStatus, message: string) {
    this.status = status;
    this.message = message;
    this.notify();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const remote = new RemoteMirror();
