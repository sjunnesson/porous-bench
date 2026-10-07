import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ResidentHost, resetScreen, type ResidentBoard } from '../src/resident/host';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { Bench, DEFAULT_PARTS } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import type { DeviceProfile } from '../src/sim/devices/types';
import { Display } from '../src/sim/display';
import { ledProfile, MATRIX_SIZES } from '../src/sim/leds';
import { Imu } from '../src/sim/inputs/imu';
import { LD2410 } from '../src/sim/inputs/ld2410';

// Every bundled app must boot and run without a Lua error on each kind of output it's written for:
// display apps on a colour LCD in landscape and portrait, a tiny 1-bit OLED and e-paper; strip apps
// on a strip and a ring; matrix apps on every matrix size.
const OUTPUTS: Record<'display' | 'strip' | 'matrix', DeviceProfile[]> = {
  display: ['m5stickc-plus2', 'waveshare-esp32-c6-lcd-1.47', 'ssd1306-128x32', 'waveshare-epd-2.13-v4'].map((id) => findDevice(id)!),
  strip: [ledProfile({ kind: 'strip', count: 30 }), ledProfile({ kind: 'ring', count: 12 })],
  matrix: MATRIX_SIZES.map(([w, h]) => ledProfile({ kind: 'matrix', w, h })),
};
const files = import.meta.glob<string>('../src/resident-apps/*.lua', { query: '?raw', import: 'default', eager: true });
const apps = Object.entries(files).map(([path, code]) => ({
  name: path.split('/').pop()!,
  code,
  target: (/^--\s*@output\s+(display|strip|matrix)\b/m.exec(code)?.[1] ?? 'display') as keyof typeof OUTPUTS,
}));
const factory = new LuaFactory();

async function runApp(code: string, device: DeviceProfile, ms: number) {
  const clock = new SimClock();
  clock.paused = true;
  const display = new Display(device, clock);
  display.setRotation(device.firmwareRotation ?? 0);
  const bench = new Bench(clock);
  bench.load(DEFAULT_PARTS);
  const problems: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/Stockholm'),
    buttons: [new Trigger({}, bench), new Trigger({}, bench)],
    imu: new Imu({}, clock),
    store: new AppStore('apps-test', false),
    dial: (_name, opts) => new Dial(opts, bench),
    trigger: (_name, opts) => new Trigger(opts, bench),
    radar: (opts) => new LD2410(opts, clock),
    sensor: (kind) => bench.ensure(kind).part,
    log: (level, text) => level === 'error' && problems.push(text),
    telemetry: () => {},
    publish: () => 'sent',
  };
  // Showing a frame finishes in sim time (an e-paper refresh takes seconds): run the clock until it has.
  const until = async (p: Promise<unknown>) => {
    let done = false;
    void p.then(() => (done = true));
    for (let k = 0; k < 2000 && !done; k++) {
      clock.advance(5);
      await Promise.resolve();
    }
  };
  await until(resetScreen(display));
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  if (error) return [error];
  for (let t = 0; t < ms; t += 20) {
    clock.advance(20);
    host.step();
    await until(host.settle());
  }
  host.close();
  return problems;
}

describe('bundled apps', () => {
  for (const app of apps) {
    it(`${app.name} runs on every kind of ${app.target}`, async () => {
      for (const device of OUTPUTS[app.target]) {
        expect(await runApp(app.code, device, 600), `${app.name} on ${device.id}`).toEqual([]);
      }
    }, 60_000);
  }
});
