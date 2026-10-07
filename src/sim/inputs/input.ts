import type { SimClock } from '../clock';
import type { Bench } from '../controls/bench';

export interface InputContext {
  clock: SimClock;
  /** Where abstract controls find (and share) their hardware. */
  bench: Bench;
}

/** Declared by a sketch (`inputs: { fire: button() }`); the runner creates one instance per run. */
export interface InputSpec<T extends SimInput = SimInput> {
  create(ctx: InputContext): T;
}

export type InputKind = 'button' | 'knob' | 'pot' | 'ld2410' | 'imu' | 'buzzer' | 'light' | 'pir' | 'climate' | 'touch' | 'dial' | 'trigger';

/** Shared by the sketch (reads it) and the UI widget (drives it). */
export abstract class SimInput {
  abstract readonly kind: InputKind;
  name = '';
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(public label: string) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  protected changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
