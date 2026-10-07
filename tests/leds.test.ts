import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ResidentHost, type ResidentBoard } from '../src/resident/host';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { findDevice } from '../src/sim/devices';
import type { DeviceProfile } from '../src/sim/devices/types';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';
import { ledProfile } from '../src/sim/leds';

const factory = new LuaFactory();

async function boot(code: string, profile: DeviceProfile) {
  const clock = new SimClock();
  clock.paused = true;
  const display = new Display(profile, clock);
  const logs: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons: [new Button({}, clock), new Button({}, clock)],
    store: new AppStore('leds-test', false),
    log: (level, text) => logs.push(level === 'info' ? text : `${level}: ${text}`),
    telemetry: () => {},
    publish: () => 'sent',
  };
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  return { host, error, clock, display, logs };
}

async function run(t: { host: ResidentHost; clock: SimClock }, ms: number) {
  for (let i = 0; i < ms; i += 5) {
    t.clock.advance(5);
    t.host.step();
    let done = false;
    void t.host.settle().then(() => (done = true));
    for (let k = 0; k < 200 && !done; k++) {
      t.clock.advance(1);
      await Promise.resolve();
    }
  }
}

/** What LED i is emitting, as [r, g, b]. */
function led(d: Display, i: number): number[] {
  const out = new Uint8ClampedArray(d.profile.width * d.profile.height * 4);
  d.panel.render(Infinity, out);
  return [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]];
}

describe('LED outputs', () => {
  it('describes strips, rings and matrices as led profiles', () => {
    const strip = ledProfile({ kind: 'strip', count: 30 });
    expect([strip.tech, strip.width, strip.height, strip.bus.kind]).toEqual(['led', 30, 1, 'ws2812']);
    expect(ledProfile({ kind: 'ring', count: 16 }).look.leds?.layout).toBe('ring');
    const m = ledProfile({ kind: 'matrix', w: 32, h: 8 });
    expect([m.width, m.height, m.look.leds?.layout]).toEqual([32, 8, 'grid']);
  });

  it('sends the whole chain at 800 kHz on every show', async () => {
    const clock = new SimClock();
    clock.paused = true;
    const d = new Display(ledProfile({ kind: 'strip', count: 60 }), clock);
    d.drawPixel(3, 0, 0xffff);
    const shown = d.show();
    clock.advance(10);
    await shown;
    expect(d.stats.bytes).toBe(60 * 3);
    expect(d.stats.busMs).toBeCloseTo((60 * 24) / 800 + 0.3, 3); // 1.8 ms + the latch
  });

  it('lights LEDs from Lua only on show(), with fill, set_rgb, xy and brightness', async () => {
    const t = await boot(`function init()
        log.info(leds.count(), leds.width(), leds.height(), leds.xy(1, 2))
        leds.fill(0x0000FF)
        leds.set_rgb(2, 255, 0, 0)
        leds.show()
        log.info(string.format("%06X", leds.get(2)))
      end`, ledProfile({ kind: 'matrix', w: 8, h: 8 }));
    expect(t.error).toBeUndefined();
    expect(t.logs[0]).toBe('64\t8\t8\t17');
    expect(t.logs[1]).toBe('FF0000');
    await run(t, 20);
    expect(led(t.display, 2)).toEqual([255, 0, 0]);
    expect(led(t.display, 5)[2]).toBe(255);
  });

  it('runs on_frame on its own timer, far more often than on_tick', async () => {
    const t = await boot(`local frames, ticks = 0, 0
      leds.on_frame(function(ctx, dt) frames = frames + 1 leds.set(frames % leds.count(), leds.hsv(frames * 10, 1, 1)) leds.show() end, 50)
      function on_tick() ticks = ticks + 1 if ticks == 5 then log.info(frames, ticks) end end`, ledProfile({ kind: 'ring', count: 12 }));
    expect(t.error).toBeUndefined();
    await run(t, 520);
    const [frames, ticks] = t.logs[0].split('\t').map(Number);
    expect(ticks).toBe(5);
    expect(frames).toBeGreaterThanOrEqual(20); // ~50 fps vs 10 Hz
  });

  it('explains when the output is a display, not an LED chain', async () => {
    const t = await boot('function init() leds.show() end', findDevice('m5stickc-plus2')!);
    expect(t.error).toMatch(/no LED chain/);
  });
});
