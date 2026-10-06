import type { SimClock } from '../clock';

export interface InputContext {
  clock: SimClock;
}

/** Declared by a sketch (`inputs: { fire: button() }`); the runner creates one instance per run. */
export interface InputSpec<T extends SimInput = SimInput> {
  create(ctx: InputContext): T;
}

export type InputKind = 'button' | 'knob' | 'pot' | 'ld2410' | 'imu' | 'buzzer';

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
