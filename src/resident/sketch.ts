// A Resident Lua app as a Bench sketch: the board (display, two buttons, IMU, buzzer) is
// whatever display is selected, and the sandbox loop runs inside loop().

import type { Display } from '../sim/display';
import { trigger } from '../sim/controls/controls';
import { buzzer } from '../sim/inputs/buzzer';
import { imu } from '../sim/inputs/imu';
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
      // Triggers, so you can swap a button for an encoder push, a shake or the radar.
      a: trigger({ label: 'Button 0 (A)', key: 'KeyA' }),
      b: trigger({ label: 'Button 1 (B)', key: 'KeyB' }),
      imu: imu(),
      buzzer: buzzer(),
    },

    async setup({ display, device, inputs, millis, log, warn, error }) {
      display.setRotation(device.firmwareRotation ?? 0);
      await resetScreen(display);
      const board: ResidentBoard = {
        display,
        now: () => millis(),
        zone: () => session.zone,
        buttons: [inputs.a, inputs.b],
        imu: inputs.imu,
        buzzer: inputs.buzzer,
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
