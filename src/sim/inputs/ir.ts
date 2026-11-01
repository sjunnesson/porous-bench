import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';
import { KeySet } from './keys';

export interface IrOptions {
  label?: string;
}

/**
 * The 17-key remote in most Arduino kits, as it lies (arrows and OK, then the digits): NEC, address
 * 0x00, a command per key. Codes as the kits' sketches print them; not yet checked against one.
 */
export const REMOTE_KEYS: { id: string; label: string; code: number }[] = [
  { id: 'up', label: '▲', code: 0x18 },
  { id: 'left', label: '◀', code: 0x08 },
  { id: 'ok', label: 'OK', code: 0x1c },
  { id: 'right', label: '▶', code: 0x5a },
  { id: 'down', label: '▼', code: 0x52 },
  { id: '1', label: '1', code: 0x45 },
  { id: '2', label: '2', code: 0x46 },
  { id: '3', label: '3', code: 0x47 },
  { id: '4', label: '4', code: 0x44 },
  { id: '5', label: '5', code: 0x40 },
  { id: '6', label: '6', code: 0x43 },
  { id: '7', label: '7', code: 0x07 },
  { id: '8', label: '8', code: 0x15 },
  { id: '9', label: '9', code: 0x09 },
  { id: 'star', label: '*', code: 0x16 },
  { id: '0', label: '0', code: 0x19 },
  { id: 'hash', label: '#', code: 0x0d },
];
export const REMOTE_ADDRESS = 0x00;

/** NEC: a full frame (9 ms burst, 4.5 ms space, 32 bits, stop bit), decoded as it ends. */
const FRAME_MS = 67.5;
/** While a key is held, a short repeat code every 108 ms from the frame's start. */
const REPEAT_MS = 108;
const REPEAT_FRAME_MS = 11.8;
/** The driver lets a key go when no repeat has come for this long. */
const RELEASE_MS = 120;

/** One press on the remote: what it sends from t0 until the key goes up (t1). */
interface Transmission {
  key: string;
  t0: number;
  t1?: number;
  decoded: boolean;
  repeats: number;
  /** When the latest frame or repeat was decoded. */
  last: number;
}

/**
 * IR receiver (VS1838B, 38 kHz) and the kit's remote. Pressing a key on the remote sends an NEC frame,
 * which the driver decodes 67.5 ms later: the key goes down then. Held, the remote sends a repeat code
 * every 108 ms; let go, the driver lets the key go 120 ms after the last one (a new key's frame ends
 * the last key sooner). A remote sends one key at a time: a second key held with the first is ignored.
 * Each key is a channel of its own, and `any` presses with all of them, carrying the key's name.
 */
export class IrReceiver extends SimInput {
  readonly kind = 'ir';
  readonly keys: KeySet;
  readonly log = new EventLog();
  private txs: Transmission[] = [];
  private held: string | null = null;
  private lastKey: string | null = null;

  constructor(
    opts: IrOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'IR receiver');
    this.keys = new KeySet({ pump: () => this.pump(), press: (id, down) => this.press(id, down) }, REMOTE_KEYS);
  }

  // ---- UI side ----
  /** A key on the remote goes down or up (`any`, from a trigger's keyboard key: OK). */
  press(id: string, down: boolean): void {
    if (id === 'any') id = 'ok';
    const now = this.clock.now();
    const sending = this.txs.find((t) => t.t1 === undefined);
    if (down) {
      if (sending || !REMOTE_KEYS.some((k) => k.id === id)) return;
      this.txs.push({ key: id, t0: now, decoded: false, repeats: 0, last: now });
    } else if (sending?.key === id) sending.t1 = now;
    this.changed();
  }
  /** The key the remote is sending right now, for the UI. */
  get sending(): string | null {
    return this.txs.find((t) => t.t1 === undefined)?.key ?? null;
  }

  // ---- sketch side ----
  /** The key the driver holds down now, and the last one it decoded. */
  read(): { key: string | null; last: string | null } {
    this.pump();
    return { key: this.held, last: this.lastKey };
  }

  /** Everything the remote sent up to now, decoded in order. */
  private pump() {
    const now = this.clock.now();
    for (;;) {
      const tx = this.txs[0];
      if (!tx) return;
      if (!tx.decoded) {
        const t = tx.t0 + FRAME_MS;
        if (t > now) return;
        tx.decoded = true;
        tx.last = t;
        this.held = this.lastKey = tx.key;
        this.keys.edge(tx.key, true, t);
        this.decoded(tx.key, false);
        continue;
      }
      const start = tx.t0 + REPEAT_MS * (tx.repeats + 1);
      const repeatAt = tx.t1 === undefined || start < tx.t1 ? start + REPEAT_FRAME_MS : Infinity;
      const next = this.txs[1];
      const releaseAt = Math.min(tx.last + RELEASE_MS, next ? next.t0 + FRAME_MS : Infinity);
      if (repeatAt <= releaseAt) {
        if (repeatAt > now) return;
        tx.repeats++;
        tx.last = repeatAt;
        this.decoded(tx.key, true);
        continue;
      }
      if (releaseAt > now) return;
      this.keys.edge(tx.key, false, releaseAt);
      this.held = null;
      this.txs.shift();
    }
  }

  /** `held`: a repeat code, sent because the key is still down (not `repeat`, a word Lua keeps for itself). */
  private decoded(key: string, held: boolean) {
    const code = REMOTE_KEYS.find((k) => k.id === key)!.code;
    this.log.push('ir', { key, code, address: REMOTE_ADDRESS, held });
  }
}
