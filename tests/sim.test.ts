import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/sim/clock';
import { colors, color565 } from '../src/sim/color';
import { findDevice } from '../src/sim/devices';
import type { DeviceProfile } from '../src/sim/devices/types';
import { Display } from '../src/sim/display';
import { font5x7 } from '../src/sim/fonts/font';
import { encodeReport, LD2410, LD2410Parser } from '../src/sim/inputs/ld2410';
import { canvasToNative, sceneSize } from '../src/sim/renderer';
import { SketchRun } from '../src/sim/runner';
import { defineSketch } from '../src/sim/sketch';

const device = (id: string): DeviceProfile => {
  const d = findDevice(id);
  if (!d) throw new Error(`no device ${id}`);
  return d;
};

/** A paused clock: time only moves when the test advances it. */
function pausedClock() {
  const clock = new SimClock();
  clock.paused = true;
  return clock;
}

async function settle(clock: SimClock, p: Promise<unknown>, stepMs = 1, maxMs = 10_000) {
  let done = false;
  p.then(() => (done = true));
  for (let t = 0; t < maxMs && !done; t += stepMs) {
    clock.advance(stepMs);
    await Promise.resolve();
    await Promise.resolve();
  }
  await p;
}

function pixel(d: Display, x: number, y: number, now = Infinity): [number, number, number] {
  const out = new Uint8ClampedArray(d.profile.width * d.profile.height * 4);
  d.panel.render(now, out);
  const i = (y * d.profile.width + x) * 4;
  return [out[i], out[i + 1], out[i + 2]];
}

describe('device catalog', () => {
  it('loads every profile with sane geometry', () => {
    const lcd = device('waveshare-esp32-c6-lcd-1.47');
    expect(lcd.width).toBe(172);
    expect(lcd.height).toBe(320);
    expect(lcd.ram?.offsetX).toBe(34);
    expect(device('ssd1306-128x64').tech).toBe('oled');
    // As measured on the driver board (firmware/epd213).
    expect(device('waveshare-epd-2.13-v4').epaper).toMatchObject({ fullRefreshMs: 1900, partialRefreshMs: 200 });
  });
});

describe('font', () => {
  it('has 5x7 glyphs for printable ASCII', () => {
    const a = font5x7.glyph('A');
    expect(a.w).toBe(5);
    // 'A' = 7E 11 11 11 7E: top row has ink in the middle three columns only
    expect(Array.from(a.bits.slice(0, 5))).toEqual([0, 1, 1, 1, 0]);
    expect(font5x7.glyph('ÿ')).toEqual(font5x7.glyph('?'));
  });
});

describe('Gfx', () => {
  it('maps rotations onto the native buffer', () => {
    const d = new Display(device('waveshare-esp32-c6-lcd-1.47'), pausedClock());
    d.fillScreen(colors.BLACK);
    d.setRotation(1);
    expect([d.width(), d.height()]).toEqual([320, 172]);
    d.drawPixel(0, 0, colors.RED);
    // Rotation 1: logical (0,0) is the native top-right corner.
    d.setRotation(0);
    expect(d.getPixel(171, 0)).toBe(colors.RED);
    expect(d.getPixel(0, 0)).toBe(colors.BLACK);
  });

  it('clips and tracks the dirty region', () => {
    const d = new Display(device('waveshare-esp32-c6-lcd-1.47'), pausedClock());
    (d as unknown as { fb: { takeDirty(): unknown } }).fb.takeDirty();
    d.fillRect(-10, -10, 15, 12, colors.WHITE);
    const dirty = (d as unknown as { fb: { takeDirty(): unknown } }).fb.takeDirty();
    expect(dirty).toEqual({ x: 0, y: 0, w: 5, h: 2 });
  });

  it('thresholds colours on 1-bit panels', () => {
    const d = new Display(device('ssd1306-128x64'), pausedClock());
    d.drawPixel(0, 0, colors.YELLOW);
    d.drawPixel(1, 0, colors.NAVY);
    expect(d.getPixel(0, 0)).toBe(colors.WHITE);
    expect(d.getPixel(1, 0)).toBe(colors.BLACK);
  });
});

describe('Display.show timing', () => {
  it('takes as long as the SPI transfer of the changed region', async () => {
    const clock = pausedClock();
    const d = new Display(device('waveshare-esp32-c6-lcd-1.47'), clock);
    const t0 = clock.now();
    await settle(clock, d.show(), 0.5);
    // 172*320*2 bytes + 11 command bytes at 80 MHz ≈ 11.0 ms
    expect(clock.now() - t0).toBeGreaterThanOrEqual(11);
    expect(clock.now() - t0).toBeLessThan(12);
    d.fillRect(0, 0, 10, 10, colors.RED);
    const t1 = clock.now();
    await settle(clock, d.show(), 0.01);
    expect(clock.now() - t1).toBeLessThan(0.1);
  });

  it('caps a 400 kHz I2C OLED at ~40 fps', async () => {
    const clock = pausedClock();
    const d = new Display(device('ssd1306-128x64'), clock);
    const t0 = clock.now();
    await settle(clock, d.show(), 0.5);
    expect(clock.now() - t0).toBeGreaterThan(22);
    expect(clock.now() - t0).toBeLessThan(26);
  });

  it('lights the panel with backlight-scaled colour', async () => {
    const clock = pausedClock();
    const d = new Display(device('waveshare-esp32-c6-lcd-1.47'), clock);
    d.fillScreen(color565(255, 0, 0));
    await settle(clock, d.show());
    expect(pixel(d, 50, 50)[0]).toBeGreaterThan(250);
    d.setBrightness(50);
    expect(pixel(d, 50, 50)[0]).toBeLessThan(135);
  });
});

describe('touch panel', () => {
  it('maps a point on the drawn glass to native pixels, and then to app coordinates', () => {
    const amoled = device('waveshare-esp32-s3-touch-amoled-1.32');
    const view = { zoom: 1, grid: false, rotation: 0 };
    const { w } = sceneSize(amoled, view);
    expect(canvasToNative(amoled, view, w / 2, w / 2)).toEqual([233, 233]); // the centre
    expect(canvasToNative(amoled, view, 15, 15)).toBeNull(); // a corner: off the round glass
    const lcd = device('waveshare-esp32-c6-lcd-1.47');
    const turned = { zoom: 2, grid: false, rotation: 1 };
    // Mounted a quarter turn clockwise: the panel's top-left corner sits at the top right.
    const s = sceneSize(lcd, turned);
    expect(canvasToNative(lcd, turned, s.w - 14 - 1, 14 + 1)).toEqual([0, 0]);
    const d = new Display(lcd, pausedClock());
    d.setRotation(1);
    expect(d.fromNative(0, 0)).toEqual([0, 171]);
    expect(d.fromNative(171, 319)).toEqual([319, 0]);
  });

  it('logs every press, move and release in order, on displays that have one', () => {
    const clock = pausedClock();
    expect(new Display(device('m5stickc-plus2'), clock).touch).toBeNull();
    const t = new Display(device('waveshare-esp32-s3-touch-amoled-1.32'), clock).touch!;
    t.press(10, 20);
    t.move(10, 20); // not a move: nothing changed
    t.move(15, 25);
    t.release();
    t.release();
    expect(t.log.map((e) => [e.kind, e.x, e.y])).toEqual([['down', 10, 20], ['move', 15, 25], ['up', 15, 25]]);
    expect(t.isPressed()).toBe(false);
  });
});

describe('AMOLED', () => {
  it('sends a full frame over QSPI four bits a clock, and black is off', async () => {
    const clock = pausedClock();
    const d = new Display(device('waveshare-esp32-s3-touch-amoled-1.32'), clock);
    expect(d.isColor()).toBe(true);
    d.fillScreen(colors.BLACK);
    d.fillRect(200, 200, 10, 10, color565(255, 255, 255));
    d.invalidate();
    const t0 = clock.now();
    await settle(clock, d.show(), 0.1);
    // 466 × 466 × 2 bytes + 11 command bytes, 4 bits a clock at 40 MHz ≈ 21.7 ms.
    expect(clock.now() - t0).toBeGreaterThan(21);
    expect(clock.now() - t0).toBeLessThan(23);
    expect(pixel(d, 5, 5)).toEqual([0, 0, 0]); // an off pixel gives no light at all
    expect(pixel(d, 205, 205)[0]).toBeGreaterThan(250);
  });
});

describe('e-paper', () => {
  it('shows nothing until refreshed, does full then partial refreshes, and ghosts', async () => {
    const clock = pausedClock();
    const d = new Display(device('waveshare-epd-2.13-v4'), clock);
    const paperR = pixel(d, 5, 5)[0];
    d.fillScreen(colors.WHITE);
    d.fillRect(0, 0, 20, 20, colors.BLACK);
    expect(pixel(d, 5, 5)[0]).toBe(paperR); // RAM written by nobody yet: still paper

    let t0 = clock.now();
    await settle(clock, d.show(), 5);
    expect(clock.now() - t0).toBeGreaterThanOrEqual(1900); // first show is a full refresh
    expect(d.stats.fullRefreshes).toBe(1);
    const inkR = pixel(d, 5, 5)[0];
    expect(inkR).toBeLessThan(60);

    d.fillRect(0, 0, 20, 20, colors.WHITE);
    t0 = clock.now();
    await settle(clock, d.show(), 5);
    expect(clock.now() - t0).toBeLessThan(300); // partial
    const ghost = pixel(d, 5, 5)[0];
    expect(ghost).toBeLessThan(paperR); // a trace of the old black square remains
    expect(ghost).toBeGreaterThan(paperR - 30);

    await settle(clock, d.show('full'), 5);
    expect(pixel(d, 5, 5)[0]).toBe(paperR);
  });

  it('refreshes one frame at a time, as the firmware does: the newest waiting frame wins', async () => {
    const clock = pausedClock();
    const d = new Display(device('waveshare-epd-2.13-v4'), clock);
    d.fillScreen(colors.WHITE);
    const first = d.show(); // the first refresh (full, 1.9 s) starts now
    expect(d.refreshing()).toBe(true);
    // Three more frames while the panel is BUSY: only the last one should reach the glass.
    for (const x of [0, 30, 60]) {
      d.fillScreen(colors.WHITE);
      d.fillRect(x, 0, 20, 20, colors.BLACK);
      void d.show();
    }
    expect(d.hasPendingChanges()).toBe(true);
    await settle(clock, first, 5);
    await settle(clock, d.show(), 5); // nothing new: resolves once the waiting frame is on the glass
    expect(d.refreshing()).toBe(false);
    expect(d.stats.shows).toBe(2); // the first frame and the newest, nothing in between
    const ink = pixel(d, 65, 5)[0];
    expect(ink).toBeLessThan(80);
    expect(pixel(d, 5, 5)[0]).toBeGreaterThan(150); // the frame drawn at x = 0 never showed

    // The same frame again isn't refreshed again; only real refreshes count towards the full one.
    d.fillScreen(colors.WHITE);
    d.fillRect(60, 0, 20, 20, colors.BLACK);
    await settle(clock, d.show(), 5);
    expect(d.stats.shows).toBe(2);
  });
});

describe('LD2410', () => {
  const report = { state: 3, movingDistance: 245, movingEnergy: 71, stationaryDistance: 250, stationaryEnergy: 64, detectionDistance: 250 };

  it('encodes the 23-byte basic report frame', () => {
    const f = encodeReport(report);
    expect(f.length).toBe(23);
    expect(Array.from(f.slice(0, 8))).toEqual([0xf4, 0xf3, 0xf2, 0xf1, 0x0d, 0x00, 0x02, 0xaa]);
    expect(Array.from(f.slice(-4))).toEqual([0xf8, 0xf7, 0xf6, 0xf5]);
  });

  it('parses frames byte by byte and resyncs after garbage', () => {
    const p = new LD2410Parser();
    const bytes = [0x00, 0xf4, 0x12, ...encodeReport(report), 0xff, ...encodeReport({ ...report, state: 0 })];
    const out = bytes.map((b) => p.push(b)).filter(Boolean);
    expect(out).toEqual([report, { ...report, state: 0 }]);
  });

  it('walks to a clicked spot at walking pace, and the radar sees it moving', () => {
    const clock = pausedClock();
    const radar = new LD2410({ mode: 'manual' }, clock);
    radar.movePerson(0, 1);
    radar.walkTo(0, 4);
    for (let i = 0; i < 10; i++) {
      clock.advance(100);
      radar.target();
    }
    expect(radar.target().y).toBeCloseTo(2.2, 1); // 1.2 m/s for 1 s
    radar.read();
    expect(radar.movingTargetDetected()).toBe(true);
    for (let i = 0; i < 30; i++) {
      clock.advance(100);
      radar.target();
    }
    expect(radar.target().y).toBeCloseTo(4, 5);
    expect(radar.walkGoal()).toBeNull(); // arrived
  });

  it('streams ~10 frames/s and holds presence after the target leaves', () => {
    const clock = pausedClock();
    const radar = new LD2410({ mode: 'manual', holdMs: 5000 }, clock);
    radar.movePerson(0, 2);
    clock.advance(1000);
    const pending = radar.available(); // one 23-byte frame every 100 ms
    expect(pending % 23).toBe(0);
    expect(pending / 23).toBeGreaterThanOrEqual(10);
    expect(pending / 23).toBeLessThanOrEqual(11);
    expect(radar.read()).toBe(true);
    expect(radar.stationaryTargetDetected()).toBe(true);
    expect(radar.detectionDistance()).toBeGreaterThan(180);
    expect(radar.detectionDistance()).toBeLessThan(220);

    radar.setMode('empty');
    clock.advance(1000);
    radar.read();
    expect(radar.presenceDetected()).toBe(true); // held
    clock.advance(5000);
    radar.read();
    expect(radar.presenceDetected()).toBe(false);
  });
});

describe('SketchRun', () => {
  it('runs setup and loop, and reports errors', async () => {
    const clock = pausedClock();
    clock.paused = false;
    const calls: string[] = [];
    let loops = 0;
    const sketch = defineSketch({
      name: 'test',
      setup: () => void calls.push('setup'),
      loop: async ({ delay }) => {
        loops++;
        if (loops === 3) throw new Error('boom');
        await delay(1);
      },
    });
    const errors: unknown[] = [];
    const run = new SketchRun(sketch, device('ssd1306-128x64'), clock, { onError: (e) => errors.push(e) });
    await run.start();
    expect(calls).toEqual(['setup']);
    expect(loops).toBe(3);
    expect(String(errors[0])).toContain('boom');
  });

  it('runs loop() on each Step while paused, and holds it otherwise', async () => {
    const clock = pausedClock();
    let delaying = 0;
    let spinning = 0;
    const flush = async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const runs = [
      new SketchRun(defineSketch({ name: 'delays', loop: async ({ delay }) => void (delaying++, await delay(5)) }), device('ssd1306-128x64'), clock),
      new SketchRun(defineSketch({ name: 'spins', loop: () => void spinning++ }), device('ssd1306-128x64'), clock),
    ];
    runs.forEach((r) => void r.start());
    await flush();
    // Boot: the first frame over I2C outlasts a Step. Paused, setup() is not followed by loop().
    clock.advance(100);
    await flush();
    expect([delaying, spinning]).toEqual([0, 0]);
    clock.advance(1000 / 60);
    await flush();
    expect(delaying).toBeGreaterThan(0);
    expect(spinning).toBe(1);
    const before = [delaying, spinning];
    await flush();
    expect([delaying, spinning]).toEqual(before);
    clock.advance(1000 / 60);
    await flush();
    expect(delaying).toBeGreaterThan(before[0]);
    expect(spinning).toBe(2);
    runs.forEach((r) => r.stop());
  });
});
