import type { Bench } from './controls/bench';
import type { DeviceProfile } from './devices/types';
import type { Display } from './display';
import type { InputSpec, SimInput } from './inputs/input';

export type InputSpecs = Record<string, InputSpec<SimInput>>;
export type InputsOf<S extends InputSpecs> = { [K in keyof S]: ReturnType<S[K]['create']> };

export interface SketchContext<I = Record<string, SimInput>> {
  display: Display;
  inputs: I;
  device: DeviceProfile;
  /** Milliseconds since this sketch started (Arduino millis()). */
  millis(): number;
  /** Arduino delay(): `await delay(16)`. */
  delay(ms: number): Promise<void>;
  /**
   * Add hardware while running (a Lua app declaring a dial, say). Returns the existing input when
   * `name` is already declared with the same kind.
   */
  declare<T extends SimInput>(name: string, spec: InputSpec<T>): T;
  /** The parts on the desk (an app can ask for a sensor that isn't there yet). */
  bench: Bench;
  /** Shows up in the console panel. */
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * A sketch is setup() + loop(), like Arduino. Both may be async; `await` delays and show()
 * so time behaves like it does on the device. If loop() leaves unshown changes, the runner
 * calls display.show() after it.
 */
export interface Sketch<S extends InputSpecs = InputSpecs> {
  name: string;
  description?: string;
  inputs?: S;
  /** Default true: the runner calls display.show() after loop() if anything changed. */
  autoShow?: boolean;
  setup?(ctx: SketchContext<InputsOf<S>>): void | Promise<void>;
  loop(ctx: SketchContext<InputsOf<S>>): void | Promise<void>;
  /** Called once when the run stops (restart, sketch/device switch). */
  teardown?(ctx: SketchContext<InputsOf<S>>): void;
}

export function defineSketch<S extends InputSpecs = {}>(sketch: Sketch<S>): Sketch<S> {
  return sketch;
}
