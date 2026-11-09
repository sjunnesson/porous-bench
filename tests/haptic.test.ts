// The SmartKnob View: its knob (a motor making the detents an app asks for, modelled from the
// SmartKnob's motor_task.cpp), its press as button A, its LEDs beside the screen through `leds`.

import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { hapticConfig } from '../src/resident/drivers';
import { ResidentHost, resetScreen, type ResidentBoard } from '../src/resident/host';
import { appNeeds, misfits, outputCaps } from '../src/resident/needs';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { boardsFor } from '../src/sim/boards';
import { SimClock } from '../src/sim/clock';
import { boardBench, BUILT_IN_ONLY, DEFAULT_PARTS } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Haptic } from '../src/sim/inputs/haptic';
import type { LedRing } from '../src/sim/inputs/ledring';

const factory = new LuaFactory();

function knob() {
  const clock = new SimClock();
  clock.paused = true;
  return { clock, h: new Haptic({}, clock) };
}

/** Let go and wait: the motor takes it where it pulls. */
function settle(h: Haptic, clock: SimClock, ms = 1000) {
  h.release();
  for (let t = 0; t < ms; t += 10) {
    clock.advance(10);
    h.advance();
  }
}

describe('the haptic knob', () => {
  it('turns like an encoder until an app configures it: 20 detents a turn, no ends', () => {
    const { clock, h } = knob();
    h.turnBy(20); // past 1.1 of an 18° detent
    expect(h.position()).toBe(1);
    settle(h, clock);
    expect(h.angle()).toBeCloseTo(18, 1);
    h.turnBy(-400);
    expect(h.position()).toBeLessThan(-20); // no ends
    expect(h.clicks).toBe(h.position());
  });

  it('stops at its ends, gives less the further it is turned past one, and springs back', () => {
    const { clock, h } = knob();
    h.configure({ min: 0, max: 2, width: 10, detent: 1, endstop: 1 });
    h.turnBy(60);
    expect(h.position()).toBe(2);
    expect(h.outOfBounds()).toBe(true);
    expect(h.angle()).toBeLessThanOrEqual(23); // the hand is at 60°: the end holds it near 20°
    settle(h, clock);
    expect(h.angle()).toBeCloseTo(20, 1);
    expect(h.outOfBounds()).toBe(false);
  });

  it('flips half way as a switch when the snap point is below 1', () => {
    const { clock, h } = knob();
    h.configure({ min: 0, max: 1, width: 60, detent: 1, snap: 0.55 });
    h.turnBy(32);
    expect(h.position()).toBe(0);
    h.turnBy(2);
    expect(h.position()).toBe(1);
    expect(h.sub()).toBeCloseTo(-26 / 60, 3);
    settle(h, clock);
    expect(h.angle()).toBeCloseTo(60, 1);
  });

  it('pulls to magnetic detents only, and stays where it is let go between them', () => {
    const { clock, h } = knob();
    h.configure({ min: 0, max: 31, width: 7, detent: 2.5, snap: 0.7, magnets: [2, 10] });
    h.turnBy(7 * 5 + 1);
    expect(h.position()).toBe(5);
    h.release();
    expect(h.settling()).toBe(false);
    const at = h.angle();
    settle(h, clock);
    expect(h.angle()).toBe(at);
    h.turnBy(7 * 5);
    expect(h.position()).toBe(10);
    settle(h, clock);
    expect(h.angle()).toBeCloseTo(70, 1);
  });

  it('sets a position when it differs from the last config, or when the nonce does', () => {
    const { h } = knob();
    h.configure({ min: 0, max: 10, width: 10, position: 5 });
    expect(h.position()).toBe(5);
    h.turn(1);
    expect(h.position()).toBe(6);
    h.configure({ min: 0, max: 10, width: 10, position: 5 });
    expect(h.position()).toBe(6);
    h.configure({ min: 0, max: 10, width: 10, position: 5, nonce: 1 });
    expect(h.position()).toBe(5);
    h.configure({ min: 0, max: 3, width: 10, position: 5, nonce: 2 });
    expect(h.position()).toBe(3); // inside the ends
  });

  it('bumps into an end from the keyboard and springs back', () => {
    const { clock, h } = knob();
    h.configure({ min: 0, max: 0, width: 60, detent: 0.01, endstop: 0.6 });
    h.turn(1);
    expect(h.position()).toBe(0);
    expect(h.outOfBounds()).toBe(true);
    settle(h, clock);
    expect(h.angle()).toBeCloseTo(0, 1);
  });

  it('checks a config as the SmartKnob firmware does, and says what is wrong', () => {
    expect(hapticConfig({ min: 0, max: 10, width: 10, detent: 2.5, magnets: [2, 10] })).toEqual({ min: 0, max: 10, width: 10, detent: 2.5, magnets: [2, 10] });
    expect(hapticConfig({ magnets: {} })).toEqual({ magnets: [] }); // an empty Lua table
    expect(hapticConfig(undefined)).toEqual({});
    expect(hapticConfig({ detent: -1 })).toMatch(/detent cannot be negative/);
    expect(hapticConfig({ magnets: [1, 2, 3, 4, 5, 6] })).toMatch(/at most 5 magnets/);
    expect(hapticConfig({ colour: 1 })).toMatch(/no option 'colour'/);
    expect(hapticConfig({ min: 1.5 })).toMatch(/min must be a whole number/);
    expect(hapticConfig({ width: 0 })).toMatch(/width/);
    expect(hapticConfig({ snap: 0.3 })).toMatch(/snap below 0.5/);
    expect(hapticConfig({ text: 'x'.repeat(51) })).toMatch(/at most 50/);
  });
});

async function boot(code: string, deviceId = 'smartknob-view') {
  const clock = new SimClock();
  clock.paused = true;
  const device = findDevice(deviceId)!;
  const display = new Display(device, clock);
  const bench = boardBench(device, clock, DEFAULT_PARTS, boardsFor(device)[0].id);
  const logs: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons: [new Trigger({ builtin: 0 }, bench), new Trigger({ builtin: 1 }, bench)],
    ring: bench.first<LedRing>('leds'),
    store: new AppStore('test', false),
    dial: (_name, opts) => new Dial(opts, bench),
    trigger: (_name, opts) => new Trigger(opts, bench),
    sensor: (kind) => (BUILT_IN_ONLY.has(kind) ? bench.first(kind) : bench.ensure(kind).part),
    present: (kind) => bench.first(kind),
    log: (level, text) => logs.push(`${level}: ${text}`),
    telemetry: () => {},
    publish: () => 'sent',
  };
  void resetScreen(display);
  for (let i = 0; i < 200; i++) {
    clock.advance(1);
    await Promise.resolve();
  }
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  const run = async (ms: number) => {
    for (let t = 0; t < ms; t += 5) {
      clock.advance(5);
      host.step();
      await host.settle();
    }
  };
  return { host, error, logs, bench, run, knob: bench.first<Haptic>('haptic') };
}

describe('the SmartKnob View', () => {
  it('lets an app set the feel and hear each move, and lights its LEDs', async () => {
    const t = await boot(`
      function init(ctx)
        haptic.config({ min = 0, max = 3, width = 10, text = "Volume" })
        leds.set(0, 0xFF0000) leds.set(7, 0x0000FF) leds.show()
        log.info(leds.count() .. " " .. haptic.read().text)
      end
      function on_event(ctx, e)
        if e.name == "haptic" then log.info("haptic " .. e.data.position .. " " .. e.data.delta) end
      end`);
    expect(t.error).toBeFalsy();
    await t.run(50);
    t.knob!.turnBy(12);
    await t.run(50);
    t.knob!.turnBy(80); // to the end: three on in one
    await t.run(50);
    expect(t.logs).toEqual(['info: 8 Volume', 'info: haptic 1 1', 'info: haptic 3 2']);
    const ring = t.bench.first<LedRing>('leds')!;
    expect(ring.colours()[0]).toBe(0xff0000);
    expect(ring.colours()[7]).toBe(0x0000ff);
  });

  it('takes a press on the knob as button A, with a click', async () => {
    const t = await boot(`function on_event(ctx, e) if e.name == "tap" then log.info("tap " .. e.data.index) end end`);
    await t.run(20);
    const played = t.knob!.played;
    t.knob!.press.setDown(true);
    await t.run(60);
    t.knob!.press.setDown(false);
    await t.run(60);
    expect(t.logs).toContain('info: tap 0');
    expect(t.knob!.played).toBe(played + 1);
  });

  it('rejects a config with what is wrong, at the app line', async () => {
    const t = await boot(`function init(ctx)\n  haptic.config({ magnets = { 1, 2, 3, 4, 5, 6 } })\nend`);
    expect(t.error).toMatch(/app:2: haptic.config: at most 5 magnets/);
  });

  it("turns an app's encoder dial, before an encoder on the desk", async () => {
    const t = await boot(`local d = dial.new("level", { min = 0, max = 10, start = 5 })
      function on_tick(ctx) log.info("level " .. d:value()) end`);
    t.knob!.turnBy(20);
    await t.run(150);
    expect(t.logs.at(-1)).toBe('info: level 6');
  });

  it('has no knob on another board, so an app that turns it is listed only for the SmartKnob', async () => {
    const t = await boot('function init(ctx) haptic.config({ max = 3 }) end', 'guition-esp32-s3-4848s040');
    expect(t.error).toMatch(/haptic: this board has no haptic knob/);
    const code = 'function init(ctx) haptic.config({ max = 3 }) end';
    const caps = (id: string) => {
      const d = findDevice(id)!;
      return outputCaps(d, boardsFor(d)[0]);
    };
    expect(misfits(appNeeds(code), caps('guition-esp32-s3-4848s040'))).toEqual(['needs a haptic knob']);
    expect(misfits(appNeeds(code), caps('smartknob-view'))).toEqual([]);
    // Its LEDs: `leds` beside a display, on that display only.
    const ring = 'function init(ctx) leds.set(0, 0xFFFFFF) leds.show() end';
    expect(misfits(appNeeds(ring), caps('smartknob-view'))).toEqual([]);
    expect(misfits(appNeeds(ring), caps('guition-esp32-s3-4848s040'))).toEqual(['needs leds']);
  });
});
