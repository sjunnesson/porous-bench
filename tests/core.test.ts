// Bench's core as a review found it: each test keeps one of the bugs it found from coming back. The
// display's bus and e-paper, the Resident runtime as the board's Sandbox runs it, the controls and the
// wiring, the mirror and the minifier, and drawing.

import { LuaFactory } from 'wasmoon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResidentHost, resetScreen, type ResidentBoard } from '../src/resident/host';
import { minifyLua } from '../src/resident/minify';
import { RemoteMirror, SnapshotReader } from '../src/resident/remote';
import { AppStore } from '../src/resident/store';
import { wallSeconds } from '../src/resident/timecore';
import { Zone } from '../src/resident/zone';
import { findBoard } from '../src/sim/boards';
import { SimClock } from '../src/sim/clock';
import { colors } from '../src/sim/color';
import { Bench, boardBench, type PartKind, type PartSpec } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';
import type { Knob } from '../src/sim/inputs/knob';
import { ledProfile } from '../src/sim/leds';
import { wiring } from '../src/sim/wiring';

const factory = new LuaFactory();
const spec = (kind: PartKind, n = 1): PartSpec => ({ id: `${kind}-${n}`, kind, label: `${kind} ${n}` });

function pausedClock() {
  const clock = new SimClock();
  clock.paused = true;
  return clock;
}

/** Wait out a promise on a paused clock, a millisecond at a time. */
async function settle(clock: SimClock, p: Promise<unknown>, maxMs = 10_000) {
  let done = false;
  void p.then(() => (done = true));
  for (let t = 0; t < maxMs && !done; t++) {
    clock.advance(1);
    await Promise.resolve();
    await Promise.resolve();
  }
  await p;
}

function glass(d: Display, x: number, y: number): [number, number, number] {
  const out = new Uint8ClampedArray(d.profile.width * d.profile.height * 4);
  d.panel.render(Infinity, out);
  const i = (y * d.profile.width + x) * 4;
  return [out[i], out[i + 1], out[i + 2]];
}

/** An app on Bench, its logs, what it sent, and a few passes of its loop. */
async function boot(code: string, deviceId = 'waveshare-esp32-s3-touch-lcd-2', zone = 'Europe/London') {
  const clock = pausedClock();
  const device = deviceId.startsWith('ws2812') ? ledProfile({ kind: 'strip', count: 30 }) : findDevice(deviceId)!;
  const display = new Display(device, clock);
  const logs: string[] = [];
  const sent: string[] = [];
  const bench = new Bench(clock);
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone(zone),
    buttons: [new Button({}, clock), new Button({}, clock)],
    store: new AppStore('core-test', false),
    dial: (_name, opts) => new Dial(opts, bench),
    trigger: (_name, opts) => new Trigger(opts, bench),
    sensor: (kind) => bench.ensure(kind).part,
    log: (level, text) => logs.push(level === 'info' ? text : `${level}: ${text}`),
    telemetry: () => {},
    publish: (name, json) => (sent.push(`${name} ${json}`), 'sent'),
  };
  const r = await ResidentHost.boot(factory, board, { code });
  const steps = (ms: number) => {
    for (let i = 0; i < ms; i += 5) {
      clock.advance(5);
      r.host.step();
    }
  };
  return { ...r, logs, sent, steps, clock, display };
}

describe('the display', () => {
  it('sends two flips in one pass one after the other: the first reaches the glass, and both take their time', async () => {
    const clock = pausedClock();
    const d = new Display(findDevice('waveshare-esp32-c6-lcd-1.47')!, clock);
    const t0 = clock.now();
    d.fillScreen(colors.RED);
    const first = d.show();
    d.fillScreen(colors.BLUE);
    const second = d.show();
    expect(glass(d, 5, 5)[0]).toBeGreaterThan(200); // red, while the bus sends it
    await settle(clock, Promise.all([first, second]));
    expect(glass(d, 5, 5)[2]).toBeGreaterThan(200); // then blue
    expect(clock.now() - t0).toBeGreaterThanOrEqual(2 * 30.6); // two pushes of the measured 30.6 ms
  });

  it("doesn't refresh e-paper for an unchanged frame, even when a full refresh is due", async () => {
    const clock = pausedClock();
    const d = new Display(findDevice('waveshare-epd-2.13-v4')!, clock);
    for (let i = 0; i <= 11; i++) {
      d.fillRect(0, 0, 8, 8, i % 2 ? colors.BLACK : colors.WHITE);
      await settle(clock, d.show(), 20_000);
    }
    const { shows, fullRefreshes } = d.stats;
    d.invalidate();
    await settle(clock, d.show(), 20_000);
    expect([d.stats.shows, d.stats.fullRefreshes]).toEqual([shows, fullRefreshes]);
  });

  it('starts an e-paper app on white paper, with no refresh', async () => {
    const clock = pausedClock();
    const d = new Display(findDevice('waveshare-epd-2.13-v4')!, clock);
    await resetScreen(d);
    expect(d.stats.shows).toBe(0);
    expect(d.getPixel(10, 10)).toBe(colors.WHITE);
  });

  it('keeps an LED colour at 8 bits a channel: a dim one stays lit, and get gives back what set wrote', async () => {
    const t = await boot('function init(ctx) leds.set(0, 0x060306) leds.set(1, 0x123456) log.info(leds.get(0), leds.get(1)) leds.show() end', 'ws2812-strip-30');
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual([`${0x060306}\t${0x123456}`]);
    await settle(t.clock, t.host.settle());
    expect(glass(t.display, 0, 0)).toEqual([6, 3, 6]);
  });
});

describe('the Resident runtime, as the board runs an app', () => {
  it('runs on after an error in init, and after one in the top-level code once a callback is defined', async () => {
    const t = await boot('function init(ctx) local x = nil + 1 end function on_tick(ctx) log.info("tick") end');
    expect(t.error).toMatch(/arithmetic/);
    expect(t.running).toBe(true);
    t.steps(250);
    expect(t.logs).toContain('tick');
    const u = await boot('function on_tick(ctx) log.info("tick") end\nlocal y = nil + 1');
    expect(u.running).toBe(true);
    u.steps(250);
    expect(u.logs).toContain('tick');
    expect((await boot('local y = nil + 1')).running).toBeUndefined(); // nothing to run
  });

  it('keeps the callbacks it found after loading, as the board holds them', async () => {
    const t = await boot(`function on_tick(ctx) log.info("first") on_tick = function() log.info("second") end end
      function init(ctx) function on_event(ctx, e) log.info("event") end end`);
    t.steps(250);
    expect(t.logs.filter((l) => l === 'second')).toEqual([]);
    expect(t.host.queue({ name: 'go', channel: 'app', data: {} })).toBe(false); // on_event came after loading
  });

  it('stamps a relay event with when it came, and gives every call its own ctx', async () => {
    const t = await boot(`function on_event(ctx, e) log.info(type(e.ts_ms), tostring(ctx.seen)) ctx.seen = true end`);
    t.host.queue({ name: 'go', channel: 'app', data: {}, ts_ms: undefined });
    t.host.queue({ name: 'go', channel: 'app', data: {} });
    t.steps(20);
    expect(t.logs).toEqual(['number\tnil', 'number\tnil']);
  });

  it('holds 7 events, and drops one of 1024 bytes, as the board does', async () => {
    const t = await boot('function on_event(ctx, e) log.info(e.data.n) end');
    for (let n = 1; n <= 8; n++) t.host.queue({ name: 'tap', channel: 'app', data: { n } });
    expect(t.host.queue({ name: 'big', channel: 'app', data: { s: 'x'.repeat(1016) } })).toBe(false); // {"s":"…"}: 1024 bytes
    t.steps(50);
    expect(t.logs).toEqual(['2', '3', '4', '5', '6', '7', '8']);
  });

  it('takes "10" as an integer, and says what a non-number was', async () => {
    const t = await boot(`local g = lgfx.bind("main")
      function init(ctx) g:fillRect("10", 0, 4, 4, 0xffffff) local ok, e = pcall(g.fillRect, g, "abc", 0, 4, 4, 0) log.info(e) end`);
    expect(t.error).toBeUndefined();
    expect(t.logs[0]).toMatch(/number expected, got string/);
  });

  it("reports summer time only in summer, and a bad gmtime's error at the app's line", async () => {
    const t = await boot(`function init(ctx)
      log.info(time.localtime(1767225600).tm_isdst, time.localtime(1782864000).tm_isdst)
      local ok, e = pcall(function() local t = time.gmtime("x") return t end) log.info(e)
    end`);
    expect(t.logs.filter((l) => !l.startsWith('warn'))).toEqual(['0\t1', expect.stringMatching(/^app:3: bad argument #1 to 'gmtime'/)]);
  });

  it("keeps the store to the app's own keys, and sends events as the board serialises them", async () => {
    const t = await boot(`function init(ctx)
      log.info(tostring(store.get("constructor")), store.set("__proto__", 5), store.get("__proto__"))
      events.send("a", { 1, 2, 3 }) events.send("b", "text") events.send("c", { pi = 3.14159265 })
    end`);
    expect(t.logs).toEqual(['nil\ttrue\t5']);
    expect(t.sent).toEqual(['a {}', 'b {}', 'c {"pi":3.14159}']);
  });

  it('reads a time the clocks skipped as summer time, as ezTime does', () => {
    const ny = new Zone('America/New_York').resolve(wallSeconds({ year: 2026, mon: 3, mday: 8, hour: 2, min: 30, sec: 0 }));
    expect(ny.utc).toBe(Date.UTC(2026, 2, 8, 6, 30) / 1000);
    expect(ny.gmtoff).toBe(-4 * 3600);
    const sthlm = new Zone('Europe/Stockholm').resolve(wallSeconds({ year: 2026, mon: 3, mday: 29, hour: 2, min: 30, sec: 0 }));
    expect([sthlm.utc, sthlm.gmtoff, sthlm.abbr]).toEqual([Date.UTC(2026, 2, 29, 0, 30) / 1000, 7200, 'CEST']);
    // A repeated hour is its first time round.
    const back = new Zone('Europe/Stockholm').resolve(wallSeconds({ year: 2026, mon: 10, mday: 25, hour: 2, min: 30, sec: 0 }));
    expect([back.utc, back.gmtoff]).toEqual([Date.UTC(2026, 9, 25, 0, 30) / 1000, 7200]);
  });
});

describe('the controls', () => {
  const desk = (...kinds: PartKind[]) => {
    const clock = pausedClock();
    const bench = new Bench(clock);
    bench.load(kinds.map((k) => spec(k)));
    return { clock, bench };
  };

  it('turns two dials on one encoder', () => {
    const { bench } = desk('knob');
    const volume = new Dial({ min: 0, max: 100, start: 50 }, bench);
    const hue = new Dial({ min: 0, max: 100, start: 50 }, bench);
    volume.bind('knob-1:rotate'); // both chosen in Connections
    hue.bind('knob-1:rotate');
    (bench.part('knob-1') as Knob).turn(3);
    expect([volume.value, hue.value]).toEqual([53, 53]);
  });

  it('pairs a trigger’s presses and releases when it moves while held', () => {
    const { bench } = desk('button', 'knob');
    const t = new Trigger({}, bench);
    (bench.part('button-1') as Button).setDown(true);
    expect(t.isPressed()).toBe(true);
    t.bind('knob-1:push');
    (bench.part('button-1') as Button).setDown(false);
    const push = (bench.part('knob-1') as Knob).button;
    push.setDown(true);
    push.setDown(false);
    t.isPressed();
    expect([t.presses, t.releases, t.isPressed()]).toEqual([2, 2, false]);
    // A trigger made while its button is down doesn't take that press's release as its own.
    push.setDown(true);
    const late = new Trigger({ connect: 'knob-1:push' }, bench);
    push.setDown(false);
    expect([late.presses, late.releases, late.wasReleased()]).toEqual([0, 0, false]);
  });

  it("starts an absolute dial where its part is, wraps by its steps, and centres an open range on its start", () => {
    const { bench } = desk('pot');
    const d = new Dial({ min: 0, max: 100, step: 10, start: 30, via: 'pot' }, bench);
    expect(d.delta()).toBe(0); // no steps it didn't take
    const w = new Dial({ min: 0, max: 10, step: 3, start: 9, wrap: true }, bench);
    w.bind('none');
    w.handleKey('ArrowRight', true);
    expect(w.value).toBe(0); // 9 → 0, never 12
    const open = new Dial({ start: 120, via: 'pot' }, bench);
    expect(Math.abs(open.value - 120)).toBeLessThanOrEqual(12);
  });

  it('numbers a part added after one was taken off by its id', () => {
    const { bench } = desk();
    bench.add('knob');
    bench.add('knob');
    bench.remove('knob-1');
    expect(bench.add('knob').label).toBe('Encoder 1');
  });

  it('gives a second plain dial a free pot before the board’s IMU', () => {
    const clock = pausedClock();
    const b = boardBench(findDevice('m5stickc-plus2')!, clock, [spec('knob'), spec('pot')]);
    new Dial({}, b);
    expect(new Dial({}, b).source).toBe('pot-1:position');
  });

  it('wires a bench whatever order its parts were added in', () => {
    const device = findDevice('m5stickc-plus2')!;
    const board = findBoard(device.id)!;
    for (const order of [['pir', 'pot', 'tof'], ['pot', 'pir', 'tof']] as PartKind[][])
      expect(wiring(device, board, order.map((k) => ({ ...spec(k), builtin: false }))).problems, order.join()).toEqual([]);
  });

  it("puts the e-paper driver board's IO12 key on the bench as Button A", () => {
    const b = boardBench(findDevice('waveshare-epd-2.13-v4')!, pausedClock(), [], 'waveshare-esp32-epaper-driver');
    expect(b.builtinButton(0)).toBeDefined();
  });
});

describe('the mirror, the minifier and drawing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops sending updates when a push fails, rather than driving the app the board still runs', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const sent: string[] = [];
    let status = 200;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => (sent.push(JSON.parse(init.body).type), { status }));
    const m = new RemoteMirror();
    m.setDeviceId('abc');
    const source = () => ({ controls: [], bench: new Bench(new SimClock()), buttons: {} });
    await m.start({ name: 'A', code: 'function init(ctx) end' }, source);
    status = 503;
    await m.start({ name: 'B', code: 'function init(ctx) end' }, source);
    expect(m.status).toBe('offline');
    sent.length = 0;
    await new Promise((r) => setTimeout(r, 350));
    expect(sent).toEqual([]);
    expect(m.active).toBe(true); // still wanted: the next app goes when it can
    m.stop();
  });

  it("sends the IMU only to an app that names it", () => {
    const b = boardBench(findDevice('m5stickc-plus2')!, pausedClock(), []);
    expect(new SnapshotReader(new Set()).read([], b, {}).s.imu).toBeUndefined();
    expect(new SnapshotReader(new Set(['imu'])).read([], b, {}).s.imu).toBeDefined();
  });

  it("minifies without changing what a long string or a \\z escape holds", () => {
    expect(minifyLua('local s = [[\nline1\n\nline3]]\n\n\nx = 1')).toBe('local s=[[\nline1\n\nline3]]\nx=1');
    const z = 'local s = "a\\z\n   b" local t = "x -- y"';
    expect(minifyLua(z)).toBe('local s="a\\z\n   b"local t="x -- y"');
  });

  it('fills a flat triangle end to end, and nothing for a negative width', () => {
    const d = new Display(findDevice('waveshare-esp32-s3-touch-lcd-2')!, pausedClock());
    d.fillScreen(colors.BLACK);
    d.fillTriangle(0, 5, 10, 5, 20, 5, colors.WHITE);
    expect(d.getPixel(20, 5)).toBe(colors.WHITE);
    d.fillRect(40, 20, -5, 3, colors.WHITE);
    expect(d.getPixel(37, 21)).toBe(colors.BLACK);
    d.fillRect(60, 20, 2, -3, colors.WHITE); // rows 18..20
    expect([d.getPixel(60, 17), d.getPixel(60, 18), d.getPixel(60, 20)]).toEqual([colors.BLACK, colors.WHITE, colors.WHITE]);
  });

  it("doesn't hang LVGL on a parent loop, and removes only the style asked for", async () => {
    const t = await boot(`local h = lvgl.bind("main")
      function init(ctx)
        local scr = h:screen()
        local a = h:Object(scr) local b = h:Object(a)
        a:set_parent(b) scr:set_parent(a)
        local red, wide = lvgl.Style({ bg_color = 0xff0000 }), lvgl.Style({ width = 90 })
        a:add_style(red) a:add_style(wide) a:remove_style(red)
        log.info(a:get_parent() == scr, a:get_width())
      end`);
    expect(t.error).toBeUndefined();
    t.steps(100);
    expect(t.logs).toEqual(['true\t90']);
  });
});

// Drawing as the boards draw: their canvas is Adafruit GFX's (GFXcanvas16 on the colour boards, a
// GFXcanvas1 on the e-paper board), and their LVGL is 9.1.
describe('drawing as the boards draw it', () => {
  const lcd = () => {
    const d = new Display(findDevice('waveshare-esp32-s3-touch-lcd-2')!, pausedClock());
    d.fillScreen(colors.BLACK);
    return d;
  };
  const lit = (d: Display) => {
    const out = new Set<string>();
    for (let y = 0; y < d.height(); y++) for (let x = 0; x < d.width(); x++) if (d.getPixel(x, y) !== colors.BLACK) out.add(`${x},${y}`);
    return out;
  };

  it("fills a circle as Adafruit's does: its outline inside it, and a 7-pixel top row at r = 10", () => {
    for (let r = 2; r <= 40; r += 3) {
      const d = lcd();
      d.drawCircle(100, 100, r, colors.WHITE);
      const outline = lit(d);
      d.fillCircle(100, 100, r, colors.RED);
      for (const p of outline) expect(d.getPixel(...(p.split(',').map(Number) as [number, number])), `r ${r} at ${p}`).toBe(colors.RED);
    }
    const d = lcd();
    d.fillCircle(100, 100, 10, colors.WHITE);
    expect([...lit(d)].filter((p) => p.endsWith(',90')).length).toBe(7);
    const n = lcd();
    n.fillCircle(50, 50, -3, colors.WHITE); // a negative radius: a 5-pixel line, as on the board
    expect(lit(n).size).toBe(5);
  });

  it("fills triangles pixel for pixel as Adafruit's fillTriangle", () => {
    // Adafruit's algorithm, transcribed: rows between the edges, the C division truncating.
    const reference = (pts: number[]) => {
      let [x0, y0, x1, y1, x2, y2] = pts;
      if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
      if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      const out = new Set<string>();
      const row = (a: number, b: number, y: number) => {
        for (let x = Math.min(a, b); x <= Math.max(a, b); x++) if (x >= 0 && y >= 0 && x < 320 && y < 240) out.add(`${x},${y}`);
      };
      if (y0 === y2) return row(Math.min(x0, x1, x2), Math.max(x0, x1, x2), y0), out;
      let y = y0;
      for (const last = y1 === y2 ? y1 : y1 - 1; y <= last; y++) row(x0 + Math.trunc(((x1 - x0) * (y - y0)) / (y1 - y0)), x0 + Math.trunc(((x2 - x0) * (y - y0)) / (y2 - y0)), y);
      for (; y <= y2; y++) row(x1 + Math.trunc(((x2 - x1) * (y - y1)) / (y2 - y1)), x0 + Math.trunc(((x2 - x0) * (y - y0)) / (y2 - y0)), y);
      return out;
    };
    let seed = 7;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 60; i++) {
      const pts = [rand(320), rand(240), rand(320), rand(240), rand(320), rand(240)];
      const d = lcd();
      d.setRotation(1); // 320×240, as the reference clips
      d.fillScreen(colors.BLACK);
      d.fillTriangle(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], colors.WHITE);
      expect([...lit(d)].sort(), pts.join()).toEqual([...reference(pts)].sort());
    }
  });

  it('places drawString as the firmware does: 6 px a byte, the cursor after it, "\\n" a new line', async () => {
    const t = await boot(`local g = lgfx.bind("main")
      function init(ctx)
        g:fillScreen(0) g:setTextDatum(2) g:drawString("I", 100, 10) -- top right: x 94..99
        g:setTextDatum(0) g:setCursor(0, 50) g:drawString("Hi", 10, 30) g:print("X") -- X at 22
        g:flip()
      end`);
    expect(t.error).toBeUndefined();
    const col = (x0: number, x1: number, y0: number, y1: number) => {
      const xs = new Set<number>();
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (t.display.getPixel(x, y) !== colors.BLACK) xs.add(x);
      return [Math.min(...xs), Math.max(...xs)];
    };
    expect(col(80, 110, 10, 18)).toEqual([95, 97]); // the I's ink: the middle of its 94..99 cell
    expect(col(20, 30, 30, 38)[0]).toBe(22);
  });

  it('positions LVGL objects as LVGL 9.1: from the content box, align_to once, centred halves truncated', async () => {
    const t = await boot(`local h = lvgl.bind("main")
      function init(ctx)
        local scr = h:screen()
        local box = h:Object(scr) box:set{ w = 120, h = 80, x = 10, y = 10 }
        local kid = h:Object(box) kid:set{ w = 20, h = 10, x = 0, y = 0 }
        local tag = h:Object(scr) tag:set{ w = 21, h = 11 }
        tag:align_to{ base = box, type = lvgl.ALIGN.OUT_BOTTOM_LEFT, x_ofs = 0, y_ofs = 2 }
        local x0, y0 = tag:get_pos()
        box:set{ x = 50 } -- tag stays put: align_to placed it once
        local x1 = tag:get_pos()
        local mid = h:Object(scr) mid:set{ w = 21, h = 11 } mid:center()
        log.info(kid:get_x(), kid:get_y(), x0, y0, x1, mid:get_x())
      end`);
    expect(t.error).toBeUndefined();
    t.steps(50);
    const [kx, ky, x0, y0, x1] = t.logs[0].split('\t').map(Number);
    expect([kx, ky]).toEqual([0, 0]);
    expect([x0, y0]).toEqual([10, 92]);
    expect(x1).toBe(10);
  });
});
