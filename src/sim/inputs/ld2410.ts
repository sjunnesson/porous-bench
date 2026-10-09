// HLK-LD2410 24 GHz presence radar, simulated at the UART level. The virtual sensor emits real
// "basic target" report frames at 10 Hz into a serial buffer; the sketch parses them exactly
// like firmware would. The sketch-facing API mirrors the popular Arduino `ld2410` library.
//
// Frame (23 bytes): F4 F3 F2 F1 | len=0x000D (LE) | 02 AA | state | movDist(LE16) movEnergy |
//                   statDist(LE16) statEnergy | detectDist(LE16) | 55 00 | F8 F7 F6 F5

import type { SimClock } from '../clock';
import { SimInput } from './input';

export interface LD2410Report {
  /** bit0 = moving target, bit1 = stationary target */
  state: number;
  movingDistance: number; // cm
  movingEnergy: number; // 0..100
  stationaryDistance: number; // cm
  stationaryEnergy: number; // 0..100
  detectionDistance: number; // cm
}

const HEADER = [0xf4, 0xf3, 0xf2, 0xf1];
const FOOTER = [0xf8, 0xf7, 0xf6, 0xf5];

export function encodeReport(r: LD2410Report): Uint8Array {
  const le = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const payload = [
    0x02, 0xaa, r.state,
    ...le(r.movingDistance), r.movingEnergy,
    ...le(r.stationaryDistance), r.stationaryEnergy,
    ...le(r.detectionDistance),
    0x55, 0x00,
  ];
  return Uint8Array.from([...HEADER, ...le(payload.length), ...payload, ...FOOTER]);
}

/** Byte-at-a-time frame parser, the same state machine you'd write for Serial1 on the ESP32. */
export class LD2410Parser {
  private buf: number[] = [];

  /** Feed one byte; returns a report when a complete, valid frame ends. */
  push(b: number): LD2410Report | null {
    const buf = this.buf;
    buf.push(b);
    // Resync on the header.
    for (let i = 0; i < Math.min(buf.length, 4); i++)
      if (buf[i] !== HEADER[i]) {
        buf.splice(0, i + 1);
        return null;
      }
    if (buf.length < 6) return null;
    const len = buf[4] | (buf[5] << 8);
    if (len > 64) {
      buf.length = 0;
      return null;
    }
    const total = 6 + len + 4;
    if (buf.length < total) return null;
    const frame = buf.splice(0, total);
    if (!FOOTER.every((v, i) => frame[6 + len + i] === v)) return null;
    const p = frame.slice(6, 6 + len);
    if ((p[0] !== 0x01 && p[0] !== 0x02) || p[1] !== 0xaa) return null;
    return {
      state: p[2],
      movingDistance: p[3] | (p[4] << 8),
      movingEnergy: p[5],
      stationaryDistance: p[6] | (p[7] << 8),
      stationaryEnergy: p[8],
      detectionDistance: p[9] | (p[10] << 8),
    };
  }
}

export type RadarMode = 'manual' | 'wander' | 'approach' | 'empty';

export interface LD2410Options {
  label?: string;
  /** Report interval in ms (the module sends ~10 frames/s). */
  intervalMs?: number;
  /** How long presence is held after the target disappears ("no-one duration", default 5 s). */
  holdMs?: number;
  mode?: RadarMode;
}

export const MAX_RANGE_M = 6; // 8 gates × 0.75 m
/** Walking pace when sent somewhere, m/s. */
export const WALK_SPEED = 1.2;
export const FOV_DEG = 120;
const UART_CAPACITY = 1024;

export class LD2410 extends SimInput {
  readonly kind = 'ld2410';
  readonly intervalMs: number;
  readonly holdMs: number;
  mode: RadarMode;
  /** Target position in metres. Sensor at the origin, facing +y. */
  person = { x: 0.4, y: 2.2 };
  /** Bytes the sensor has sent that the sketch hasn't read yet. */
  private uart: number[] = [];
  private overflowed = 0;
  private parser = new LD2410Parser();
  private nextFrameAt = 0;
  private frameIndex = 0;
  private lastDetectedAt = -Infinity;
  private lastReport: LD2410Report | null = null;
  private lastFrameAt = -Infinity;
  private lastFrameBytes: Uint8Array | null = null;
  private history: { t: number; x: number; y: number }[] = [];
  /** Where the person is walking to (manual mode), and when they last took a step. */
  private goal: { x: number; y: number } | null = null;
  private lastStep = 0;
  private current: LD2410Report = emptyReport();

  constructor(
    opts: LD2410Options,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'LD2410 radar');
    this.intervalMs = opts.intervalMs ?? 100;
    this.holdMs = opts.holdMs ?? 5000;
    this.mode = opts.mode ?? 'wander';
    this.nextFrameAt = clock.now();
  }

  // ---- UI side ------------------------------------------------------------------------------

  setMode(mode: RadarMode): void {
    this.mode = mode;
    this.history = [];
    this.changed();
  }

  /** Put the target somewhere directly, e.g. while dragging or carrying it (switches to manual). */
  movePerson(x: number, y: number): void {
    if (this.mode !== 'manual') this.mode = 'manual';
    this.goal = null;
    this.person = { x, y };
    this.history.push({ t: this.clock.now(), x, y });
    this.changed();
  }

  /** Send the person walking to a spot at walking pace (switches to manual). */
  walkTo(x: number, y: number): void {
    if (this.mode !== 'manual') {
      this.target(); // settle where a scripted mode left them
      this.mode = 'manual';
    }
    this.goal = { x, y };
    this.lastStep = this.clock.now();
    this.changed();
  }

  /** Where the person is heading, if they're walking somewhere. */
  walkGoal(): { x: number; y: number } | null {
    return this.goal;
  }

  /** Target position, presence and speed right now (for drawing). */
  target(now = this.clock.now()): { x: number; y: number; present: boolean; speed: number } {
    if (this.mode === 'empty') return { ...this.person, present: false, speed: 0 };
    if (this.mode === 'manual') {
      this.step(now);
      this.history = this.history.filter((h) => now - h.t < 400);
      const old = this.history[0];
      const speed = old && now - old.t > 30 ? Math.hypot(this.person.x - old.x, this.person.y - old.y) / ((now - old.t) / 1000) : 0;
      return { ...this.person, present: true, speed };
    }
    const p0 = scripted(this.mode, now - 150);
    const p1 = scripted(this.mode, now);
    this.person = { x: p1.x, y: p1.y };
    return { ...p1, speed: Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.15 };
  }

  /** Advance a walk towards the goal by the sim time since the last step. */
  private step(now: number) {
    if (!this.goal) return;
    const dt = (now - this.lastStep) / 1000;
    if (dt <= 0) return; // time asked about is in the past (backfilling frames): no step
    this.lastStep = now;
    const dx = this.goal.x - this.person.x;
    const dy = this.goal.y - this.person.y;
    const d = Math.hypot(dx, dy);
    const stride = WALK_SPEED * dt;
    if (d <= stride) {
      this.person = { ...this.goal };
      this.goal = null;
    } else this.person = { x: this.person.x + (dx / d) * stride, y: this.person.y + (dy / d) * stride };
    this.history.push({ t: now, x: this.person.x, y: this.person.y });
  }

  /** Latest report the sensor produced, and the raw bytes of that frame. */
  latest(): { report: LD2410Report; bytes: Uint8Array | null; overflowed: number } {
    return { report: this.current, bytes: this.lastFrameBytes, overflowed: this.overflowed };
  }

  // ---- Sketch side (same names as the Arduino `ld2410` library) -----------------------------

  /** Parse whatever arrived on the UART. Call it every loop; returns true if a new frame was decoded. */
  read(): boolean {
    this.pump();
    let got = false;
    while (this.uart.length) {
      const r = this.parser.push(this.uart.shift()!);
      if (r) {
        this.lastReport = r;
        this.lastFrameAt = this.clock.now();
        got = true;
      }
    }
    return got;
  }
  isConnected(): boolean {
    return this.clock.now() - this.lastFrameAt < 1000;
  }
  presenceDetected(): boolean {
    return (this.lastReport?.state ?? 0) !== 0;
  }
  movingTargetDetected(): boolean {
    return ((this.lastReport?.state ?? 0) & 1) !== 0;
  }
  stationaryTargetDetected(): boolean {
    return ((this.lastReport?.state ?? 0) & 2) !== 0;
  }
  movingTargetDistance(): number {
    return this.lastReport?.movingDistance ?? 0;
  }
  movingTargetEnergy(): number {
    return this.lastReport?.movingEnergy ?? 0;
  }
  stationaryTargetDistance(): number {
    return this.lastReport?.stationaryDistance ?? 0;
  }
  stationaryTargetEnergy(): number {
    return this.lastReport?.stationaryEnergy ?? 0;
  }
  detectionDistance(): number {
    return this.lastReport?.detectionDistance ?? 0;
  }
  /** The module's OUT pin: high while presence is reported. */
  outPin(): boolean {
    this.pump();
    return this.current.state !== 0;
  }

  // Raw serial access, for writing your own parser (Serial1.available()/read()).
  available(): number {
    this.pump();
    return this.uart.length;
  }
  readByte(): number {
    this.pump();
    return this.uart.length ? this.uart.shift()! : -1;
  }

  // ---- sensor model -------------------------------------------------------------------------

  private pump() {
    const now = this.clock.now();
    if (now - this.nextFrameAt > 2000) this.nextFrameAt = now - 2000; // don't backfill forever
    let emitted = false;
    while (this.nextFrameAt <= now) {
      const report = this.measure(this.nextFrameAt);
      const bytes = encodeReport(report);
      for (const b of bytes) this.uart.push(b);
      if (this.uart.length > UART_CAPACITY) {
        this.overflowed += this.uart.length - UART_CAPACITY;
        this.uart.splice(0, this.uart.length - UART_CAPACITY);
      }
      this.current = report;
      this.lastFrameBytes = bytes;
      this.nextFrameAt += this.intervalMs;
      emitted = true;
    }
    if (emitted) this.changed();
  }

  private measure(t: number): LD2410Report {
    const i = this.frameIndex++;
    const n = (k: number) => noise(i, k);
    const tg = this.target(t);
    const dist = Math.hypot(tg.x, tg.y);
    const angle = (Math.atan2(tg.x, tg.y) * 180) / Math.PI;
    const visible = tg.present && dist <= MAX_RANGE_M && Math.abs(angle) <= FOV_DEG / 2;

    const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    const movingEnergy = visible && tg.speed > 0.08 ? clamp(25 + tg.speed * 45 + 15 * (1 - dist / MAX_RANGE_M) + n(1) * 6) : clamp(3 + n(1) * 3);
    const stationaryEnergy = visible ? clamp(100 - dist * 11 + n(2) * 5) : clamp(4 + n(2) * 3);
    const moving = movingEnergy >= 30;
    const stationary = stationaryEnergy >= 30;
    let state = (moving ? 1 : 0) | (stationary ? 2 : 0);
    let movingDistance = moving ? Math.max(0, Math.round(dist * 100 + n(3) * 6)) : 0;
    let stationaryDistance = stationary ? Math.max(0, Math.round(dist * 100 + n(4) * 4)) : 0;

    if (state) this.lastDetectedAt = t;
    else if (t - this.lastDetectedAt < this.holdMs && this.current.state) {
      // Presence is held for the "no-one duration" after the target is lost.
      state = 2;
      stationaryDistance = this.current.stationaryDistance || this.current.movingDistance;
    }
    if (!state) movingDistance = stationaryDistance = 0;
    return {
      state,
      movingDistance,
      movingEnergy,
      stationaryDistance,
      stationaryEnergy,
      detectionDistance: Math.max(movingDistance, stationaryDistance),
    };
  }
}

function emptyReport(): LD2410Report {
  return { state: 0, movingDistance: 0, movingEnergy: 0, stationaryDistance: 0, stationaryEnergy: 0, detectionDistance: 0 };
}

/** Deterministic noise in -1..1. */
function noise(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Hands-free target motion. 'wander' alternates walking and standing; 'approach' walks in, waits, leaves. */
function scripted(mode: RadarMode, t: number): { x: number; y: number; present: boolean } {
  if (mode === 'approach') {
    const c = ((t % 20000) + 20000) % 20000;
    const ease = (u: number) => u * u * (3 - 2 * u);
    if (c < 6000) return { x: 0.3, y: 5.6 - 5 * ease(c / 6000), present: true };
    if (c < 10000) return { x: 0.3, y: 0.6, present: true };
    if (c < 16000) return { x: 0.3 + 1.5 * ease((c - 10000) / 6000), y: 0.6 + 6 * ease((c - 10000) / 6000), present: true };
    return { x: 1.8, y: 6.6, present: false };
  }
  // wander: walk 4 s, stand 3 s
  const cycle = Math.floor(t / 7000);
  const tau = (cycle * 4000 + Math.min(((t % 7000) + 7000) % 7000, 4000)) / 1000;
  return {
    x: 1.5 * Math.sin(tau * 0.45) + 0.3 * Math.sin(tau * 1.3),
    y: 3.0 + 1.9 * Math.sin(tau * 0.31 + 1) + 0.3 * Math.cos(tau * 0.9),
    present: true,
  };
}
