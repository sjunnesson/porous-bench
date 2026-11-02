// A Resident Lua app as a Bench sketch: the board (display, two buttons, IMU, buzzer) is
// whatever display is selected, with the drawing libraries its board's firmware has, plus any
// dials, triggers or radar the app declares (Bench's drivers). The sandbox loop runs inside loop().

import type { Display } from '../sim/display';
import { dial, trigger } from '../sim/controls/controls';
import type { PartKind } from '../sim/controls/bench';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Imu } from '../sim/inputs/imu';
import type { SimInput } from '../sim/inputs/input';
import type { LD2410 } from '../sim/inputs/ld2410';
import { appBooted, appFailed, errorStage, track } from '../analytics';
import { defineSketch, type Sketch } from '../sim/sketch';
import { type ResidentBoard, ResidentHost, resetScreen } from './host';
import { luaFactory } from './lua';
import { type LiveApp, session } from './session';
import { AppStore } from './store';

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

const hosts = new WeakMap<Display, ResidentHost>();

export function residentSketch(app: ResidentAppSource): Sketch {
  const counted = app.id ?? 'own'; // how analytics names it
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
          track('part_added', { kind, by: 'app' });
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
        zone: () => session.zone,
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
        store: new AppStore(app.storeNs || 'app', true, (key) => { // no namespace, or an empty one: the shared slot, as on the board
          warn(`store: '${key}' rejected, over the 2048-byte budget`);
          session.telemetry('store_full', { error: key });
          appFailed(counted, 'store_full');
        }),
        log: (level, text) => (level === 'error' ? error(text) : level === 'warn' ? warn(text) : log(text)),
        telemetry: (name, data) => {
          session.telemetry(name, data, app.generationId);
          if (name === 'compile_error') appFailed(counted, 'compile');
          if (name === 'runtime_error') appFailed(counted, errorStage(String(data?.error ?? '')));
        },
        publish: (name, json, keep) => {
          const r = session.relay.publish(name, json, keep);
          log(`events.send("${name}", ${json}) → ${r}${r === 'dropped' && session.status === 'off' ? ' (connect to the relay to send)' : ''}`);
          return r;
        },
      };
      const { host, error: bootError, running } = await ResidentHost.boot(await luaFactory(), board, app);
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
      else appBooted(counted);
      hosts.set(display, host);
      session.host = host;
      if (app.live) session.persistLive(app.live);
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
      if (session.host === host) session.host = null;
    },
  });
}
