import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ResidentHost, resetScreen, type ResidentBoard } from '../src/resident/host';
import { AppStore } from '../src/resident/store';
import { strftime, breakDown } from '../src/resident/timecore';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';

const factory = new LuaFactory();

async function boot(code: string, deviceId = 'm5stickc-plus2') {
  const clock = new SimClock();
  clock.paused = true;
  const device = findDevice(deviceId)!;
  const display = new Display(device, clock);
  display.setRotation(device.firmwareRotation ?? 0);
  const logs: string[] = [];
  const telemetry: string[] = [];
  const buttons = [new Button({}, clock), new Button({}, clock)];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons,
    store: new AppStore('test', false),
    log: (level, text) => logs.push(`${level}: ${text}`),
    telemetry: (name, data) => telemetry.push(data?.error ? `${name}: ${data.error}` : name),
    publish: () => 'sent',
  };
  const cleared = resetScreen(display); // the board clears the glass on app reset
  for (let i = 0; i < 20; i++) clock.advance(1);
  await cleared;
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  return { host, error, clock, display, logs, telemetry, buttons };
}

function glass(d: Display, x: number, y: number): [number, number, number] {
  const out = new Uint8ClampedArray(d.profile.width * d.profile.height * 4);
  d.panel.render(Infinity, out);
  const i = (y * d.profile.width + x) * 4;
  return [out[i], out[i + 1], out[i + 2]];
}

/** Advance sim time and run the sandbox loop like the sketch does. */
async function run(t: { host: ResidentHost; clock: SimClock }, ms: number) {
  for (let i = 0; i < ms; i += 5) {
    t.clock.advance(5);
    t.host.step();
    const settled = t.host.settle();
    for (let k = 0; k < 50; k++) {
      t.clock.advance(1);
      await Promise.resolve();
    }
    await settled;
  }
}

describe('Resident sandbox', () => {
  it('rejects apps without callbacks and reports compile errors with app line numbers', async () => {
    expect((await boot('local x = 1')).error).toContain('define at least one of init, on_tick, on_event');
    expect((await boot('function init(ctx)\n  local = 3\nend')).error).toMatch(/^app:2:/);
  });

  it('has no os/io/load/require/debug, and math is only math.*', async () => {
    const t = await boot(`function init(ctx)
      log.info(tostring(os) .. tostring(io) .. tostring(load) .. tostring(require) .. tostring(debug) .. tostring(floor))
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual(['info: nilnilnilnilnilnil']);
  });

  it('only shows lgfx drawing after flip()', async () => {
    const t = await boot(`local g = lgfx.bind("main")
      function init(ctx) g:fillScreen(0xFF0000) end
      function on_event(ctx, e) g:flip() end`);
    expect(t.error).toBeUndefined();
    await run(t, 50);
    expect(glass(t.display, 60, 60)[0]).toBeLessThan(30); // drawn but not flipped
    t.host.queue({ name: 'go', channel: 'app', data: {} });
    await run(t, 50);
    expect(glass(t.display, 60, 60)[0]).toBeGreaterThan(240);
  });

  it('checks integer arguments like luaL_checkinteger, numbering method args from 1', async () => {
    const t = await boot(`local g = lgfx.bind("main")
      function init(ctx)
        g:fillRect(10, 10, 20, 20.0, 0xFFFFFF)  -- integral float: fine
        g:fillRect(1.5, 0, 4, 4, 0xFFFFFF)
      end`);
    expect(t.error).toBe("app:4: bad argument #1 to 'fillRect' (number has no integer representation)");
    const u = await boot(`function init(ctx) lgfx.bind("side") end`);
    expect(u.error).toBe("app:1: lgfx.bind: no display named 'side'");
  });

  it('runs the M5Stick screen.* API on a landscape 240x135 canvas', async () => {
    const t = await boot(`function init(ctx)
      log.info(screen.width() .. "x" .. screen.height())
      screen.clear(0, 0, 255)
      screen.fill_rect(10.7, 10, 20, 20, 0, 255, 0)
      screen.flip()
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs[0]).toBe('info: 240x135');
    await run(t, 20);
    // Landscape logical (15, 15) is native (135-1-15, 15) on the portrait panel.
    expect(glass(t.display, 119, 15)[1]).toBeGreaterThan(240);
    expect(glass(t.display, 60, 200)[2]).toBeGreaterThan(240);
  });

  it('ticks at 10 FPS with dt_ms and ctx.time_ms', async () => {
    const t = await boot(`local n, last = 0, 0
      function on_tick(ctx, dt) n = n + 1 last = dt if n == 5 then log.info(n .. " " .. dt .. " " .. ctx.time_ms) end end`);
    await run(t, 600);
    const line = t.logs.find((l) => l.startsWith('info: 5 '))!;
    const [, n, dt, time] = line.split(' ');
    expect(Number(n)).toBe(5);
    expect(Number(dt)).toBeGreaterThanOrEqual(100);
    expect(Number(dt)).toBeLessThan(140);
    expect(Number(time)).toBeGreaterThanOrEqual(500);
  });

  it('turns button presses into tap / hold events with e.data.index', async () => {
    const t = await boot(`function on_event(ctx, e)
      log.info(e.name .. " " .. tostring(e.data.index) .. " " .. tostring(e.data.held) .. " " .. e.channel .. " " .. tostring(e.index))
    end`);
    t.buttons[1].setDown(true);
    await run(t, 30);
    t.buttons[1].setDown(false);
    await run(t, 30);
    expect(t.logs).toEqual(['info: tap 1 nil driver 1', 'info: button 1 nil driver 1']);
    t.logs.length = 0;
    t.buttons[0].setDown(true);
    await run(t, 600);
    t.buttons[0].setDown(false);
    await run(t, 30);
    expect(t.logs).toEqual(['info: hold 0 true driver 0', 'info: hold 0 false driver 0']);
  });

  it('aborts a runaway callback without killing the app', async () => {
    const t = await boot(`local ticks = 0
      function on_tick(ctx) ticks = ticks + 1 if ticks == 1 then while true do end end log.info("alive " .. ticks) end`);
    await run(t, 250);
    expect(t.logs.some((l) => l.includes('instruction budget exceeded'))).toBe(true);
    expect(t.logs.some((l) => l.startsWith('info: alive'))).toBe(true);
  });

  it("matches Python's datetime", async () => {
    const t = await boot(`function init(ctx)
      local dt = datetime(2026, 10, 5, 13, 5, 9)
      log.info(dt:strftime("%a %d %b %Y %H:%M:%S %Z"))
      log.info(tostring(dt), dt:isoformat())
      log.info((datetime.date(2026, 12, 25) - datetime.date(2026, 10, 5)).days)
      log.info(tostring(datetime.timedelta{ days = 1, hours = 2 }))
      log.info(dt:weekday(), datetime.synced())
      local ok, err = pcall(datetime.date, 2026, 13, 1)
      log.info(err)
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual([
      'info: Mon 05 Oct 2026 13:05:09 BST',
      'info: 2026-10-05 13:05:09\t2026-10-05T13:05:09+01:00',
      'info: 81',
      'info: 1 day, 2:00:00',
      'info: 0\ttrue',
      'info: app:8: datetime.date: month must be 1..12',
    ]);
  });

  it('serialises events.send data with Resident rules and stores scalars within budget', async () => {
    const sent: string[] = [];
    const t = await boot(`function init(ctx)
      log.info(events.send("report", { level = 3, ok = true, tags = { "a", "b" }, deep = { a = { b = { c = 1 } } } }))
      log.info(tostring(store.set("n", 41)), tostring(store.set("t", {})), store.get("n"))
      log.info(tostring(store.set("big", string.rep("x", 3000))))
    end`);
    expect(t.error).toBeUndefined();
    expect(t.logs[0]).toBe('info: sent');
    expect(t.logs[1]).toBe('info: true\tfalse\t41');
    expect(t.logs[2]).toBe('info: false');
    void sent;
  });
});

describe('timecore', () => {
  it('formats like the device', () => {
    const t = breakDown(Date.UTC(2026, 9, 5, 12, 5, 9) / 1000, 3600, 'BST'); // 2026-10-05 13:05:09 BST
    expect(strftime('%c|%x|%X|%j|%U|%W|%w|%e|%I%p|%z', t)).toBe('Mon Oct  5 13:05:09 2026|10/05/26|13:05:09|278|40|40|1| 5|01PM|+0100');
  });
});
