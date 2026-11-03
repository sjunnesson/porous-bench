// A Resident Lua app as a sketch, on any page that runs one: the board (display, two buttons, IMU,
// buzzer) is whatever display it's given, with the drawing libraries its board's firmware has, plus
// any dials, triggers or radar the app declares (Bench's drivers). The sandbox loop runs inside
// loop(). What lies outside the board (the relay, the console, what Bench counts) comes from the
// page as a ResidentEnv: Bench's own is in sketch.ts, the gallery's in src/gallery/.

import type { LuaFactory } from 'wasmoon';
import type { Display } from '../sim/display';
import { dial, trigger } from '../sim/controls/controls';
import type { PartKind } from '../sim/controls/bench';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Imu } from '../sim/inputs/imu';
import type { SimInput } from '../sim/inputs/input';
import type { LD2410 } from '../sim/inputs/ld2410';
import { defineSketch, type Sketch } from '../sim/sketch';
import { type ResidentBoard, ResidentHost, resetScreen, type SendResult } from './host';
import { luaFactory } from './lua';
import type { LiveApp } from './session';
import { AppStore } from './store';
import type { Zone } from './zone';

export interface ResidentAppSource {
  /** A bundled app's id (src/resident-apps); the visitor's own apps have none. */
  id?: string;
  name: string;
  code: string;
  description?: string;
  generationId?: string;
  storeNs?: string;
  /** Set for apps that arrived over the relay / editor, so they persist once they boot. */
  live?: LiveApp;
}

/** What the page around the board gives an app. */
export interface ResidentEnv {
  zone(): Zone;
  /** The app's store outlives the page, as a board's NVS outlives a reboot. Unset: each run starts empty. */
  persistStore?: boolean;
  /** Resident's telemetry from the app's run: app_received, app_compiled, compile_error, runtime_error. */
  telemetry?(name: string, data?: Record<string, unknown>): void;
  /** The store turned a key away: it would take the app past its budget. */
  storeFull?(key: string): void;
  /** events.send: where the app's events go, and the line the console shows for one. Unset: nowhere. */
  publish?(name: string, json: string, keep: boolean, log: (text: string) => void): SendResult;
  /** The app asked for a sensor that wasn't on the bench, so one was put there. */
  partAdded?(kind: PartKind): void;
  /** The app booted: `ok` unless an error in its top-level code or init was reported. */
  booted?(host: ResidentHost, ok: boolean): void;
  closed?(host: ResidentHost): void;
  /** The Lua engine maker (unset: the page's shared wasm module). */
  factory?(): Promise<LuaFactory>;
}

const hosts = new WeakMap<Display, ResidentHost>();

export function appSketch(app: ResidentAppSource, env: ResidentEnv): Sketch {
  return defineSketch({
    name: app.name,
    description: app.description ?? 'Resident Lua app. Buttons: A / B keys (tap, or hold ½ s). Drag a .lua file onto the device to load another.',
    autoShow: false, // nothing reaches the glass until the app flips
    inputs: {
      // Triggers, so they can connect to the board's own buttons or any part on the bench.
      a: trigger({ label: 'Button A', key: 'KeyA', builtin: 0 }),
      b: trigger({ label: 'Button B', key: 'KeyB', builtin: 1 }),
    },

    async setup({ display, device, inputs, millis, declare, bench, libraries, log, warn, error, stopped }) {
      // A sensor the app asks for: the one on the bench, or a new one put there for it.
      const sensor = <T extends SimInput>(kind: PartKind, setup?: (part: T) => void): T => {
        const { part, added } = bench.ensure<T>(kind);
        if (added) {
          env.partAdded?.(kind);
          setup?.(part);
          log(`added ${part.label} to the bench for this app`);
        }
        return part;
      };
      display.setRotation(device.firmwareRotation ?? 0);
      await resetScreen(display);
      const board: ResidentBoard = {
        display,
        now: () => millis(),
        zone: () => env.zone(),
        buttons: [inputs.a, inputs.b],
        // The board's IMU and buzzer, or ones you put on the bench (read each time: you can add one later).
        get imu() {
          return bench.first<Imu>('imu');
        },
        get buzzer() {
          return bench.first<Buzzer>('buzzer');
        },
        dial: (name, opts) => declare(name, dial(opts)),
        trigger: (name, opts) => declare(name, trigger(opts)),
        radar: (opts) => sensor<LD2410>('ld2410', (r) => opts.mode && r.setMode(opts.mode)),
        sensor: (kind) => sensor(kind),
        present: (kind) => bench.first(kind),
        libraries,
        store: new AppStore(app.storeNs || 'app', env.persistStore ?? false, (key) => { // no namespace, or an empty one: the shared slot, as on the board
          warn(`store: '${key}' rejected, over the 2048-byte budget`);
          env.storeFull?.(key);
        }),
        log: (level, text) => (level === 'error' ? error(text) : level === 'warn' ? warn(text) : log(text)),
        telemetry: (name, data) => env.telemetry?.(name, data),
        publish: (name, json, keep) => env.publish?.(name, json, keep, log) ?? 'dropped',
      };
      const { host, error: bootError, running } = await ResidentHost.boot(await (env.factory ?? luaFactory)(), board, app);
      // Stopped while it booted (another app came in): the next app's host is the session's now.
      if (stopped()) {
        host.close();
        return;
      }
      if (bootError && !running) {
        host.close();
        throw new Error(bootError);
      }
      if (bootError) error(bootError); // reported, and the app runs on, as on the board
      hosts.set(display, host);
      env.booted?.(host, !bootError);
    },

    async loop({ display, delay }) {
      const host = hosts.get(display);
      if (!host) return delay(100);
      host.step();
      await host.settle();
      await delay(5);
    },

    teardown({ display }) {
      const host = hosts.get(display);
      if (!host) return;
      host.close();
      env.closed?.(host);
    },
  });
}
