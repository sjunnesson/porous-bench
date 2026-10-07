import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ResidentHost, type ResidentBoard } from '../src/resident/host';
import { remoteApp, SnapshotReader } from '../src/resident/remote';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { Bench, DEFAULT_PARTS } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';
import type { Knob } from '../src/sim/inputs/knob';
import type { Pir } from '../src/sim/inputs/pir';

const factory = new LuaFactory();

/** A real Resident device, as far as the shim can tell: none of Bench's drivers. */
const FIRMWARE = 'dial, trigger, light, pir, climate, touch, ld2410 = nil, nil, nil, nil, nil, nil, nil\n';

async function device(app: string, firmware = FIRMWARE) {
  const clock = new SimClock();
  clock.paused = true;
  const display = new Display(findDevice('waveshare-esp32-c6-lcd-1.47')!, clock);
  const logs: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons: [new Button({}, clock), new Button({}, clock)],
    store: new AppStore('remote-test', false),
    log: (level, text) => logs.push(level === 'info' ? text : `${level}: ${text}`),
    telemetry: () => {},
    publish: () => 'sent',
  };
  const { host, error } = await ResidentHost.boot(factory, board, { code: firmware + remoteApp(app) });
  const run = async (ms: number) => {
    for (let i = 0; i < ms; i += 10) {
      clock.advance(10);
      host.step();
      // Showing a frame takes sim time (the bus transfer): run the clock until it's done.
      let done = false;
      void host.settle().then(() => (done = true));
      for (let k = 0; k < 500 && !done; k++) {
        clock.advance(1);
        await Promise.resolve();
      }
    }
  };
  return { host, error, logs, run };
}

const send = (host: ResidentHost, data: unknown) => host.queue({ name: 'bench', data: data as Record<string, unknown>, from: 'bench', channel: 'app' });

describe('remote mirror', () => {
  it("drives a real device's dial, trigger and sensors from Bench's updates", async () => {
    const t = await device(`
      local speed = dial.new("speed", { start = 3 })
      local go = trigger.new("go")
      function on_tick(ctx)
        local d = speed:delta()
        if d ~= 0 or go:was_pressed() then log.info("tick", speed:value(), d, tostring(pir.motion())) end
      end
      function on_event(ctx, e) log.info("event", e.name, e.channel, tostring(e.data.name or e.data.index or e.data.moving)) end`);
    expect(t.error).toBeUndefined();
    send(t.host, { d: { speed: [3, 0.3, 0] }, t: { go: [0, 0, 0] }, s: { pir: { motion: false } } });
    await t.run(150);
    expect(t.logs).toEqual([]); // the first update is a baseline: nothing fires
    send(t.host, { d: { speed: [5, 0.5, 2] }, t: { go: [1, 1, 0], '@a': [0, 0, 0] }, s: { pir: { motion: true } } });
    await t.run(150);
    expect(t.logs).toContain('event\tdial\tdriver\tspeed');
    expect(t.logs).toContain('event\ttrigger\tdriver\tgo');
    expect(t.logs).toContain('event\tmotion\tdriver\ttrue');
    expect(t.logs).toContain('tick\t5\t2\ttrue');
    t.logs.length = 0;
    send(t.host, { d: { speed: [5, 0.5, 2] }, t: { go: [1, 1, 0], '@a': [1, 1, 0] }, s: { pir: { motion: true } } });
    await t.run(150);
    expect(t.logs).toContain('event\ttap\tdriver\t0'); // Bench's button A: a tap on the device
  });

  it("leaves the device's own events to the app", async () => {
    const t = await device(`function on_event(ctx, e) log.info("got", e.name) end`);
    t.host.queue({ name: 'note', data: {}, from: 'phone', channel: 'app' });
    await t.run(100);
    expect(t.logs).toEqual(['got\tnote']);
  });

  it('sends only the stand-ins the app names', () => {
    const plain = remoteApp('function init(ctx) log.info("hi") end');
    for (const name of ['dial', 'trigger', 'light', 'pir', 'climate', 'touch', 'ld2410', 'imu', 'buzzer']) {
      expect(plain, name).not.toContain(`if not ${name} then`);
    }
    expect(plain).toContain('__bench_apply'); // Bench's buttons still arrive as taps
    const knob = remoteApp('local d = dial.new("speed")\nfunction on_tick(ctx) log.info(pir.motion()) end');
    expect(knob).toContain('if not dial then');
    expect(knob).toContain('if not pir then');
    expect(knob).not.toContain('if not trigger then');
  });

  it('gives a board without a buzzer a silent one', async () => {
    const t = await device(`function init(ctx) buzzer.beep(440, 50) buzzer.tone(880) buzzer.stop() log.info("beeped") end`, `buzzer = nil\n${FIRMWARE}`);
    expect(t.error).toBeUndefined();
    await t.run(50);
    expect(t.logs).toEqual(['beeped']);
  });

  it("reads Bench's controls and sensors into an update, counting dial steps", () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load(DEFAULT_PARTS);
    const pir = bench.add('pir') as Pir;
    const speed = new Dial({ min: 0, max: 10, start: 5 }, bench);
    speed.name = 'speed';
    const a = new Trigger({ builtin: 0 }, bench);
    const reader = new SnapshotReader();
    expect(reader.read([speed, a], bench, { a }).d.speed).toEqual([5, 0.5, 0]);
    (bench.part('knob-1') as Knob).turn(3);
    pir.wave();
    const snap = reader.read([speed, a], bench, { a });
    expect(snap.d.speed).toEqual([8, 0.8, 3]);
    expect(snap.t['@a']).toEqual([0, 0, 0]);
    expect(snap.s.pir).toEqual({ motion: true });
  });

  it('boots every bundled display app wrapped for a real device', async () => {
    const files = import.meta.glob<string>('../src/resident-apps/*.lua', { query: '?raw', import: 'default', eager: true });
    for (const [path, code] of Object.entries(files)) {
      if (/^--\s*@output\s+(strip|matrix)/m.test(code)) continue; // LED apps need an LED chain
      const t = await device(code);
      expect(t.error, path).toBeUndefined();
      await t.run(200);
      expect(t.logs.filter((l) => l.startsWith('error')), path).toEqual([]);
      t.host.close();
    }
  }, 60_000);
});
