// Runs one Resident Lua app: a fresh Lua 5.4 VM (wasmoon), the sandbox prelude, and the JS half of
// every module (lgfx, screen, imu, buzzer, button, screens, events, store, time, datetime), plus
// Bench's own drivers for the hardware on the desk (dial, trigger, ld2410).
// Mirrors the device's dispatch: init once, on_tick every 100 ms, on_event from an 8-slot ring.

import qrcode from 'qrcode-generator';
import type { LuaEngine, LuaFactory } from 'wasmoon';
import { color565, colors, rgb565ToRgb } from '../sim/color';
import { DIAL_VIA, type Dial, type DialOptions, TRIGGER_VIA, type Trigger, type TriggerOptions } from '../sim/controls/controls';
import type { LD2410, LD2410Options } from '../sim/inputs/ld2410';
import type { Display } from '../sim/display';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Imu } from '../sim/inputs/imu';
import type { Climate } from '../sim/inputs/climate';
import type { SimInput } from '../sim/inputs/input';
import type { LightSensor } from '../sim/inputs/light';
import type { Pir } from '../sim/inputs/pir';
import type { Touch } from '../sim/inputs/touch';
import datetimeSrc from './lua/datetime.lua?raw';
import lvglSrc from './lua/lvgl.lua?raw';
import preludeSrc from './lua/prelude.lua?raw';
import type { AppStore, Scalar } from './store';
import { breakDown, civilFromDays, daysFromCivil, strftime, type Tm, wallSeconds, weekdayAndYearday } from './timecore';
import type { Zone } from './zone';
import { LvglScreen } from './lvgl';

export interface ResidentEvent {
  name: string;
  from?: string;
  ts_ms: number;
  channel: 'driver' | 'app' | 'runtime';
  src?: string;
  seq?: number;
  data: Record<string, unknown>;
}

export type SendResult = 'sent' | 'queued' | 'dropped';

/** Anything with a button's edges: a push button, or a trigger driven by other hardware. */
export interface Pressable {
  isPressed(): boolean;
  wasPressed(): boolean;
  wasReleased(): boolean;
  /** Edges so far, never consumed (a trigger brings them up to date in isPressed()). */
  readonly presses: number;
  readonly releases: number;
  /** Fired by a sensor (motion, presence, shake…) rather than pressed: its moments are taps, never holds. */
  readonly sensed?: boolean;
}

/** What the board gives the runtime. */
export interface ResidentBoard {
  display: Display;
  /** Sim time in ms. */
  now(): number;
  zone(): Zone;
  buttons: Pressable[];
  imu?: Imu;
  buzzer?: Buzzer;
  store: AppStore;
  /** Bench drivers: hardware the app declares, which appears on the desk. */
  dial?(name: string, opts: DialOptions): Dial;
  trigger?(name: string, opts: TriggerOptions): Trigger;
  radar?(opts: LD2410Options): LD2410;
  /** Bench drivers for the other sensors: the part of that kind on the bench (added if missing). */
  sensor?(kind: 'light' | 'pir' | 'climate' | 'touch'): SimInput;
  log(level: 'info' | 'warn' | 'error', text: string): void;
  telemetry(name: string, data?: Record<string, unknown>): void;
  publish(name: string, dataJson: string, keep: boolean): SendResult;
}

export interface ResidentApp {
  code: string;
  generationId?: string;
}

interface Api {
  load(code: string, generation?: string): string | null;
  chunk(code: string): string | null;
  has(name: string): boolean;
  call(name: string, timeMs: number, arg?: unknown): string | null;
  lv_pump(timeMs: number, period: number): string | null;
  frame(timeMs: number): string | null;
}

const RING = 8;
const TICK_MS = 100;
/** LV_DEF_REFR_PERIOD on the reference board: LVGL's anim timer and display refresh run this often. */
const LV_PERIOD_MS = 33;
const EVENT_JSON_MAX = 1024;
const ORDINAL_OFFSET = 719163;
const I32 = (v: number) => v >= -2147483648 && v <= 2147483647;

/** 0xRRGGBB → RGB565 (LovyanGFX reads uint32 colours as RGB888). */
const c24 = (c: number) => color565((c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
const c565 = (r: number, g: number, b: number) => color565(r & 0xff, g & 0xff, b & 0xff);

export class ResidentHost {
  private api!: Api;
  private ring: ResidentEvent[] = [];
  private presents: Promise<void>[] = [];
  private loadedAt: number;
  private lastTick: number;
  private datum = 0;
  private tickErrors = 0;
  private lastTickErrorReport = -Infinity;
  private taps = 0;
  /** Per button: the taps, holds started and holds ended recognised so far (what a mirror replays). */
  private gestureTotals: [number, number, number][] = [];
  /** The touch panel: the log entries taken so far, the press being followed, and what was raised. */
  private touchSeq = 0;
  private touchDown: { x: number; y: number; t: number; far: boolean } | null = null;
  private touchRaised: [number, 'd' | 'm' | 'u' | 't', number, number][] = [];
  private touchRaisedSeq = 0;
  /** Per button: when it went down, whether it became a hold, and the edges taken so far. */
  private gestures: { downAt: number; held: boolean; presses: number; releases: number }[] = [];
  // Bench drivers the app declared, with what their events last reported.
  private dials = new Map<string, { dial: Dial; last: number }>();
  private triggers = new Map<string, { trigger: Trigger; presses: number; releases: number }>();
  private radar: { r: LD2410; state: number } | null = null;
  /** Sensors the app has read, with what their events last reported. */
  private sensors = new Map<string, { part: SimInput; last: boolean }>();
  // One panel, one library: whoever bound last presents; the other's frames are dropped.
  private owner: 'lgfx' | 'lvgl' | null = null;
  private lv: LvglScreen | null = null;
  private lastLvRefresh = -Infinity;
  closed = false;

  private constructor(
    private engine: LuaEngine,
    private board: ResidentBoard,
  ) {
    this.loadedAt = board.now();
    this.lastTick = this.loadedAt;
    // Edges from before the app started aren't its gestures.
    this.gestures = board.buttons.map((b) => (b.isPressed(), { downAt: -1, held: false, presses: b.presses, releases: b.releases }));
    this.gestureTotals = board.buttons.map(() => [0, 0, 0]);
    this.touchSeq = board.display.touch?.seq ?? 0; // touches from before the app aren't its own
  }

  /** Compile and init an app. Resolves with the host, or with the compile/init error. */
  static async boot(factory: LuaFactory, board: ResidentBoard, app: ResidentApp): Promise<{ host: ResidentHost; error?: string }> {
    const engine = await factory.createEngine({ enableProxy: false, injectObjects: false, openStandardLibs: true });
    const host = new ResidentHost(engine, board);
    engine.global.set('__ss_host', host.bridge());
    engine.global.set('__ss_datetime_src', datetimeSrc);
    engine.global.set('__ss_lvgl_src', lvglSrc);
    host.api = engine.doStringSync(preludeSrc) as Api;
    board.telemetry('app_received');
    const loadErr = host.api.load(app.code, app.generationId);
    if (loadErr) {
      board.telemetry('compile_error', { error: loadErr });
      return { host, error: loadErr };
    }
    board.telemetry('app_compiled');
    const initErr = host.api.call('init', 0);
    if (initErr) {
      board.telemetry('runtime_error', { error: initErr });
      return { host, error: initErr };
    }
    return { host };
  }

  get timeMs(): number {
    return Math.floor(this.board.now() - this.loadedAt);
  }

  /** Queue an event; the ring drops the oldest beyond 8. Oversize data drops the event. */
  queue(e: Omit<ResidentEvent, 'ts_ms'> & { ts_ms?: number }): boolean {
    if (!this.api.has('on_event')) return false;
    if (JSON.stringify(e.data ?? {}).length > EVENT_JSON_MAX) return false;
    this.ring.push({ ts_ms: Math.floor(this.board.now()), ...e, data: e.data ?? {} });
    if (this.ring.length > RING) this.ring.shift();
    return true;
  }

  /** Apply a `chunk`: run code in the live app's state. Returns the error, if any. */
  chunk(code: string): string | null {
    const err = this.api.chunk(code);
    this.board.telemetry(err ? 'chunk_error' : 'chunk_applied', err ? { error: err } : {});
    return err;
  }

  /** One pass of the sandbox loop: button gestures, queued events, and the 10 FPS tick. */
  step(): void {
    if (this.closed) return;
    this.pollButtons();
    this.pollDrivers();
    this.pollTouch();
    while (this.ring.length) {
      const e = this.ring.shift()!;
      const err = this.api.call('on_event', this.timeMs, e);
      if (err) this.reportError(err, false);
    }
    const now = this.board.now();
    if (now - this.lastTick >= TICK_MS) {
      const dt = Math.round(now - this.lastTick);
      this.lastTick = now;
      const err = this.api.call('on_tick', this.timeMs, dt);
      if (err) this.reportError(err, true);
    }
    if (this.lv) this.pumpLvgl(now);
    // leds.on_frame: the LED driver's own frame timer, between ticks too.
    const frameErr = this.api.frame(this.timeMs);
    if (frameErr) this.reportError(frameErr, true);
  }

  /**
   * LVGL's own timer handler: animations and lvgl.Timers every LV_DEF_REFR_PERIOD, then a refresh
   * of whatever changed. It runs between ticks, so Anim motion is ~30 fps while on_tick stays at 10.
   */
  private pumpLvgl(now: number) {
    const err = this.api.lv_pump(this.timeMs, LV_PERIOD_MS);
    if (err) this.reportError(err, true);
    const lv = this.lv!;
    if (this.owner !== 'lvgl' || !lv.dirty || now - this.lastLvRefresh < LV_PERIOD_MS) return;
    this.lastLvRefresh = now;
    if (lv.refresh()) this.track(this.board.display.show());
  }

  /**
   * A frame on its way to the glass. The loop waits for it to cross the bus before the next pass,
   * but not for an e-paper refresh: the firmware's flip returns at once and the panel refreshes in
   * the background (newest frame wins), so taps and ticks keep coming while it's BUSY.
   */
  private track(shown: Promise<void>) {
    // Stopping the app mid-transfer rejects it; settle() reports that, so don't let it surface as unhandled.
    shown.catch(() => {});
    if (this.board.display.tech !== 'epaper') this.presents.push(shown);
  }

  /** Wait for every flip of the last pass to finish travelling over the bus. */
  async settle(): Promise<void> {
    while (this.presents.length) await this.presents.shift();
  }

  close(): void {
    this.closed = true;
    this.board.buzzer?.stop();
    try {
      this.engine.global.close();
    } catch {
      /* already closed */
    }
  }

  // ---- internals ---------------------------------------------------------------------------

  private reportError(err: string, fromTick: boolean) {
    const now = this.board.now();
    if (fromTick) {
      this.tickErrors++;
      // The device reports the first three on_tick errors, then one per 5 s.
      if (this.tickErrors > 3 && now - this.lastTickErrorReport < 5000) return;
      this.lastTickErrorReport = now;
    }
    this.board.log('error', `runtime error: ${err}`);
    this.board.telemetry('runtime_error', { error: err });
  }

  private pollButtons() {
    const now = this.board.now();
    this.board.buttons.forEach((b, index) => {
      const g = this.gestures[index];
      b.isPressed(); // a trigger brings its edge counts up to date here
      if (b.sensed) {
        // A PIR stays on for seconds after motion: that's one moment, not a long press.
        while (g.presses < b.presses) {
          g.presses++;
          this.tap(index);
        }
        g.releases = b.releases;
        g.downAt = -1;
        g.held = false;
        return;
      }
      // Every press and release since the last pass, in order, so quick taps all count even when
      // the loop was busy (the device counts them all too).
      for (;;) {
        if (g.presses <= g.releases && g.presses < b.presses) {
          g.presses++;
          g.downAt = now;
          g.held = false;
        } else if (g.releases < b.releases) {
          g.releases++;
          if (g.downAt >= 0) {
            if (g.held) this.hold(index, false);
            else this.tap(index);
          }
          g.downAt = -1;
          g.held = false;
        } else break;
      }
      if (g.downAt >= 0 && !g.held && now - g.downAt >= 500) {
        g.held = true;
        this.hold(index, true);
      }
    });
  }

  /**
   * The touch panel: `touch_down`, `touch_move` (the newest point of each pass, so a drag can't fill
   * the 8-slot event ring), `touch_up`, and `touch_tap` for a release within 500 ms that moved under
   * 10 px. Points are in the coordinates apps draw in.
   */
  private pollTouch() {
    const t = this.board.display.touch;
    if (!t) return;
    const d = this.board.display;
    let move: [number, number] | null = null;
    for (const e of t.log) {
      if (e.seq <= this.touchSeq) continue;
      this.touchSeq = e.seq;
      const [x, y] = d.fromNative(e.x, e.y);
      if (e.kind === 'move') {
        move = [x, y];
        if (this.touchDown && Math.hypot(x - this.touchDown.x, y - this.touchDown.y) >= 10) this.touchDown.far = true;
        continue;
      }
      if (move) this.raiseTouch('m', ...move);
      move = null;
      if (e.kind === 'down') {
        this.touchDown = { x, y, t: e.t, far: false };
        this.raiseTouch('d', x, y);
      } else {
        const down = this.touchDown;
        this.touchDown = null;
        this.raiseTouch('u', x, y);
        if (down && !down.far && e.t - down.t < 500) this.raiseTouch('t', x, y);
      }
    }
    if (move) this.raiseTouch('m', ...move);
  }

  private raiseTouch(kind: 'd' | 'm' | 'u' | 't', x: number, y: number) {
    const name = { d: 'touch_down', m: 'touch_move', u: 'touch_up', t: 'touch_tap' }[kind];
    this.queue({ name, channel: 'driver', data: { x, y } });
    this.touchRaised.push([++this.touchRaisedSeq, kind, x, y]);
    if (this.touchRaised.length > 16) this.touchRaised.shift();
  }

  /** The newest touch events raised, oldest first, numbered: [seq, kind, x, y] (what a mirror replays). */
  touchEvents(): [number, string, number, number][] {
    return this.touchRaised.map((e) => [...e]);
  }

  /** Taps, holds started and holds ended on each button so far: [A, B]. */
  gestureCounts(): [number, number, number][] {
    return this.gestureTotals.map((t) => [...t] as [number, number, number]);
  }

  private hold(index: number, held: boolean) {
    this.gestureTotals[index][held ? 1 : 2]++;
    this.queue({ name: 'hold', channel: 'driver', data: { index, held } });
  }

  private tap(index: number) {
    this.gestureTotals[index][0]++;
    this.taps++;
    const data = { index, count: this.taps };
    this.queue({ name: 'tap', channel: 'driver', data });
    this.queue({ name: 'button', channel: 'driver', data });
  }

  /** Driver events for the declared hardware: a dial that moved, a trigger edge, a radar state change. */
  private pollDrivers() {
    for (const [name, d] of this.dials) {
      const value = d.dial.value;
      if (value !== d.last) {
        this.queue({ name: 'dial', channel: 'driver', data: { name, value, delta: value - d.last } });
        d.last = value;
      }
    }
    for (const [name, t] of this.triggers) {
      t.trigger.isPressed(); // brings its edge counts up to date
      while (t.presses < t.trigger.presses || t.releases < t.trigger.releases) {
        const press = t.presses <= t.releases && t.presses < t.trigger.presses;
        if (press) t.presses++;
        else t.releases++;
        this.queue({ name: 'trigger', channel: 'driver', data: { name, pressed: press } });
      }
    }
    // PIR and touch report their edges as driver events too.
    for (const [kind, s] of this.sensors) {
      const on = kind === 'pir' ? (s.part as Pir).motion() : kind === 'touch' ? (s.part as Touch).isPressed() : false;
      if (on !== s.last && (kind === 'pir' || kind === 'touch')) {
        s.last = on;
        this.queue({ name: kind === 'pir' ? 'motion' : 'touch', channel: 'driver', data: kind === 'pir' ? { moving: on } : { touched: on } });
      }
    }
    if (this.radar) {
      const r = this.radar.r;
      r.read();
      const state = (r.movingTargetDetected() ? 1 : 0) | (r.stationaryTargetDetected() ? 2 : 0);
      if (state !== this.radar.state) {
        this.radar.state = state;
        this.queue({ name: 'presence', channel: 'driver', data: { moving: !!(state & 1), still: !!(state & 2), distance_cm: r.detectionDistance() } });
      }
    }
  }

  private present() {
    if (this.owner === 'lvgl') return; // LVGL owns the panel: an lgfx flip stands down silently
    const d = this.board.display;
    d.invalidate(); // a flip blits the whole frame buffer
    this.track(d.show());
  }

  private drawString(s: string, x: number, y: number) {
    const d = this.board.display;
    const w = d.textWidth(s);
    const h = d.fontHeight();
    const datum = this.datum;
    const col = datum & 3;
    const dx = col === 1 ? w / 2 : col === 2 ? w : 0;
    let dy = 0;
    if (datum >= 16) dy = (h * 7) / 8; // baseline of the 8-px font
    else if ((datum & 12) === 4) dy = h / 2;
    else if ((datum & 12) === 8) dy = h;
    d.drawString(s, Math.round(x - dx), Math.round(y - dy));
  }

  private screenInfo() {
    const d = this.board.display;
    const p = d.profile;
    const dpi = p.look.activeWidthMm ? Math.round(p.width / (p.look.activeWidthMm / 25.4)) : undefined;
    return {
      name: 'main',
      w: d.width(),
      h: d.height(),
      shape: p.shape ?? 'rect',
      depth: d.isColor() ? 16 : 1,
      scheme: p.tech === 'epaper' ? 'light' : 'dark',
      ...(dpi ? { dpi } : {}),
      // Bench extras: which module this is.
      model: p.name,
      controller: p.controller,
      tech: p.tech,
    };
  }

  private tm(secs: number, local: boolean): Tm {
    if (!local) return breakDown(secs, 0, 'UTC');
    const z = this.board.zone().at(secs);
    return breakDown(secs, z.gmtoff, z.abbr);
  }

  // Bridge functions return undefined, never null, for "nothing": this wasmoon throws on a returned
  // null. Lua sees no value, so the prelude wraps any that an app reads directly.
  private bridge() {
    const b = this.board;
    const d = b.display;
    const now = () => Math.floor(Date.now() / 1000);
    return {
      log: (level: 'info' | 'warn' | 'error', text: string) => {
        b.log(level, text);
        if (level === 'error') b.telemetry('log_error', { error: text });
      },
      millis: () => Math.floor(b.now()),
      flip: () => this.present(),

      // lgfx
      lgfx_bind: (name: string) => {
        if (name !== 'main') return false;
        this.owner = 'lgfx';
        return true;
      },
      lg_fillScreen: (c: number) => d.fillScreen(c24(c)),
      lg_drawPixel: (x: number, y: number, c: number) => d.drawPixel(x, y, c24(c)),
      lg_drawLine: (x0: number, y0: number, x1: number, y1: number, c: number) => d.drawLine(x0, y0, x1, y1, c24(c)),
      lg_drawRect: (x: number, y: number, w: number, h: number, c: number) => d.drawRect(x, y, w, h, c24(c)),
      lg_fillRect: (x: number, y: number, w: number, h: number, c: number) => d.fillRect(x, y, w, h, c24(c)),
      lg_drawRoundRect: (x: number, y: number, w: number, h: number, r: number, c: number) => d.drawRoundRect(x, y, w, h, r, c24(c)),
      lg_fillRoundRect: (x: number, y: number, w: number, h: number, r: number, c: number) => d.fillRoundRect(x, y, w, h, r, c24(c)),
      lg_drawCircle: (x: number, y: number, r: number, c: number) => d.drawCircle(x, y, r, c24(c)),
      lg_fillCircle: (x: number, y: number, r: number, c: number) => d.fillCircle(x, y, r, c24(c)),
      lg_drawTriangle: (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) =>
        d.drawTriangle(x0, y0, x1, y1, x2, y2, c24(c)),
      lg_fillTriangle: (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) =>
        d.fillTriangle(x0, y0, x1, y1, x2, y2, c24(c)),
      lg_setTextColor: (fg: number, bg?: number | null) => d.setTextColor(c24(fg), bg == null ? undefined : c24(bg)),
      lg_setTextSize: (s: number) => d.setTextSize(Math.max(1, Math.round(s))),
      lg_setTextDatum: (v: number) => (this.datum = v),
      lg_setCursor: (x: number, y: number) => d.setCursor(x, y),
      lg_print: (s: string) => d.print(s),
      lg_drawString: (s: string, x: number, y: number) => this.drawString(s, x, y),
      lg_width: () => d.width(),
      lg_height: () => d.height(),
      lg_flip: () => this.present(),

      // screen (M5StickC Plus2 DisplayDriver)
      sc_clear: (r: number, g: number, bl: number) => d.fillScreen(c565(r, g, bl)),
      sc_text: (x: number, y: number, s: string, size: number, r: number, g: number, bl: number) => {
        d.setCursor(x, y);
        d.setTextColor(c565(r, g, bl));
        d.setTextSize(Math.max(1, size));
        d.print(s);
      },
      sc_fill_rect: (x: number, y: number, w: number, h: number, r: number, g: number, bl: number) => d.fillRect(x, y, w, h, c565(r, g, bl)),
      sc_rect: (x: number, y: number, w: number, h: number, r: number, g: number, bl: number) => d.drawRect(x, y, w, h, c565(r, g, bl)),
      sc_line: (x0: number, y0: number, x1: number, y1: number, r: number, g: number, bl: number) => d.drawLine(x0, y0, x1, y1, c565(r, g, bl)),
      sc_triangle: (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: number, g: number, bl: number) =>
        d.drawTriangle(x0, y0, x1, y1, x2, y2, c565(r, g, bl)),
      sc_fill_triangle: (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: number, g: number, bl: number) =>
        d.fillTriangle(x0, y0, x1, y1, x2, y2, c565(r, g, bl)),
      sc_pixel: (x: number, y: number, r: number, g: number, bl: number) => d.drawPixel(x, y, c565(r, g, bl)),
      sc_qr: (x: number, y: number, text: string, scale: number, r: number, g: number, bl: number) => {
        let qr: ReturnType<typeof qrcode> | null = null;
        for (let v = 3; v <= 10 && !qr; v++) {
          try {
            const q = qrcode(v as Parameters<typeof qrcode>[0], 'L');
            q.addData(text);
            q.make();
            qr = q;
          } catch {
            /* doesn't fit this version */
          }
        }
        if (!qr) throw new Error('screen.qr: text too long for QR v10');
        const s = Math.max(1, scale);
        const c = c565(r, g, bl);
        const n = qr.getModuleCount();
        for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) if (qr.isDark(py, px)) d.fillRect(x + px * s, y + py * s, s, s, c);
      },
      sc_set_brightness: (v: number) => d.setBrightness((Math.min(255, Math.max(0, v)) / 255) * 100),
      sc_width: () => d.width(),
      sc_height: () => d.height(),

      // imu, buzzer, button
      imu_accel: () => b.imu?.accel() ?? [0, 0, 1],
      imu_gyro: () => b.imu?.gyro() ?? [0, 0, 0],
      bz_beep: (f: number, ms: number) => b.buzzer?.beep(Math.min(20000, Math.max(20, f)), Math.min(5000, Math.max(0, ms))),
      bz_tone: (f: number) => b.buzzer?.tone(Math.min(20000, Math.max(20, f))),
      bz_stop: () => b.buzzer?.stop(),
      btn_press_count: () => this.taps,

      // Bench drivers. Each returns an error message, or undefined (nil in Lua; wasmoon chokes on a returned null).
      dial_new: (name: string, opts: Record<string, unknown>) => {
        if (!b.dial) return 'dial: this board has no dial driver';
        if (this.dials.has(name)) return undefined;
        const o = checkOpts('dial.new', opts, { label: 'string', min: 'number', max: 'number', step: 'number', start: 'number', wrap: 'boolean', via: 'string', connect: 'string', keys: 'object' });
        if (typeof o === 'string') return o;
        if (o.via !== undefined && !(String(o.via) in DIAL_VIA)) return `dial.new: via must be one of ${Object.keys(DIAL_VIA).map((v) => `"${v}"`).join(', ')}`;
        try {
          const dial = b.dial(name, { label: titleCase(name), ...o } as DialOptions);
          this.dials.set(name, { dial, last: dial.value });
          return undefined;
        } catch (e) {
          return `dial.new: ${e instanceof Error ? e.message : e}`;
        }
      },
      dial_value: (name: string) => this.dials.get(name)?.dial.value ?? 0,
      dial_delta: (name: string) => this.dials.get(name)?.dial.delta() ?? 0,
      dial_fraction: (name: string) => this.dials.get(name)?.dial.fraction ?? 0,
      trig_new: (name: string, opts: Record<string, unknown>) => {
        if (!b.trigger) return 'trigger: this board has no trigger driver';
        if (this.triggers.has(name)) return undefined;
        const o = checkOpts('trigger.new', opts, { label: 'string', key: 'string', via: 'string', connect: 'string' });
        if (typeof o === 'string') return o;
        if (o.via !== undefined && !(String(o.via) in TRIGGER_VIA)) return `trigger.new: via must be one of ${Object.keys(TRIGGER_VIA).map((v) => `"${v}"`).join(', ')}`;
        try {
          const trigger = b.trigger(name, { label: titleCase(name), ...o } as TriggerOptions);
          this.triggers.set(name, { trigger, presses: trigger.presses, releases: trigger.releases });
          return undefined;
        } catch (e) {
          return `trigger.new: ${e instanceof Error ? e.message : e}`;
        }
      },
      trig_is_pressed: (name: string) => !!this.triggers.get(name)?.trigger.isPressed(),
      trig_was_pressed: (name: string) => !!this.triggers.get(name)?.trigger.wasPressed(),
      trig_was_released: (name: string) => !!this.triggers.get(name)?.trigger.wasReleased(),
      trig_pressed_for: (name: string, ms: number) => !!this.triggers.get(name)?.trigger.pressedFor(ms),
      ld_begin: (opts: Record<string, unknown>) => {
        if (!b.radar) return 'ld2410: this board has no radar driver';
        if (this.radar) return undefined;
        const o = checkOpts('ld2410.begin', opts, { mode: 'string' });
        if (typeof o === 'string') return o;
        if (o.mode !== undefined && !['wander', 'approach', 'empty', 'manual'].includes(o.mode as string)) {
          return 'ld2410.begin: mode must be "wander", "approach", "empty" or "manual"';
        }
        this.radar = { r: b.radar(o as LD2410Options), state: -1 };
        return undefined;
      },
      ld_read: () => {
        const r = this.radar?.r;
        if (!r) return undefined;
        r.read();
        return {
          connected: r.isConnected(),
          moving: r.movingTargetDetected(),
          still: r.stationaryTargetDetected(),
          distance_cm: r.detectionDistance(),
          moving_cm: r.movingTargetDistance(),
          moving_energy: r.movingTargetEnergy(),
          still_cm: r.stationaryTargetDistance(),
          still_energy: r.stationaryTargetEnergy(),
          out: r.outPin(),
        };
      },

      // lvgl: the widget tree (lvgl.ts); handles, animations and timers live in lua/lvgl.lua.
      lv_claim: (name: string) => {
        if (name !== 'main') return false;
        if (!this.lv) {
          this.lv = new LvglScreen(d, (this.screenInfo().dpi as number | undefined) ?? 160, (text) => b.log('warn', text));
        }
        if (this.owner !== 'lvgl') this.lv.invalidateAll(); // take over: repaint every pixel
        this.owner = 'lvgl';
        return true;
      },
      lv_now: () => this.timeMs,
      lv_screen: () => this.lv!.screen.id,
      lv_res: () => [d.width(), d.height()],
      lv_create: (kind: string, parent?: number | null) => this.lv!.create(kind, parent ?? null),
      lv_set: (id: number, props: Record<string, unknown>) => this.lv!.set(id, props ?? {}),
      lv_get: (id: number, key: string) => this.lv!.getProp(id, key) ?? undefined,
      lv_align_to: (id: number, base: number | null | undefined, type: number, x: number, y: number) => this.lv!.alignTo(id, base ?? null, type, x, y),
      lv_delete: (id: number) => this.lv!.delete(id),
      lv_clean: (id: number) => this.lv!.clean(id),
      lv_flag: (id: number, f: number, on: boolean) => this.lv!.flag(id, f, on),
      lv_has_flag: (id: number, f: number) => this.lv!.hasFlag(id, f),
      lv_state: (id: number, st: number, on: boolean) => this.lv!.state(id, st, on),
      lv_has_state: (id: number, st: number) => this.lv!.hasState(id, st),
      lv_get_state: (id: number) => this.lv!.getState(id),
      lv_add_style: (id: number, props: Record<string, unknown>, selector?: number, sid?: number | null) =>
        this.lv!.addStyle(id, props ?? {}, selector ?? 0, sid),
      lv_update_style: (sid: number, props: Record<string, unknown>) => this.lv!.updateStyle(sid, props ?? {}),
      lv_remove_styles: (id: number) => this.lv!.removeStyles(id),
      lv_coords: (id: number) => this.lv!.coords(id),
      lv_parent: (id: number) => this.lv!.parentOf(id),
      lv_child_count: (id: number) => this.lv!.childCount(id),
      lv_invalidate: () => {
        this.lv!.dirty = true;
      },
      lv_theme: (theme: Record<string, Record<string, unknown>> | null | undefined) => this.lv!.setTheme(theme ?? null),

      // leds: the LED chain when the output is one (strip, ring, matrix), chain order row by row.
      led_size: () => (d.tech === 'led' ? [d.width(), d.height()] : undefined),
      led_set: (i: number, c: number) => {
        const w = d.width();
        if (i >= 0 && i < w * d.height()) d.drawPixel(i % w, Math.floor(i / w), c24(c));
      },
      led_get: (i: number) => {
        const w = d.width();
        if (i < 0 || i >= w * d.height()) return 0;
        const [r, g, bl] = rgb565ToRgb(d.getPixel(i % w, Math.floor(i / w)));
        return (r << 16) | (g << 8) | bl;
      },
      led_fill: (c: number, from: number, count: number) => {
        const w = d.width();
        const n = w * d.height();
        for (let i = Math.max(0, from); i < Math.min(n, from + count); i++) d.drawPixel(i % w, Math.floor(i / w), c24(c));
      },
      led_show: () => this.present(),
      led_brightness: (v: number) => d.setBrightness((Math.min(255, Math.max(0, v)) / 255) * 100),

      // The touch panel over the glass: undefined on a display without one.
      touch_read: () => {
        const t = d.touch;
        if (!t) return undefined;
        const [x, y] = d.fromNative(...t.point());
        return { pressed: t.isPressed(), x, y };
      },

      // light, pir, climate, touch: the part on the bench (put there if missing), read as a table.
      sensor_read: (kind: 'light' | 'pir' | 'climate' | 'touch') => {
        if (!b.sensor) return undefined;
        let s = this.sensors.get(kind);
        if (!s) {
          const part = b.sensor(kind);
          s = { part, last: kind === 'pir' ? (part as Pir).motion() : kind === 'touch' ? (part as Touch).isPressed() : false };
          this.sensors.set(kind, s);
        }
        const p = s.part;
        switch (kind) {
          case 'light':
            return { level: (p as LightSensor).level, lux: (p as LightSensor).lux(), raw: (p as LightSensor).read() };
          case 'pir':
            return { motion: (p as Pir).motion() };
          case 'climate':
            return { temperature: (p as Climate).readTemperature(), humidity: (p as Climate).readHumidity() };
          case 'touch':
            return { touched: (p as Touch).isPressed(), raw: (p as Touch).touchRead() };
        }
        return undefined;
      },

      // screens
      screens_list: () => [this.screenInfo()],
      screens_get: (name: string) => {
        if (name !== 'main') return undefined;
        const info: Record<string, unknown> = { ...this.screenInfo(), brightness: d.getBrightness() / 100 };
        if (d.tech === 'epaper') {
          info.busy = d.refreshing();
          info.pending = d.hasPendingChanges();
        }
        return info;
      },
      screens_set: (name: string, settings: Record<string, unknown>) => {
        if (name !== 'main') return `screens.set: no screen named '${name}'`;
        const keys = d.tech === 'lcd' || d.tech === 'amoled' || d.tech === 'led' ? ['brightness'] : d.tech === 'oled' ? ['brightness', 'contrast'] : [];
        for (const [k, v] of Object.entries(settings)) {
          if (!keys.includes(k)) return `screens.set: screen 'main' has no setting '${k}'`;
          if (typeof v !== 'number') return `screens.set: '${k}' must be a number`;
          d.setBrightness(Math.min(1, Math.max(0, v)) * 100);
        }
        return undefined;
      },
      screens_refresh: (name: string) => {
        if (name !== 'main' || d.tech !== 'epaper') return false;
        d.invalidate();
        this.track(d.show('full'));
        return true;
      },

      // events, store
      events_send: (name: string, json: string, keep: boolean): SendResult => {
        if (!name || new TextEncoder().encode(json).length > EVENT_JSON_MAX) return 'dropped';
        return b.publish(name, json, keep);
      },
      store_get: (k: string) => b.store.get(k) ?? undefined,
      store_set: (k: string, v: Scalar | null) => b.store.set(k, v),
      store_keys: () => b.store.keys(),
      store_clear: () => b.store.clear(),
      store_remaining: () => b.store.remaining(),

      // datetime primitives (see the header of lua/datetime.lua)
      dt_now: now,
      dt_now32: () => (I32(now()) ? now() : undefined),
      dt_split: (secs: number, local: boolean) => {
        const t = this.tm(secs, local);
        return [t.year, t.mon, t.mday, t.hour, t.min, t.sec];
      },
      dt_epoch: (year: number, mon: number, mday: number, hour: number, min: number, sec: number) => {
        const s = wallSeconds({ year, mon, mday, hour, min, sec });
        return I32(s) ? s : undefined;
      },
      dt_resolve: (year: number, mon: number, mday: number, hour: number, min: number, sec: number) => {
        const wall = wallSeconds({ year, mon, mday, hour, min, sec });
        if (!I32(wall < 0 ? wall + 86400 : wall - 86400)) return undefined;
        const r = b.zone().resolve(wall);
        return I32(r.utc) ? [r.utc, r.gmtoff, r.abbr] : undefined;
      },
      dt_ord: (y: number, m: number, dd: number) => daysFromCivil(y, m, dd) + ORDINAL_OFFSET,
      dt_civil: (n: number) => civilFromDays(n - ORDINAL_OFFSET),
      dt_strftime: (f: string, year: number, mon: number, mday: number, hour: number, min: number, sec: number, off?: number | null, zone?: string | null) => {
        const [wday, yday] = weekdayAndYearday(year, mon, mday);
        const hasZone = off !== undefined && off !== null;
        return strftime(f, { year, mon, mday, hour, min, sec, wday, yday, gmtoff: hasZone ? off : 0, zone: zone ?? '', hasZone });
      },
      dt_mul: (days: number, secs: number, n: number) => {
        let dd = days * n;
        let ss = secs * n;
        const carry = Math.floor(ss / 86400);
        dd += carry;
        ss -= carry * 86400;
        return dd < -999999999 || dd > 999999999 ? undefined : [dd, ss];
      },

      // the deprecated half of `time`
      tm_struct: (secs: number, local: boolean) => {
        const t = this.tm(secs, local);
        return {
          tm_year: t.year, tm_mon: t.mon, tm_mday: t.mday, tm_hour: t.hour, tm_min: t.min, tm_sec: t.sec,
          tm_wday: t.wday, tm_yday: t.yday, tm_isdst: local && t.gmtoff !== this.board.zone().at(secs - 182 * 86400).gmtoff ? 1 : 0,
          tm_zone: t.zone, tm_gmtoff: t.gmtoff,
        };
      },
      tm_mktime: (t: Record<string, number>) =>
        b.zone().resolve(wallSeconds({ year: t.tm_year, mon: t.tm_mon, mday: t.tm_mday, hour: t.tm_hour ?? 0, min: t.tm_min ?? 0, sec: t.tm_sec ?? 0 })).utc,
      tm_strftime: (f: string, t?: Record<string, number | string> | null) => {
        const s = t ? null : this.tm(now(), true);
        if (s) return strftime(f, s);
        const tt = t as Record<string, number>;
        const [wday, yday] = weekdayAndYearday(tt.tm_year, tt.tm_mon, tt.tm_mday);
        return strftime(f, {
          year: tt.tm_year, mon: tt.tm_mon, mday: tt.tm_mday, hour: tt.tm_hour ?? 0, min: tt.tm_min ?? 0, sec: tt.tm_sec ?? 0,
          wday, yday, gmtoff: tt.tm_gmtoff ?? 0, zone: String((t as Record<string, unknown>).tm_zone ?? ''), hasZone: true,
        });
      },
    };
  }
}

/** Option-table checks for the Bench drivers: only known keys, each of the right type. */
function checkOpts(fname: string, opts: Record<string, unknown> | null | undefined, schema: Record<string, string>): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts ?? {})) {
    if (!(k in schema)) return `${fname}: unknown option '${k}'`;
    if (v === null || v === undefined) continue;
    if (typeof v !== schema[k]) return `${fname}: option '${k}' must be a ${schema[k] === 'object' ? 'table' : schema[k]}`;
    out[k] = v;
  }
  return out;
}

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Clear the glass the way the board does on app reset. */
export function resetScreen(display: Display): Promise<void> {
  display.fillScreen(colors.BLACK);
  display.setTextColor(colors.WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.invalidate();
  return display.show();
}
