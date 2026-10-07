// Mirror an app onto a real Resident device: Bench pushes the app (wrapped in a small shim that
// stands in for Bench's drivers) and then streams the state of its virtual inputs to it as "bench"
// events, so the real display is driven by the virtual sensors. Everything goes through the relay,
// via Bench's own /relay path (a same-origin proxy: the relay itself doesn't allow browser calls).

import type { Bench } from '../sim/controls/bench';
import type { Control, Dial, Trigger } from '../sim/controls/controls';
import type { Climate } from '../sim/inputs/climate';
import type { Imu } from '../sim/inputs/imu';
import type { LD2410 } from '../sim/inputs/ld2410';
import type { LightSensor } from '../sim/inputs/light';
import type { Pir } from '../sim/inputs/pir';
import type { Touch } from '../sim/inputs/touch';
import { minifyLua } from './minify';
import remoteSrc from './lua/remote.lua?raw';

/** The shim with only the stand-ins `code` names: an app that never mentions `pir` doesn't pay for it. */
function shimFor(code: string): string {
  return remoteSrc.replace(/^-- @@part (\w+)\n([\s\S]*?)^-- @@end\n/gm, (_, name: string, body: string) =>
    new RegExp(`\\b${name}\\b`).test(code) ? body : '',
  );
}

/**
 * The app as the real device runs it: Bench's driver shim around it, trimmed to the stand-ins the app
 * uses and minified. A board without PSRAM has ~70 KB to receive and compile it in.
 */
export function remoteApp(code: string): string {
  const [head, foot] = shimFor(code).split('-- @@APP@@');
  return minifyLua(`${head}\n${code}\n${foot}`);
}

export interface Snapshot {
  /** Dials: [value, fraction, steps so far]. */
  d: Record<string, [number, number, number]>;
  /** Triggers: [presses, releases, down]. Bench's buttons A and B are "@a" and "@b". */
  t: Record<string, [number, number, 0 | 1]>;
  /** Sensor readings, as their Lua modules return them. */
  s: Record<string, unknown>;
}

const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/** Reads the app's controls and the bench's sensors into an update, counting dial steps as it goes. */
export class SnapshotReader {
  private steps = new Map<Dial, { last: number; total: number }>();

  read(controls: Control[], bench: Bench, buttons: { a?: unknown; b?: unknown }): Snapshot {
    const snap: Snapshot = { d: {}, t: {}, s: {} };
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
        const t = c as Trigger;
        const down = t.isPressed() ? 1 : 0; // also brings the edge counts up to date
        const name = c === buttons.a ? '@a' : c === buttons.b ? '@b' : c.name;
        snap.t[name] = [t.presses, t.releases, down];
      }
    }
    const light = bench.first<LightSensor>('light');
    if (light) snap.s.light = { level: round(light.level), lux: Math.round(light.lux()), raw: light.read() };
    const pir = bench.first<Pir>('pir');
    if (pir) snap.s.pir = { motion: pir.motion() };
    const climate = bench.first<Climate>('climate');
    if (climate) snap.s.climate = { temperature: round(climate.readTemperature(), 1), humidity: round(climate.readHumidity(), 1) };
    const touch = bench.first<Touch>('touch');
    if (touch) snap.s.touch = { touched: touch.isPressed(), raw: touch.touchRead() };
    const imu = bench.first<Imu>('imu');
    if (imu) snap.s.imu = imu.accel().map((x) => round(x));
    const radar = bench.first<LD2410>('ld2410');
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
}

export type RemoteStatus = 'off' | 'pushing' | 'live' | 'offline' | 'error';

const KEY = 'bench:remote-device';
const PERIOD_MS = 100; // up to 10 updates a second, and only when something changed
const HEARTBEAT_MS = 2000; // …or this often anyway, so a device that just connected catches up
const MAX_BYTES = 1000; // Resident drops events over 1024 bytes

/** Sends to a real device through the relay, from this page's origin. */
async function send(deviceId: string, body: unknown): Promise<number> {
  const res = await fetch(`/relay/devices/${encodeURIComponent(deviceId)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

export class RemoteMirror {
  deviceId: string;
  status: RemoteStatus = 'off';
  message = '';
  sent = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private source: (() => { controls: Control[]; bench: Bench; buttons: { a?: unknown; b?: unknown } }) | null = null;
  private reader = new SnapshotReader();
  private last = '';
  private lastAt = 0;
  private inFlight = false;
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

  /** Push the app to the device, then keep its inputs in step with Bench's. */
  async start(app: { name: string; code: string }, source: NonNullable<RemoteMirror['source']>): Promise<void> {
    if (!this.deviceId) return;
    this.source = source;
    this.reader = new SnapshotReader();
    this.last = '';
    this.set('pushing', `Sending ${app.name}…`);
    try {
      const status = await send(this.deviceId, { channel: 'system', type: 'app', code: remoteApp(app.code), description: `${app.name} (from Bench)` });
      if (!this.result(status)) return;
    } catch (e) {
      this.set('error', `Couldn't reach the relay: ${e instanceof Error ? e.message : e}`);
      return;
    }
    this.set('live', `${app.name} is running on the device, driven by this bench.`);
    if (!this.timer) this.timer = setInterval(() => void this.tick(), PERIOD_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.source = null;
    this.set('off', '');
  }

  get active(): boolean {
    return this.timer !== null;
  }

  private async tick(): Promise<void> {
    if (!this.source || this.inFlight) return;
    const { controls, bench, buttons } = this.source();
    const snap = this.reader.read(controls, bench, buttons);
    let json = JSON.stringify(snap);
    if (json.length > MAX_BYTES) {
      delete snap.s.radar; // the biggest part; dials and triggers matter most
      json = JSON.stringify(snap);
    }
    const now = Date.now();
    if (json === this.last && now - this.lastAt < HEARTBEAT_MS) return;
    this.inFlight = true;
    try {
      const status = await send(this.deviceId, { channel: 'app', type: 'bench', data: snap });
      if (this.result(status)) {
        this.last = json;
        this.lastAt = now;
        this.sent++;
        if (this.status !== 'live') this.set('live', 'Back in touch with the device.');
        else this.notify();
      }
    } catch {
      this.set('error', "Couldn't reach the relay. Still trying…");
    } finally {
      this.inFlight = false;
    }
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
