import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';
import { KeySet } from './keys';

export interface MicOptions {
  label?: string;
}

/** The driver's blocks: 512 samples at 16 kHz. */
export const BLOCK_MS = 32;
/** Octave bands, by centre frequency (Hz): what a 512-point FFT at 16 kHz resolves from 63 Hz up. */
export const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
/** What the level channel (and `level` in Lua) spans: a quiet room to a shout at arm's length, dB SPL. */
export const LEVEL_RANGE: [number, number] = [30, 100];
/** What `bands` in Lua span, each octave's share of a sound sitting lower than the whole. */
export const BAND_RANGE: [number, number] = [20, 90];
/** The INMP441's self-noise, dB(A) SPL, and its acoustic overload point. */
const FLOOR = 33;
const OVERLOAD = 120;
/**
 * A clap, to the driver: sharp and broadband, so it listens from 1 kHz up, where a kick drum or a
 * voice hardly reaches: a block this far over the background there, and loud, and the next block
 * CLAP_DROP quieter again (a room that just got loud, music starting, stays loud). The background
 * follows the level in dB, rising at most RISE and falling at most FALL a block, so it settles where
 * the sound mostly is (music, a busy room) and a clap hardly moves it.
 */
const RISE = 1;
const FALL = 2;
const CLAP_RISE = 15;
const CLAP_MIN = 70;
const CLAP_DROP = 12;
const CLAP_FROM = 4; // the 1 kHz band
const CLAP_REFRACTORY = 150;

/** A room's background noise, by band, relative to its overall level: more energy low down. */
const ROOM = [0, -1, -2, -3, -5, -7, -10, -14];
const ROOM_SUM = 10 * Math.log10(ROOM.reduce((s, o) => s + 10 ** (o / 10), 0));

const sumDb = (dbs: number[]) => 10 * Math.log10(dbs.reduce((s, d) => s + 10 ** (d / 10), 0));
/** The same small offset for the same block and band, so reads within a block agree. */
function jitter(block: number, band: number): number {
  const x = Math.sin(block * 12.9898 + band * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2; // ±1 dB
}

export interface MicBlock {
  /** Overall level, dB SPL. */
  db: number;
  /** Per octave band, dB SPL. */
  bands: number[];
}

/**
 * Microphone (an INMP441 I2S MEMS mic, or a board's own): the sound level and its spectrum, as Bench's
 * driver works them out from 512-sample blocks at 16 kHz (32 ms each), in dB SPL. The INMP441 reads
 * -26 dBFS at 94 dB SPL, so dB SPL is dBFS + 120, from its self-noise (~33 dB) to its overload (120).
 * The sound comes from the UI: a room's level, claps, music (a 120 bpm beat), or this computer's own
 * microphone. The driver calls a block a clap when, from 1 kHz up, it's 15 dB over the background
 * and over 70 dB, and the next is 12 dB under it: it hears a clap a block (32 ms) after it lands.
 */
export class Mic extends SimInput {
  readonly kind = 'mic';
  /** `clap`: a press the moment the driver hears one, let go 100 ms later. */
  readonly keys: KeySet;
  readonly log = new EventLog();
  private room = 40;
  private music = false;
  private claps: number[] = [];
  private live: { bands: number[]; at: number } | null = null;
  private block = -1;
  /** The detector's background from 1 kHz up, dB SPL. */
  private background = 30;
  private lastClap = -Infinity;
  private clapUp: number | null = null;
  /** A block loud enough for a clap, waiting on the next to fall away. */
  private candidate: { t: number; db: number; high: number } | null = null;
  private current: MicBlock = { db: 40, bands: BANDS.map(() => 40 - ROOM_SUM) };

  constructor(
    opts: MicOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Microphone');
    this.keys = new KeySet({ pump: () => this.pump(), press: (_, down) => down && this.clap() }, [{ id: 'clap', label: 'clap' }]);
    this.block = Math.floor(clock.now() / BLOCK_MS) - 1;
  }

  // ---- UI side ----
  /** The room's background level, dB SPL. */
  setRoom(db: number): void {
    this.room = Math.min(LEVEL_RANGE[1], Math.max(LEVEL_RANGE[0], db));
    this.changed();
  }
  get roomLevel(): number {
    return this.room;
  }
  setMusic(on: boolean): void {
    this.music = on;
    this.changed();
  }
  get playing(): boolean {
    return this.music;
  }
  /** Clap your hands in front of it, now. */
  clap(): void {
    this.claps.push(this.clock.now());
    if (this.claps.length > 8) this.claps.shift();
    this.changed();
  }
  /** What this computer's microphone hears, per band in dB SPL (uncalibrated); null to stop. */
  setLive(bands: number[] | null): void {
    this.live = bands ? { bands, at: this.clock.now() } : null;
  }
  get listening(): boolean {
    return this.live !== null;
  }

  // ---- sketch side ----
  /** The latest block. */
  read(): MicBlock {
    this.pump();
    return this.current;
  }
  /** The level, 0..1 across LEVEL_RANGE. */
  level(): number {
    const db = this.read().db;
    return Math.min(1, Math.max(0, (db - LEVEL_RANGE[0]) / (LEVEL_RANGE[1] - LEVEL_RANGE[0])));
  }

  /** Every block finished since the last read, in order: the clap detector sees each one. */
  private pump() {
    const now = this.clock.now();
    const last = Math.floor(now / BLOCK_MS) - 1; // the one being recorded isn't done yet
    // A long gap (paused, a sleeping tab): only the last second matters to the detector.
    for (let b = Math.max(this.block + 1, last - 32); b <= last; b++) this.process(b);
    this.block = Math.max(this.block, last);
    this.letGo(now);
  }

  /** A clap's press ends 100 ms after it. */
  private letGo(t: number) {
    if (this.clapUp === null || t < this.clapUp) return;
    this.keys.edge('clap', false, this.clapUp);
    this.clapUp = null;
  }

  private process(block: number) {
    const t = block * BLOCK_MS;
    this.letGo(t);
    const bands = this.sound(t, block);
    const db = Math.min(OVERLOAD, sumDb(bands));
    this.current = { db: Math.round(db * 10) / 10, bands: bands.map((d) => Math.round(Math.min(OVERLOAD, d) * 10) / 10) };
    const high = sumDb(bands.slice(CLAP_FROM));
    const c = this.candidate;
    this.candidate = null;
    if (c && high <= c.high - CLAP_DROP) {
      this.lastClap = c.t;
      this.keys.edge('clap', true, c.t);
      this.clapUp = c.t + 100;
      this.log.push('clap', { db: c.db });
    } else if (high - this.background > CLAP_RISE && high > CLAP_MIN && t - this.lastClap > CLAP_REFRACTORY) {
      this.candidate = { t, db: this.current.db, high };
    }
    this.background += Math.min(RISE, Math.max(-FALL, high - this.background));
  }

  /** What reaches the mic in the block starting at t, per band (dB SPL). */
  private sound(t: number, block: number): number[] {
    const live = this.live && this.clock.now() - this.live.at < 250 ? this.live.bands : null;
    return BANDS.map((_, i) => {
      const parts = [live ? live[i] : this.room - ROOM_SUM + ROOM[i], FLOOR - ROOM_SUM + ROOM[i]];
      if (this.music && !live) {
        const beat = t % 500;
        if (i <= 1) parts.push(beat < 96 ? 86 - beat / 8 : 60); // the kick on every beat
        if (i >= 1 && i <= 3) parts.push(66); // the bass
        if (i >= 3 && i <= 6) parts.push(60); // pads and voices, filling the highs between hits
        if (i >= 3 && i <= 5 && Math.floor(t / 500) % 2 === 1 && beat < 64) parts.push(72 - beat / 6); // the snare on 2 and 4
        if (i >= 6 && t % 125 < 32) parts.push(68); // the hi-hat on every eighth
      }
      for (const c of this.claps) {
        if (c >= t && c < t + BLOCK_MS) parts.push(i >= 3 ? 97 : 88); // the block the clap lands in
        else if (c >= t - BLOCK_MS && c < t) parts.push(i >= 3 ? 72 : 64); // its tail in the next
      }
      return sumDb(parts) + jitter(block, i);
    });
  }
}
