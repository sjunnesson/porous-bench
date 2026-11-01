import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';
import { KeySet } from './keys';

export interface KeypadOptions {
  label?: string;
}

/** A phone's layout, by row: what the 12-key capacitive keypads on an MPR121 have. */
export const KEYPAD_KEYS: { id: string; label: string }[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => ({ id: k, label: k })),
  { id: 'star', label: '*' },
  { id: '0', label: '0' },
  { id: 'hash', label: '#' },
];

/**
 * A 12-key capacitive keypad on an MPR121 (I2C): each pad is an electrode, and the chip reports which
 * are touched as 12 bits, so several can be touched at once. Each key is a channel of its own, and
 * `any` presses with all of them, carrying the key's name.
 */
export class Keypad extends SimInput {
  readonly kind = 'keypad';
  readonly keys: KeySet;
  readonly log = new EventLog();
  private touched = new Set<string>();
  private lastKey: string | null = null;

  constructor(
    opts: KeypadOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Keypad');
    this.keys = new KeySet({ pump: () => {}, press: (id, down) => this.press(id, down) }, KEYPAD_KEYS);
  }

  // UI side
  /** A pad touched or let go (`any`, from a trigger's keyboard key: 1). */
  press(id: string, down: boolean): void {
    if (id === 'any') id = '1';
    if (!KEYPAD_KEYS.some((k) => k.id === id) || this.touched.has(id) === down) return;
    if (down) {
      this.touched.add(id);
      this.lastKey = id;
    } else this.touched.delete(id);
    this.keys.edge(id, down, this.clock.now());
    this.log.push('key', { key: id, pressed: down });
    this.changed();
  }
  isTouched(id: string): boolean {
    return this.touched.has(id);
  }

  // Sketch side
  /** The keys touched now, in the keypad's order; the last one pressed; the chip's 12-bit touch status. */
  read(): { keys: string[]; last: string | null; mask: number } {
    const keys = KEYPAD_KEYS.filter((k) => this.touched.has(k.id)).map((k) => k.id);
    const mask = KEYPAD_KEYS.reduce((m, k, i) => (this.touched.has(k.id) ? m | (1 << i) : m), 0);
    return { keys, last: this.lastKey, mask };
  }
}
