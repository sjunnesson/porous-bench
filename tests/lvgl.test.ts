import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ResidentHost, resetScreen, type ResidentBoard } from '../src/resident/host';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';

// LVGL's Lua surface and its timer pump. Node has no canvas, so nothing is drawn here: these are
// about timing and the API; the pixels are checked in the browser.

const factory = new LuaFactory();

async function boot(code: string) {
  const clock = new SimClock();
  clock.paused = true;
  const device = findDevice('m5stickc-plus2')!;
  const display = new Display(device, clock);
  display.setRotation(device.firmwareRotation ?? 0);
  const logs: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons: [new Button({}, clock), new Button({}, clock)],
    store: new AppStore('lvgl-test', false),
    log: (level, text) => logs.push(level === 'info' ? text : `${level}: ${text}`),
    telemetry: () => {},
    publish: () => 'sent',
  };
  const cleared = resetScreen(display);
  for (let i = 0; i < 20; i++) clock.advance(1);
  await cleared;
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  return { host, error, clock, display, logs };
}

/** Run the sandbox loop like the sketch does: a pass every 5 ms of sim time. */
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

function glass(d: Display, x: number, y: number): [number, number, number] {
  const out = new Uint8ClampedArray(d.profile.width * d.profile.height * 4);
  d.panel.render(Infinity, out);
  const i = (y * d.profile.width + x) * 4;
  return [out[i], out[i + 1], out[i + 2]];
}

describe('lvgl module', () => {
  it('only resolves luavgl keys after the first bind, as on the device', async () => {
    const t = await boot(`function init()
      log.info(tostring(lvgl.ALIGN), tostring(lvgl.Anim))
      local h = lvgl.bind("main")
      log.info(type(lvgl.ALIGN), type(lvgl.Anim), lvgl.ALIGN.CENTER, type(h.Label), h.HOR_RES(), h.VER_RES())
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual(['nil\tnil', 'table\tfunction\t9\tfunction\t240\t135']);
    expect((await boot('function init() lvgl.bind("side") end')).error).toMatch(/no display named 'side'/);
  });

  it('builds widgets in every call form and refuses a deleted one', async () => {
    const t = await boot(`function init()
      local h = lvgl.bind("main")
      local a = h.Label { text = "a" }
      local b = h:Label { text = "b" }
      local box = h.Object(nil, { w = 100, h = 60 })
      local c = h.Label(box, { text = "c" })
      local d = box:Label { text = "d" }
      log.info(box:get_child_cnt(), h.screen():get_child_cnt())
      box:delete()
      log.info(pcall(function() c:set { text = "x" } end))
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs[0]).toBe('2\t3');
    expect(t.logs[1]).toMatch(/^false\t.*object deleted/);
  });

  it('runs Anims from its own 33 ms pump, far more often than on_tick', async () => {
    const t = await boot(`local h = lvgl.bind("main")
      local box = h.Object(nil, { w = 40, h = 40 })
      local calls, ticks, last = 0, 0, nil
      box:Anim {
        start_value = 0, end_value = 100, duration = 660, path = "linear", run = true,
        exec_cb = function(obj, v) calls = calls + 1 last = v obj:set { x = v } end,
        done_cb = function(a, obj) log.info("done", calls, ticks, last) end,
      }
      function on_tick() ticks = ticks + 1 end`);
    expect(t.error).toBeUndefined();
    await run(t, 800);
    const [msg, calls, ticks, last] = t.logs[0].split('\t');
    expect(msg).toBe('done');
    expect(Number(last)).toBe(100);
    // ~660 ms of 33 ms periods (plus early_apply) vs ~6 ticks.
    expect(Number(calls)).toBeGreaterThanOrEqual(19);
    expect(Number(ticks)).toBeLessThanOrEqual(7);
    expect(Number(calls)).toBeGreaterThan(Number(ticks) * 2.5);
  });

  it('applies the start value at once, plays back, repeats, and eases', async () => {
    const t = await boot(`local h = lvgl.bind("main")
      local box = h.Object(nil, {})
      local seen = {}
      local a = box:Anim {
        start_value = 0, end_value = 10, duration = 100, playback_time = 100, repeat_count = 2,
        exec_cb = function(_, v) seen[#seen + 1] = v end,
        done_cb = function() log.info(table.concat(seen, ",")) end,
      }
      a:start()
      log.info("first", seen[1])
      local eased = {}
      box:Anim { start_value = 0, end_value = 1000, duration = 330, path = "ease_out", run = true,
        exec_cb = function(_, v) eased[#eased + 1] = v end,
        done_cb = function() log.info("ease_out", eased[3], eased[#eased]) end }
      box:Anim { start_value = 0, end_value = 1000, duration = 330, path = "bounce", run = true, early_apply = false,
        exec_cb = function(_, v) eased.b = v end,
        done_cb = function() log.info("bounce", eased.b) end }
      function on_tick() end`);
    expect(t.error).toBeUndefined();
    expect(t.logs[0]).toBe('first\t0'); // early_apply
    await run(t, 600);
    const updown = t.logs.find((l) => /^\d+(,\d+)+$/.test(l))!.split(',').map(Number);
    const peak = updown.indexOf(10);
    expect(peak).toBeGreaterThan(0);
    expect(updown.slice(peak).some((v) => v < 10)).toBe(true); // played back down
    expect(updown.filter((v) => v === 10).length).toBeGreaterThanOrEqual(2); // and repeated
    const ease = t.logs.find((l) => l.startsWith('ease_out'))!.split('\t').map(Number);
    expect(ease[1]).toBeGreaterThan(200); // ease_out moves fast early (linear would be ~200 by then)
    expect(ease[2]).toBe(1000);
    expect(t.logs.find((l) => l.startsWith('bounce'))).toBe('bounce\t1000');
  });

  it('runs lvgl.Timer callbacks on their period and stops after repeat_count', async () => {
    const t = await boot(`local h = lvgl.bind("main")
      local n = 0
      lvgl.Timer { period = 50, repeat_count = 3, cb = function(tm) n = n + 1 log.info("timer", n) end }
      function on_tick() end`);
    expect(t.error).toBeUndefined();
    await run(t, 400);
    expect(t.logs).toEqual(['timer\t1', 'timer\t2', 'timer\t3']);
  });

  it('drops an anim whose target was deleted, and logs callback errors without stopping the pump', async () => {
    const t = await boot(`local h = lvgl.bind("main")
      local box = h.Object(nil, {})
      local other = h.Object(nil, {})
      box:Anim { start_value = 0, end_value = 100, duration = 1000, run = true,
        exec_cb = function(obj, v) obj:set { x = v } end }
      other:Anim { start_value = 0, end_value = 100, duration = 200, run = true,
        exec_cb = function(_, v) if v > 50 then error("boom") end end }
      function on_tick(ctx) if ctx.time_ms > 100 and box then box:delete() box = nil end end`);
    expect(t.error).toBeUndefined();
    await run(t, 400);
    expect(t.logs.some((l) => /error: lvgl callback: .*boom/.test(l))).toBe(true);
    expect(t.logs.some((l) => /object deleted/.test(l))).toBe(false);
  });

  it('shares lvgl.Style updates and merges set_style into one local style', async () => {
    const t = await boot(`function init()
      local h = lvgl.bind("main")
      local st = lvgl.Style { w = 50, h = 10 }
      local a, b = h.Object(nil, {}), h.Object(nil, {})
      a:add_style(st) b:add_style(st)
      st:set { w = 80 }                       -- reaches both objects
      log.info(a:get_width(), b:get_width())
      b:set_style({ w = 30 }) b:set_style({ h = 20 })   -- one local style: the width stays
      log.info(b:get_width(), b:get_height(), a:get_width())
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual(['80\t80', '30\t20\t80']);
  });

  it('owns the panel once bound: lgfx flips stand down', async () => {
    const t = await boot(`local g = lgfx.bind("main")
      function init() g:fillScreen(0xFF0000) g:flip() end
      function on_event(ctx, e)
        lvgl.bind("main")
        g:fillScreen(0x0000FF)
        g:flip() -- dropped: LVGL owns the panel now
      end`);
    expect(t.error).toBeUndefined();
    await run(t, 60);
    expect(glass(t.display, 60, 60)[0]).toBeGreaterThan(200);
    t.host.queue({ name: 'go', channel: 'app', data: {} });
    await run(t, 100);
    const px = glass(t.display, 60, 60);
    expect(px[0]).toBeGreaterThan(200);
    expect(px[2]).toBeLessThan(60);
  });
});
