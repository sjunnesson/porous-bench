import type { SimClock } from '../clock';
import { type InputSpec, SimInput } from './input';

export interface PirOptions {
  label?: string;
  /** How long the output stays high after the last motion (HC-SR501's delay pot), ms. */
  holdMs?: number;
}

/**
 * PIR motion sensor (HC-SR501 / AM312): a digital output that goes high on motion and stays high
 * for `holdMs` after the last movement (retriggering). The UI waves at it.
 */
export class Pir extends SimInput {
  readonly kind = 'pir';
  readonly holdMs: number;
  private lastMotion = -Infinity;
  private moving = false;

  constructor(
    opts: PirOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'PIR motion');
    this.holdMs = opts.holdMs ?? 2500;
  }

  // UI side
  /** Movement in front of it right now (held while the pointer is down), or a single wave. */
  setMoving(on: boolean): void {
    this.moving = on;
    this.lastMotion = this.clock.now();
    this.changed();
  }
  wave(): void {
    this.lastMotion = this.clock.now();
    this.changed();
  }

  // Sketch side
  /** The OUT pin: high while there's motion and for holdMs after. */
  motion(): boolean {
    if (this.moving) this.lastMotion = this.clock.now();
    return this.clock.now() - this.lastMotion < this.holdMs;
  }
  digitalRead(): 0 | 1 {
    return this.motion() ? 1 : 0;
  }
}

export const pir = (opts: PirOptions = {}): InputSpec<Pir> => ({ create: ({ clock }) => new Pir(opts, clock) });
