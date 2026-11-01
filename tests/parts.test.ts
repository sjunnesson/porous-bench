// The parts added for more kinds of apps (joystick, switch, microphone, IR remote, keypad, RFID,
// distance, CO₂, pulse, thermal camera) and what they stand on: keyed parts whose presses carry a
// code, sensor drivers shared by Bench and the mirror, events replayed on a real board, arrays packed
// for the relay, and I2C addresses on the Wiring view.

import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { DRIVERS, pack, unpack } from '../src/resident/drivers';
import { ResidentHost, type ResidentBoard } from '../src/resident/host';
import { remoteApp, shed, SnapshotReader, type Snapshot } from '../src/resident/remote';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { findBoard } from '../src/sim/boards';
import { SimClock } from '../src/sim/clock';
import { Bench, boardBench, type PartKind, type PartSpec } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';
import type { Co2 } from '../src/sim/inputs/co2';
import type { IrReceiver } from '../src/sim/inputs/ir';
import type { Joystick } from '../src/sim/inputs/joystick';
import type { Keypad } from '../src/sim/inputs/keypad';
import type { Mic } from '../src/sim/inputs/mic';
import type { Pulse } from '../src/sim/inputs/pulse';
import type { RfidReader } from '../src/sim/inputs/rfid';
import type { Switch } from '../src/sim/inputs/switch';
import type { Thermal } from '../src/sim/inputs/thermal';
import type { Tof } from '../src/sim/inputs/tof';
import { wiring } from '../src/sim/wiring';

const factory = new LuaFactory();

/** An app on Bench, with `parts` on the bench; a sensor it reads that isn't there is put there for it. */
async function boot(code: string, parts: PartSpec[] = [], deviceId = 'waveshare-esp32-s3-touch-lcd-2') {
  const clock = new SimClock();
  clock.paused = true;
  const device = findDevice(deviceId)!;
  const display = new Display(device, clock);
  display.setRotation(device.firmwareRotation ?? 0);
  const logs: string[] = [];
  const bench = new Bench(clock);
  bench.load(parts);
  const declared: Record<string, Dial | Trigger> = {};
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons: [new Button({}, clock), new Button({}, clock)],
    store: new AppStore('parts-test', false),
    dial: (name, opts) => (declared[name] = new Dial(opts, bench)),
    trigger: (name, opts) => (declared[name] = new Trigger(opts, bench)),
    sensor: (kind) => bench.ensure(kind).part,
    present: (kind) => bench.first(kind),
    log: (level, text) => logs.push(level === 'info' ? text : `${level}: ${text}`),
    telemetry: () => {},
    publish: () => 'sent',
  };
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  /** The sandbox loop for `ms` of sim time, for apps that don't draw. */
  const steps = (ms: number) => {
    for (let i = 0; i < ms; i += 5) {
      clock.advance(5);
      host.step();
    }
  };
  /** The sandbox loop with each pass's frames shown (each takes the clock on by up to 50 ms). */
  const run = async (ms: number) => {
    for (let i = 0; i < ms; i += 5) {
      clock.advance(5);
      host.step();
      const settled = host.settle();
      for (let k = 0; k < 50; k++) {
        clock.advance(1);
        await Promise.resolve();
      }
      await settled;
    }
  };
  return { host, error, logs, run, steps, bench, clock, declared };
}

/** The app as a real board runs it, wrapped in the mirror's shim, with none of Bench's drivers. */
async function device(app: string) {
  const none = ['dial', 'trigger', 'ld2410', ...Object.keys(DRIVERS)];
  const firmware = `${none.join(', ')} = ${none.map(() => 'nil').join(', ')}\n`;
  const t = await boot(firmware + remoteApp(app));
  const send = (data: Partial<Snapshot>) => t.host.queue({ name: 'bench', data: { d: {}, t: {}, s: {}, ...data }, from: 'bench', channel: 'app' });
  return { ...t, send };
}

const spec = (kind: PartKind, n = 1): PartSpec => ({ id: `${kind}-${n}`, kind, label: `${kind} ${n}` });

describe('packing arrays for the relay', () => {
  it('sends 12 bits a number in two characters JSON and Lua take as they are', () => {
    const temps = [21.25, 22, 34.75, -20, 80, 0.25];
    const s = pack(temps, -20, 0.25);
    expect(s).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(unpack(s, -20, 0.25)).toEqual(temps);
    expect(unpack(pack([5000, -5], 0, 1), 0, 1)).toEqual([4095, 0]); // clamped to what 12 bits hold
  });

  it("unpacks them the same way in the shim, on the board", async () => {
    const t = await device(`function init(ctx) local _ = thermal local v = __unpack("${pack([21.25, -3.5, 80], -20, 0.25)}", -20, 0.25) log.info(#v, v[1], v[2], v[3]) end`);
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual(['3\t21.25\t-3.5\t80']); // a whole number as Bench gives it: 80, not 80.0
  });
});

describe('the mirror', () => {
  it('sheds the biggest readings first, then old events, to stay under the 1 KB the device takes', () => {
    const snap: Snapshot = {
      d: { speed: [1, 0.1, 0] },
      t: {},
      s: { big: 'x'.repeat(700), small: { on: true }, mid: 'y'.repeat(200) },
      ev: Array.from({ length: 8 }, (_, i): [number, string, Record<string, unknown>] => [i + 1, 'key', { key: String(i) }]),
    };
    const json = shed(snap);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(1000);
    expect(Object.keys(snap.s)).toEqual(['small', 'mid']);
    expect(snap.ev).toHaveLength(8); // readings went first; every event still fits
    expect(snap.d.speed).toEqual([1, 0.1, 0]);
  });

  it('sends only the readings of the sensors the app names', () => {
    const clock = new SimClock();
    const bench = new Bench(clock);
    bench.load([spec('joystick'), spec('switch'), spec('light')]);
    const snap = new SnapshotReader(new Set<PartKind>(['switch'])).read([], bench, {});
    expect(Object.keys(snap.s)).toEqual(['switch']);
  });

  it('carries the stand-ins an app names, and the event replay to any app that takes events', () => {
    expect(remoteApp('function init(ctx) end')).not.toContain('ev_seq');
    for (const name of ['joystick', 'switch']) expect(remoteApp(`function init(ctx) log.info(${name}.read()) end`), name).toContain(`if not ${name} then`);
    // Handlers in a table name no sensor and no event, and still get them.
    expect(remoteApp('local on = {} function on_event(ctx, e) local f = on[e.name] if f then f(e.data) end end')).toContain('ev_seq');
    // A sensor named only in a comment isn't carried.
    expect(remoteApp('-- reads the pulse sensor\nfunction init(ctx) end')).not.toContain('if not pulse then');
  });
});

describe('joystick', () => {
  it('drives two dials and a trigger, and springs back to read 0', () => {
    const clock = new SimClock();
    const bench = new Bench(clock);
    bench.load([spec('joystick')]);
    const j = bench.part('joystick-1') as Joystick;
    const x = new Dial({ min: -10, max: 10, start: 0, via: 'joystick-x' }, bench);
    const y = new Dial({ min: -10, max: 10, start: 0, via: 'joystick-y' }, bench);
    const fire = new Trigger({ via: 'joystick-press' }, bench);
    expect([x.source, y.source, fire.source]).toEqual(['joystick-1:x', 'joystick-1:y', 'joystick-1:press']);
    j.set(1, 0);
    expect([x.value, y.value]).toEqual([10, 0]);
    j.set(0, -0.5);
    expect([x.value, y.value]).toEqual([0, -5]);
    j.button.setDown(true);
    expect(fire.wasPressed()).toBe(true);
    // The driver: centred with a dead zone, and analogRead() resting a little off 2048.
    j.set(0.03, 0);
    expect(j.axis('x')).toBe(0);
    j.set(0, 0);
    expect(Math.abs(j.raw('x') - 2026)).toBeLessThan(10);
    j.set(-1, 0);
    expect(j.raw('x')).toBe(0); // the ADC reads 0 below ~0.1 V
  });

  it('reads in Lua, and says which way the stick is pushed as a d-pad would', async () => {
    const t = await boot(`
      function init(ctx) local r = joystick.read() log.info("rest", r.x, r.y, tostring(r.pressed)) end
      function on_event(ctx, e) if e.name == "stick" then log.info("stick", e.data.dir, joystick.x()) end end`);
    expect(t.error).toBeUndefined();
    const j = t.bench.first<Joystick>('joystick')!;
    j.set(-0.9, 0.1);
    await t.run(20);
    j.set(-0.4, 0); // still left: inside halfway but outside a third
    await t.run(20);
    j.set(0, 0);
    await t.run(20);
    expect(t.logs).toEqual(['rest\t0\t0\tfalse', 'stick\tleft\t-0.894', 'stick\tcenter\t0']);
  });
});

describe('switch', () => {
  it('reads as a press that lasts while it is on, and a key flips it', () => {
    const clock = new SimClock();
    const bench = new Bench(clock);
    bench.load([spec('switch')]);
    const sw = bench.part('switch-1') as Switch;
    const door = new Trigger({ via: 'switch', key: 'KeyD' }, bench);
    expect(door.source).toBe('switch-1:on');
    sw.set(true);
    clock.advance(5000);
    expect(door.isPressed()).toBe(true);
    expect(door.pressedFor(4000)).toBe(true);
    door.handleKey('KeyD', true);
    door.handleKey('KeyD', false);
    expect(sw.isOn()).toBe(false);
    expect(door.wasReleased()).toBe(true);
  });

  it('sends a switch event on each flip, on Bench and replayed on a real board', async () => {
    const app = `function init(ctx) log.info("on", tostring(switch.on())) end
      function on_event(ctx, e) if e.name == "switch" then log.info("switch", tostring(e.data.on)) end end`;
    const t = await boot(app);
    const sw = t.bench.first<Switch>('switch')!;
    sw.set(true);
    await t.run(10);
    sw.set(false);
    await t.run(10);
    expect(t.logs).toEqual(['on\tfalse', 'switch\ttrue', 'switch\tfalse']);
    const events = t.host.sensorEvents();
    expect(events.map((e) => e[2].on)).toEqual([true, false]);

    const d = await device(app);
    expect(d.error).toBeUndefined();
    d.send({ s: { switch: { on: false } }, ev: [] }); // the first update is a baseline
    await d.run(10);
    d.send({ s: { switch: { on: true } }, ev: events.slice(0, 1) });
    await d.run(10);
    d.send({ s: { switch: { on: false } }, ev: events });
    await d.run(10);
    expect(d.logs).toEqual(['on\tfalse', 'switch\ttrue', 'switch\tfalse']);
  });
});

describe('microphone', () => {
  it('hears a clap as a clap, a block after it lands, and music or a room turned loud as no clap', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('mic')]);
    const mic = bench.part('mic-1') as Mic;
    const clap = new Trigger({ via: 'clap' }, bench);
    const loud = new Dial({ min: 0, max: 70, via: 'sound' }, bench);
    expect([clap.source, loud.source]).toEqual(['mic-1:clap', 'mic-1:level']);
    clock.advance(2000);
    expect(loud.value).toBe(Math.round(mic.read().db) - 30); // 0 dB at 30 dB SPL
    mic.clap();
    clock.advance(10);
    expect(clap.wasPressed()).toBe(false); // its block isn't finished yet, nor the quieter one after
    clock.advance(60);
    expect(clap.wasPressed()).toBe(true);
    clock.advance(200);
    expect(clap.isPressed()).toBe(false);
    // Two claps between two reads: both count.
    mic.clap();
    clock.advance(300);
    mic.clap();
    clock.advance(300);
    clap.isPressed(); // brings its edge counts up to date
    expect(clap.presses).toBe(3);
    // Claps heard over `ms`, read every 30 ms as an app's tick would.
    const heard = (ms: number) => {
      clap.isPressed();
      const before = clap.presses;
      for (let t = 0; t < ms; t += 30) {
        clock.advance(30);
        clap.isPressed();
      }
      return clap.presses - before;
    };
    mic.setMusic(true);
    expect(heard(3000)).toBe(0); // the music starting, and its beat
    let claps = 0;
    for (let i = 0; i < 20; i++) {
      claps += heard(300 + ((i * 67) % 250)); // anywhere on the beat
      mic.clap();
      claps += heard(150);
    }
    expect(claps).toBe(20);
    mic.setMusic(false);
    heard(3000);
    mic.setRoom(85); // the level turned right up at once
    expect(heard(3000)).toBe(0);
  });

  it('reads level, dB and bands in Lua, and sends a clap event', async () => {
    const t = await boot(`
      function init(ctx) local r = mic.read() log.info(#r.bands, r.db > 30, r.level >= 0) end
      function on_event(ctx, e) if e.name == "clap" then log.info("clap", e.data.db > 90) end end`);
    expect(t.error).toBeUndefined();
    await t.run(1500);
    t.bench.first<Mic>('mic')!.clap();
    await t.run(100);
    expect(t.logs).toEqual(['8\ttrue\ttrue', 'clap\ttrue']);
  });

  it('comes with the boards that have one', () => {
    const clock = new SimClock();
    expect(boardBench(findDevice('m5stickc-plus2')!, clock, []).hardware().map((h) => h.id)).toContain('builtin-mic');
    expect(boardBench(findDevice('waveshare-esp32-c6-lcd-1.47')!, clock, []).hardware().map((h) => h.id)).not.toContain('builtin-mic');
  });
});

describe('IR receiver', () => {
  function setup() {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('ir')]);
    return { clock, bench, ir: bench.part('ir-1') as IrReceiver };
  }

  it("decodes a key as NEC does: down once its frame is in, held by repeats, let go after they stop", () => {
    const { clock, bench, ir } = setup();
    const ok = new Trigger({ via: 'ir', code: 'ok' }, bench);
    const any = new Trigger({ via: 'ir' }, bench);
    expect([ok.source, any.source]).toEqual(['ir-1:ok', 'ir-1:any']);
    ir.press('ok', true);
    clock.advance(30);
    ir.press('ok', false); // a quick tap: the remote still sends the whole frame
    clock.advance(30);
    expect(ok.isPressed()).toBe(false);
    clock.advance(10); // 70 ms: the frame is in
    expect(ok.isPressed()).toBe(true);
    expect(any.wasPressed()).toBe(true);
    expect(any.code()).toBe('ok');
    clock.advance(110);
    expect(ok.isPressed()).toBe(true); // 180 ms: no repeat yet, but not given up
    clock.advance(10);
    expect(ok.isPressed()).toBe(false); // 190: 120 ms after the frame
    // Held for half a second: the frame, then a repeat every 108 ms.
    ir.press('5', true);
    clock.advance(500);
    ir.press('2', true); // one key at a time: ignored
    ir.press('5', false);
    clock.advance(300);
    expect(ir.read()).toEqual({ key: null, last: '5' });
    expect(any.presses).toBe(1);
    any.isPressed();
    expect(any.presses).toBe(2);
    expect(any.code()).toBe('5');
    expect(ok.presses).toBe(1);
  });

  it('gives Lua the key and every frame, and triggers say which key', async () => {
    const t = await boot(
      `local any = trigger.new("any", { via = "ir" })
      function init(ctx) log.info("address", ir.read().address) end
      function on_event(ctx, e)
        if e.name == "ir" then log.info("ir", e.data.key, e.data.code, tostring(e.data.held)) end
        if e.name == "trigger" and e.data.pressed then log.info("trigger", e.data.code, any:code()) end
      end`,
      [spec('ir')],
    );
    expect(t.error).toBeUndefined();
    const ir = t.bench.first<IrReceiver>('ir')!;
    ir.press('right', true);
    t.steps(150);
    ir.press('right', false);
    t.steps(200);
    // In one pass, the trigger's edge comes before the driver's own events.
    expect(t.logs).toEqual(['address\t0', 'trigger\tright\tright', 'ir\tright\t90\tfalse', 'ir\tright\t90\ttrue']);
  });

  it('sends its events to an app that only handles them, never reading the module', async () => {
    const t = await boot(`function on_event(ctx, e) if e.name == "ir" then log.info(e.data.key, tostring(e.data.held)) end end`, [spec('ir')]);
    expect(t.error).toBeUndefined();
    const ir = t.bench.first<IrReceiver>('ir')!;
    ir.press('up', true);
    t.steps(150);
    ir.press('up', false);
    t.steps(300);
    expect(t.logs).toEqual(['up\tfalse', 'up\ttrue']);
    // On a real board too: the shim replays events to an app that names only the event.
    expect(remoteApp('function on_event(ctx, e) if e.name == "key" then end end')).toContain('ev_seq');
  });

  it("presses OK, or the keypad's 1, for a keyboard key on a trigger connected to any key", () => {
    const clock = new SimClock();
    const bench = new Bench(clock);
    bench.load([spec('ir'), spec('keypad')]);
    const remote = new Trigger({ via: 'ir', key: 'KeyR' }, bench);
    const pad = new Trigger({ via: 'keypad', key: 'KeyP' }, bench);
    remote.handleKey('KeyR', true);
    pad.handleKey('KeyP', true);
    clock.advance(100);
    expect([remote.isPressed(), remote.code()]).toEqual([true, 'ok']);
    expect([pad.isPressed(), pad.code()]).toEqual([true, '1']);
  });

  it("carries a trigger's code to a real board", async () => {
    const d = await device(`
      local any = trigger.new("any", { via = "ir" })
      function on_event(ctx, e) if e.name == "trigger" then log.info("trigger", tostring(e.data.pressed), e.data.code, any:code()) end end`);
    expect(d.error).toBeUndefined();
    d.send({ t: { any: [0, 0, 0] } });
    await d.run(10);
    d.send({ t: { any: [1, 0, 1, 'hash'] } });
    await d.run(10);
    expect(d.logs).toEqual(['trigger\ttrue\thash\thash']);
  });
});

describe('keypad', () => {
  it('takes several pads at once, every press counted, each with its key', () => {
    const clock = new SimClock();
    const bench = new Bench(clock);
    bench.load([spec('keypad')]);
    const pad = bench.part('keypad-1') as Keypad;
    const five = new Trigger({ via: 'keypad', code: '5' }, bench);
    const any = new Trigger({ via: 'keypad' }, bench);
    pad.press('1', true);
    pad.press('5', true); // a second finger while the first is down
    pad.press('1', false);
    pad.press('5', false);
    pad.press('hash', true);
    expect(any.isPressed()).toBe(true);
    expect(any.presses).toBe(3);
    expect([1, 2, 3].map((n) => any.codeOf(n))).toEqual(['1', '5', 'hash']);
    expect(five.presses).toBe(0);
    five.isPressed();
    expect(five.presses).toBe(1);
    expect(pad.read()).toEqual({ keys: ['hash'], last: 'hash', mask: 1 << 11 });
  });

  it('sends key events and answers keypad.pressed() in Lua', async () => {
    const t = await boot(
      `function on_event(ctx, e) if e.name == "key" then log.info(e.data.key, tostring(e.data.pressed), tostring(keypad.pressed("5"))) end end
      function init(ctx) keypad.read() end`,
      [spec('keypad')],
    );
    expect(t.error).toBeUndefined();
    const pad = t.bench.first<Keypad>('keypad')!;
    pad.press('5', true);
    pad.press('5', false); // a tap within one pass: both edges arrive
    t.steps(10);
    expect(t.logs).toEqual(['5\ttrue\tfalse', '5\tfalse\tfalse']);
  });
});

describe('RFID reader', () => {
  it('finds a tag at its next poll, one at a time, with the same UID for the same part', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('rfid')]);
    const reader = bench.part('rfid-1') as RfidReader;
    const a = new Trigger({ via: 'rfid', code: 'card-a' }, bench);
    const any = new Trigger({ via: 'rfid' }, bench);
    expect([a.source, any.source]).toEqual(['rfid-1:card-a', 'rfid-1:tag']);
    const uid = reader.uid('card-a');
    expect(uid).toMatch(/^[0-9A-F]{8}$/);
    expect(reader.uid('sticker')).toMatch(/^04[0-9A-F]{12}$/);
    expect((new Bench(clock).add('rfid') as RfidReader).uid('card-a')).toBe(uid); // another bench, the same card
    expect(reader.uid('card-b')).not.toBe(uid);
    clock.advance(30);
    reader.place('card-a');
    expect(a.isPressed()).toBe(false); // the reader hasn't asked yet
    clock.advance(70);
    expect(a.isPressed()).toBe(true);
    expect(any.code()).toBe(uid);
    expect(reader.read()).toEqual({ present: true, uid, type: 'mifare-classic' });
    reader.place('fob'); // laying the fob down takes the card away
    clock.advance(100);
    expect(a.isPressed()).toBe(false);
    expect(any.isPressed()).toBe(true);
    expect(any.code()).toBe(reader.uid('fob'));
    // A tag laid down and taken off between two polls: the reader never saw it.
    reader.place(null);
    clock.advance(100);
    reader.place('card-b');
    clock.advance(20);
    reader.place(null);
    clock.advance(100);
    any.isPressed();
    expect(any.presses).toBe(2);
  });

  it('sends tag events when a tag comes and goes', async () => {
    const t = await boot(
      `function init(ctx) log.info("present", tostring(rfid.read().present)) end
      function on_event(ctx, e) if e.name == "tag" then log.info("tag", tostring(e.data.present), e.data.uid == rfid.uid() or "gone") end end`,
      [spec('rfid')],
    );
    expect(t.error).toBeUndefined();
    const reader = t.bench.first<RfidReader>('rfid')!;
    reader.place('sticker');
    t.steps(150);
    reader.place(null);
    t.steps(150);
    expect(t.logs).toEqual(['present\tfalse', 'tag\ttrue\ttrue', 'tag\tfalse\tgone']);
  });
});

describe('distance (time of flight)', () => {
  it('reads every 50 ms within a few mm, out of range with nothing there, and drives a dial and a trigger', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('tof')]);
    const tof = bench.part('tof-1') as Tof;
    const reach = new Dial({ min: 0, max: 120, via: 'distance' }, bench);
    const near = new Trigger({ via: 'near' }, bench);
    tof.setTarget(600);
    clock.advance(50); // the reading under way when it moved (the dial read it on connecting) is the old one
    const reads = new Set<number>();
    for (let i = 0; i < 20; i++) {
      clock.advance(10);
      reads.add(tof.mm()!);
    }
    expect(reads.size).toBeLessThanOrEqual(5); // a new reading each 50 ms, not each read
    for (const mm of reads) expect(Math.abs(mm - 600)).toBeLessThan(6);
    expect(reach.value).toBeGreaterThanOrEqual(59);
    expect(reach.value).toBeLessThanOrEqual(61);
    tof.setTarget(null);
    clock.advance(50);
    expect(tof.mm()).toBeNull();
    expect(reach.value).toBeGreaterThanOrEqual(59); // nothing there: the dial holds
    tof.setTarget(5000);
    clock.advance(50);
    expect(tof.mm()).toBeNull(); // past 4 m
    tof.setTarget(10);
    clock.advance(50);
    expect(tof.mm()).toBe(40); // nearer than it can read
    expect(near.isPressed()).toBe(true);
  });

  it('sends near events in Lua', async () => {
    const t = await boot(
      `function init(ctx) log.info("mm", tof.mm()) end
      function on_event(ctx, e) if e.name == "near" then log.info("near", tostring(e.data.near), e.data.mm ~= nil) end end`,
      [spec('tof')],
    );
    expect(t.error).toBeUndefined();
    const tof = t.bench.first<Tof>('tof')!;
    tof.setTarget(1000);
    t.steps(100);
    tof.setTarget(null);
    t.steps(100);
    expect(t.logs[0]).toMatch(/^mm\t2\d\d$/);
    expect(t.logs.slice(1)).toEqual(['near\tfalse\ttrue']);
  });
});

describe('CO₂', () => {
  it('measures every 5 s, the first 5 s after it starts, and a breath shows for a while', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('co2')]);
    const co2 = bench.part('co2-1') as Co2;
    const air = new Dial({ min: 400, max: 2000, step: 10, start: 400, via: 'co2' }, bench);
    const stuffy = new Trigger({ via: 'stuffy' }, bench);
    co2.setRoom(800);
    clock.advance(4900);
    expect(co2.read()).toBeNull();
    expect(air.value).toBe(400); // nothing yet: the dial holds
    clock.advance(100);
    expect(Math.abs(co2.read()!.co2 - 800)).toBeLessThanOrEqual(10);
    co2.setRoom(1200); // the reading keeps until the next measurement
    clock.advance(4000);
    expect(co2.read()!.co2).toBeLessThan(820);
    expect(stuffy.isPressed()).toBe(false);
    clock.advance(1000);
    expect(stuffy.isPressed()).toBe(true);
    co2.setRoom(600);
    co2.breathe();
    clock.advance(5000);
    expect(co2.read()!.co2).toBeGreaterThan(2800); // 3000 ppm more, 5 s into clearing
    clock.advance(120_000);
    expect(co2.read()!.co2).toBeLessThan(650);
  });

  it('sends each measurement as a co2 event', async () => {
    const t = await boot(
      `function init(ctx) log.info("ppm", tostring(co2.ppm())) end
      function on_event(ctx, e) if e.name == "co2" then log.info("co2", e.data.co2 > 600, e.data.temperature, e.data.humidity > 40) end end`,
      [spec('co2')],
    );
    expect(t.error).toBeUndefined();
    t.bench.first<Co2>('co2')!.setTemperature(19.5);
    t.steps(10_000);
    expect(t.logs[0]).toBe('ppm\tnil');
    expect(t.logs.slice(1).map((l) => l.replace(/\t19\.\d\t/, '\t19.x\t'))).toEqual(['co2\ttrue\t19.x\ttrue', 'co2\ttrue\t19.x\ttrue']);
  });
});

describe('pulse', () => {
  it('sees a finger at once, and gives a rate only after a few steady beats', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('pulse')]);
    const p = bench.part('pulse-1') as Pulse;
    const rate = new Dial({ min: 40, max: 180, start: 40, via: 'pulse' }, bench);
    const beat = new Trigger({ via: 'heartbeat' }, bench);
    expect(p.read().finger).toBe(false);
    expect(p.read().ir).toBeLessThan(5000);
    p.setBpm(90);
    p.setFinger(true);
    clock.advance(200);
    expect(p.read()).toMatchObject({ finger: true, bpm: null }); // past 50 000 counts, still rising
    clock.advance(1000);
    expect(p.read().ir).toBeGreaterThan(100_000);
    clock.advance(2000);
    expect(p.read().bpm).toBeNull(); // still settling, then counting beats
    expect(rate.value).toBe(40); // no rate: the dial holds
    clock.advance(5000);
    const bpm = p.read().bpm!;
    expect(Math.abs(bpm - 90)).toBeLessThanOrEqual(3);
    expect(rate.value).toBe(bpm);
    // Beats arrive as presses, every one counted.
    beat.isPressed();
    const before = beat.presses;
    clock.advance(6000);
    beat.isPressed();
    expect(beat.presses - before).toBeGreaterThanOrEqual(8);
    expect(beat.presses - before).toBeLessThanOrEqual(10);
    p.setFinger(false);
    clock.advance(200);
    expect(p.read()).toMatchObject({ finger: false, bpm: null });
  });

  it('keeps 32 samples in its FIFO, and each reader its own place in them', () => {
    const clock = new SimClock();
    clock.paused = true;
    const p = new Bench(clock).add('pulse') as Pulse;
    p.setFinger(true);
    clock.advance(1000);
    const a = p.samplesSince(-1);
    expect(a.ir).toHaveLength(32); // the rest were lost: nobody read them
    clock.advance(100);
    const b = p.samplesSince(a.last);
    expect(b.ir).toHaveLength(10);
    expect(p.samplesSince(a.last).ir).toEqual(b.ir); // another reader, from the same place, gets the same
  });

  it('gives Lua its samples, beats and finger, and a real board the samples too', async () => {
    const app = `local got = 0
      function on_tick(ctx) got = got + #pulse.samples() end
      function on_event(ctx, e)
        if e.name == "finger" then log.info("finger", tostring(e.data.on)) end
        if e.name == "beat" and not beat then beat = true log.info("beat", e.data.bpm > 60, got > 500) end
      end`;
    const t = await boot(app, [spec('pulse')]);
    expect(t.error).toBeUndefined();
    const p = t.bench.first<Pulse>('pulse')!;
    t.steps(100);
    p.setFinger(true);
    t.steps(9000);
    expect(t.logs).toEqual(['finger\ttrue', 'beat\ttrue\ttrue']);

    const d = await device(`function on_tick(ctx) local s = pulse.samples() if #s > 0 then log.info(#s, s[1]) end end`);
    expect(d.error).toBeUndefined();
    const update = () => DRIVERS.pulse!.mirror!(p) as Record<string, unknown>;
    d.send({ s: { pulse: update() } });
    d.steps(100);
    expect(d.logs).toEqual([expect.stringMatching(/^32\t1\d{5}/)]); // the first: the FIFO's 32
    t.clock.advance(100);
    d.send({ s: { pulse: update() } });
    d.steps(100);
    expect(d.logs[1]).toMatch(/^10\t/); // then only the 10 it hasn't had
    t.clock.advance(250); // an update the relay held up loses none
    d.send({ s: { pulse: update() } });
    d.steps(100);
    expect(d.logs[2]).toMatch(/^25\t/);

    // A finger coming down climbs ~100 000 counts within the FIFO: the steps widen to span it.
    p.setFinger(false);
    t.clock.advance(2000);
    p.setFinger(true);
    t.clock.advance(150);
    const u = update() as { b: number; st: number; w: string };
    const real = p.samplesSince(-1).ir;
    expect(u.st).toBeGreaterThan(4);
    unpack(u.w, u.b, u.st).forEach((v, i) => expect(Math.abs(v - real[i])).toBeLessThanOrEqual(u.st / 2));
  });
});

describe('thermal camera', () => {
  it('sees a near figure warm and a far one barely, where it is, a frame each 100 ms', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load([spec('thermal')]);
    const cam = bench.part('thermal-1') as Thermal;
    const x = new Dial({ min: 0, max: 70, start: 0, via: 'heat-x' }, bench);
    const warm = new Trigger({ via: 'warm' }, bench);
    cam.setBackground(21);
    cam.setFigure({ x: 0.5, y: 0.5, r: 2 });
    clock.advance(100);
    const px = cam.pixels();
    expect(px).toHaveLength(64);
    for (const t of px) expect((t * 4) % 1).toBe(0); // quarter degrees
    expect(Math.max(...px)).toBeGreaterThan(31);
    expect(Math.min(...px)).toBeLessThan(23);
    expect(warm.isPressed()).toBe(true);
    expect(Math.abs(x.value - 35)).toBeLessThanOrEqual(3);
    clock.advance(50);
    expect(cam.pixels()).toBe(px); // the same frame until the next
    cam.setFigure({ x: 0.85, y: 0.5, r: 2 });
    clock.advance(100);
    expect(x.value).toBeGreaterThan(45);
    cam.setFigure({ x: 0.5625, y: 0.5625, r: 0.3 }); // a few metres off, on one pixel
    clock.advance(100);
    const far = Math.max(...cam.pixels());
    expect(far).toBeGreaterThan(24);
    expect(far).toBeLessThan(29);
    cam.setFigure(null);
    clock.advance(100);
    expect(warm.isPressed()).toBe(false);
    expect(x.value).toBeGreaterThan(45); // no one in view: the dial holds
  });

  it('gives Lua its pixels and warm events, and a real board the same pixels', async () => {
    const t = await boot(
      `function init(ctx) local r = thermal.read() log.info(#r.pixels, tostring(r.warm), r.thermistor) end
      function on_event(ctx, e) if e.name == "warm" then log.info("warm", tostring(e.data.warm)) end end`,
      [spec('thermal')],
    );
    expect(t.error).toBeUndefined();
    const cam = t.bench.first<Thermal>('thermal')!;
    cam.setFigure(null);
    t.steps(200);
    expect(t.logs).toEqual(['64\ttrue\t23.5', 'warm\tfalse']);

    const d = await device(`function on_tick(ctx) local r = thermal.read() log.info(#r.pixels, r.pixels[1], r.pixels[64]) end`);
    expect(d.error).toBeUndefined();
    const snap = DRIVERS.thermal!.mirror!(cam) as { p: string };
    expect(snap.p).toHaveLength(128);
    d.send({ s: { thermal: snap } });
    d.steps(100);
    const px = cam.pixels();
    expect(d.logs.at(-1)).toBe(`64\t${px[0].toFixed(2).replace(/0$/, '').replace(/\.$/, '.0')}\t${px[63].toFixed(2).replace(/0$/, '').replace(/\.$/, '.0')}`);
  });
});

describe('I2C on the Wiring view', () => {
  const st7789 = findDevice('generic-st7789-240x240')!;
  const devkitc = findBoard('esp32-devkitc')!;
  const hw = (parts: PartSpec[]) => parts.map((p) => ({ ...p, builtin: false }));

  it('moves a second module to its other address, and says when there is none left', () => {
    const w = wiring(st7789, devkitc, hw([spec('imu', 1), spec('imu', 2), spec('imu', 3)]));
    expect(w.parts.map((p) => p.i2c)).toEqual([{ address: 0x68 }, { address: 0x69, how: 'AD0 to 3V3' }, undefined]);
    expect(w.problems).toEqual([expect.stringMatching(/^imu 3: its I2C addresses \(0x68, 0x69\) are all taken/)]);
  });

  it("keeps clear of the board's own chips on a shared bus", () => {
    const round = findDevice('seeed-xiao-round-display')!;
    const w = wiring(round, findBoard('seeed-xiao-esp32s3-round-display')!, hw([spec('imu')]));
    expect(w.parts[0].i2c).toEqual({ address: 0x68 });
  });
});

// Bugs a review of the parts found, each kept from coming back.
describe('the parts, as a review found them', () => {
  const bench = (...kinds: PartKind[]) => {
    const clock = new SimClock();
    clock.paused = true;
    const b = new Bench(clock);
    b.load(kinds.map((k) => spec(k)));
    return { clock, bench: b };
  };

  it('replays two keys pressed between updates on a real board in order, each with its own code', async () => {
    const { bench: b } = bench('keypad');
    const pad = b.part('keypad-1') as Keypad;
    const any = new Trigger({ via: 'keypad' }, b);
    any.name = 'any';
    const reader = new SnapshotReader();
    const d = await device(`local any = trigger.new("any", { via = "keypad" })
      function on_event(ctx, e) if e.name == "trigger" then log.info(tostring(e.data.pressed), tostring(e.data.code), tostring(any:code())) end end`);
    expect(d.error).toBeUndefined();
    d.send(reader.read([any], b, {})); // the first update is a baseline
    reader.confirm();
    d.steps(20);
    pad.press('1', true);
    pad.press('1', false);
    pad.press('5', true);
    d.send(reader.read([any], b, {}));
    d.steps(20);
    expect(d.logs).toEqual(['true\t1\t5', 'false\tnil\t5', 'true\t5\t5']);
  });

  it('takes turns leaving big readings out, and drops events only when nothing else fits', () => {
    const make = (): Snapshot => ({ d: {}, t: {}, s: { big: 'x'.repeat(600), mid: 'y'.repeat(500) } });
    const a = make();
    shed(a);
    expect(Object.keys(a.s)).toEqual(['mid']);
    const b = make();
    shed(b, new Set(['big'])); // left out of the last update: it goes this time
    expect(Object.keys(b.s)).toEqual(['big']);
    const dials = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`dial${i}`, [100.125, 0.5, 12] as [number, number, number]]));
    const c: Snapshot = { d: dials, t: {}, s: {}, ev: Array.from({ length: 4 }, (_, i) => [i + 1, 'tag', { uid: 'z'.repeat(80) }]) };
    const json = shed(c);
    expect(c.ev).toBeUndefined();
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(1000);
  });

  it("doesn't put back a part taken off the bench while the app reads it", async () => {
    const t = await boot('function on_tick(ctx) local v = light.level() end', [spec('light')]);
    t.steps(50);
    t.bench.remove('light-1');
    t.steps(50);
    expect(t.bench.first('light')).toBeUndefined();
    expect(t.logs.filter((l) => l.startsWith('error'))).toEqual([]);
  });

  it('numbers events across app runs, so a new run never falls under the board’s baseline', async () => {
    const app = 'function on_event(ctx, e) end';
    const one = await boot(app, [spec('switch')]);
    one.steps(10);
    one.bench.first<Switch>('switch')!.set(true);
    one.steps(10);
    const two = await boot(app, [spec('switch')]);
    two.steps(10);
    two.bench.first<Switch>('switch')!.set(true);
    two.steps(10);
    expect(two.host.sensorEvents()[0][0]).toBeGreaterThan(one.host.sensorEvents()[0][0]);
  });

  it('says which codes a trigger can ask for, rather than quietly taking any key', async () => {
    const t = await boot('trigger.new("ok", { via = "ir", code = "OK" })', [spec('ir')]);
    expect(t.error).toContain('code must be one of "any", "up"');
    const u = await boot('trigger.new("five", { code = "5" })');
    expect(u.error).toContain('has none');
  });

  it('raises a switch event for each flip, even on and off between two polls', async () => {
    const t = await boot('function on_event(ctx, e) if e.name == "switch" then log.info(tostring(e.data.on)) end end', [spec('switch')]);
    t.steps(20);
    const sw = t.bench.first<Switch>('switch')!;
    sw.set(true);
    sw.set(false);
    t.steps(20);
    expect(t.logs).toEqual(['true', 'false']);
  });

  it('flips a switch once for a held key, however often the key repeats', () => {
    const { bench: b } = bench('switch');
    const sw = b.part('switch-1') as Switch;
    const flip = new Trigger({ via: 'switch', key: 'KeyS' }, b);
    for (let i = 0; i < 5; i++) flip.handleKey('KeyS', true);
    flip.handleKey('KeyS', false);
    expect(sw.isOn()).toBe(true);
  });

  it('shows the joystick pressed, and keeps its direction along a diagonal', () => {
    const { bench: b } = bench('joystick');
    const j = b.part('joystick-1') as Joystick;
    let changes = 0;
    j.subscribe(() => changes++);
    j.button.setDown(true);
    expect(changes).toBe(1);
    j.set(0.7, 0.69);
    const dir = j.direction();
    expect(dir).toBe('right');
    j.set(0.69, 0.7);
    expect(j.direction(dir)).toBe('right');
    j.set(0.2, 0.9);
    expect(j.direction(dir)).toBe('up');
  });

  it('sees someone filling the thermal view as warm, and a small figure the same wherever it falls', () => {
    const { clock, bench: b } = bench('thermal');
    const cam = b.part('thermal-1') as Thermal;
    cam.setFigure({ x: 0.5, y: 0.5, r: 4 });
    for (let i = 0; i < 20; i++) {
      clock.advance(100);
      expect(cam.hotspot().warm).toBe(true);
    }
    // The heat a small far figure adds over the view, averaged over frames: between four pixels or on one.
    const heat = (x: number) => {
      cam.setFigure({ x, y: x, r: 0.4 });
      let sum = 0;
      for (let i = 0; i < 20; i++) {
        clock.advance(100);
        sum += cam.pixels().reduce((s, v) => s + v - 22, 0);
      }
      return sum / 20;
    };
    const between = heat(0.5);
    const on = heat(0.5625);
    expect(between).toBeGreaterThan(3);
    expect(Math.abs(between - on)).toBeLessThan(1);
  });

  it("doesn't chatter near or far with a hand held at 30 cm", () => {
    const { clock, bench: b } = bench('tof');
    const tof = b.part('tof-1') as Tof;
    tof.setTarget(280);
    clock.advance(50);
    expect(tof.near()).toBe(true);
    tof.setTarget(300);
    for (let i = 0; i < 100; i++) {
      clock.advance(50);
      expect(tof.near()).toBe(true);
    }
    tof.setTarget(330);
    clock.advance(50);
    expect(tof.near()).toBe(false);
  });

  it('gives a pulse rate that follows the heart within a few beats, and starts over after a long gap', () => {
    const { clock, bench: b } = bench('pulse');
    const p = b.part('pulse-1') as Pulse;
    const fingertip = new Trigger({ via: 'heartbeat', key: 'KeyH' }, b);
    fingertip.handleKey('KeyH', true); // a key on the heartbeat trigger rests a finger on it
    expect(p.finger).toBe(true);
    p.setBpm(60);
    clock.advance(10_000);
    expect(p.read().bpm).toBeCloseTo(60, -1);
    p.setBpm(120);
    clock.advance(3000);
    expect(p.read().bpm).toBeGreaterThan(105);
    clock.advance(60_000); // a hidden tab
    const bpm = p.read().bpm;
    expect(bpm === null || (bpm > 105 && bpm < 135)).toBe(true);
    expect(fingertip.code()).toBeNull(); // a beat is a plain press
  });

  it('nudges a CO₂ dial from where the room is set, not from a breath it measured', () => {
    const { clock, bench: b } = bench('co2');
    const co2 = b.part('co2-1') as Co2;
    const ppm = new Dial({ min: 400, max: 2000, step: 100, via: 'co2' }, b);
    co2.setRoom(650);
    co2.breathe();
    clock.advance(5000);
    expect(co2.read()!.co2).toBeGreaterThan(2500);
    ppm.handleKey('ArrowLeft', true);
    expect(co2.roomPpm).toBeCloseTo(550);
    co2.setRoom(4500);
    co2.breathe();
    clock.advance(5000);
    expect(co2.read()!.co2).toBeGreaterThan(5000); // it reads on past its specified range
  });

  it("gives a real board's thermal app 64 pixels before Bench's first frame, its own copy each read", async () => {
    const d = await device(`function init(ctx)
      local a = thermal.pixels() log.info(#a, a[1])
      a[1] = 99 log.info(thermal.pixels()[1]) end`);
    expect(d.error).toBeUndefined();
    expect(d.logs).toEqual(['64\t22', '22']);
  });
});
