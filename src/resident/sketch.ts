// A Resident Lua app as a Bench sketch: the board (display, two buttons, IMU, buzzer) is
// whatever display is selected, plus any dials, triggers or radar the app declares (Bench's
// drivers). The sandbox loop runs inside loop().

import type { Display } from '../sim/display';
import { dial, trigger } from '../sim/controls/controls';
import type { PartKind } from '../sim/controls/bench';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Imu } from '../sim/inputs/imu';
import type { SimInput } from '../sim/inputs/input';
import type { LD2410 } from '../sim/inputs/ld2410';
import { defineSketch, type Sketch } from '../sim/sketch';
import { type ResidentBoard, ResidentHost, resetScreen } from './host';
import { luaFactory } from './lua';
import { type LiveApp, session } from './session';
import { AppStore } from './store';

export interface ResidentAppSource {
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
  return defineSketch({
    name: app.name,
    description: app.description ?? 'Resident Lua app. Buttons: A / B keys (tap, or hold ½ s). Drag a .lua file onto the device to load another.',
    autoShow: false, // nothing reaches the glass until the app flips
    inputs: {
      // Triggers, so they can connect to the board's own buttons or any part on the bench.
      a: trigger({ label: 'Button A', key: 'KeyA', builtin: 0 }),
      b: trigger({ label: 'Button B', key: 'KeyB', builtin: 1 }),
    },

    async setup({ display, device, inputs, millis, declare, bench, log, warn, error }) {
      // A sensor the app asks for: the one on the bench, or a new one put there for it.
      const sensor = <T extends SimInput>(kind: PartKind, setup?: (part: T) => void): T => {
        const { part, added } = bench.ensure<T>(kind);
        if (added) {
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
        store: new AppStore(app.storeNs ?? 'app', true, (key) => {
          warn(`store: '${key}' rejected, over the 2048-byte budget`);
          session.telemetry('store_full', { error: key });
        }),
        log: (level, text) => (level === 'error' ? error(text) : level === 'warn' ? warn(text) : log(text)),
        telemetry: (name, data) => session.telemetry(name, data, app.generationId),
        publish: (name, json, keep) => {
          const r = session.relay.publish(name, json, keep);
          log(`events.send("${name}", ${json}) → ${r}${r === 'dropped' && session.status === 'off' ? ' (connect to the relay to send)' : ''}`);
          return r;
        },
      };
      const { host, error: bootError } = await ResidentHost.boot(await luaFactory(), board, app);
      if (bootError) {
        host.close();
        throw new Error(bootError);
      }
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
