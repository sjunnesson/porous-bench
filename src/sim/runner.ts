import { type SimClock, SketchStopped, yieldToBrowser } from './clock';
import type { DeviceProfile } from './devices/types';
import { Bench } from './controls/bench';
import { type Control, isControl } from './controls/controls';
import { Display } from './display';
import type { SimInput } from './inputs/input';
import type { InputSpec } from './inputs/input';
import type { InputSpecs, Sketch, SketchContext } from './sketch';

export interface LogLine {
  t: number;
  text: string;
  level: 'log' | 'warn' | 'error';
}

export interface RunCallbacks {
  onLog?(line: LogLine): void;
  onError?(err: unknown): void;
  /** The hardware the user last picked for a control, applied as the control appears. */
  bindingFor?(control: string): string | null;
}

/** One boot of a sketch on a device: fresh display, fresh inputs, millis() from 0. */
export class SketchRun {
  readonly display: Display;
  readonly inputs: Record<string, SimInput>;
  /** The parts on the desk: yours (shared across runs when the app passes one in) plus declared ones. */
  readonly bench: Bench;
  /** Abstract controls (dial, trigger), whose hardware the user can swap. */
  readonly controls: Control[] = [];
  /** Concrete hardware the sketch declared itself. */
  readonly declared: SimInput[] = [];
  private abort = new AbortController();
  private startMs: number;
  /** Simulated time when loop() last began: while paused, a Step that moves past it runs loop() again. */
  private loopAt = 0;
  private ctx: SketchContext;

  constructor(
    readonly sketch: Sketch<InputSpecs>,
    readonly device: DeviceProfile,
    private clock: SimClock,
    private cb: RunCallbacks = {},
    bench?: Bench,
  ) {
    this.startMs = clock.now();
    this.display = new Display(device, clock, this.abort.signal);
    this.inputs = {};
    this.bench = bench ?? new Bench(clock);
    for (const [name, spec] of Object.entries(sketch.inputs ?? {})) this.addInput(name, spec);
    this.ctx = {
      display: this.display,
      inputs: this.inputs,
      device,
      millis: () => Math.floor(this.clock.now() - this.startMs),
      delay: (ms) => this.clock.sleep(ms, this.abort.signal),
      declare: (name, spec) => this.addInput(name, spec),
      bench: this.bench,
      log: (...args) => this.log('log', args),
      warn: (...args) => this.log('warn', args),
      error: (...args) => this.log('error', args),
    };
  }

  /** Create an input and put it on the bench; a control picks up the user's saved hardware. */
  addInput<T extends SimInput>(name: string, spec: InputSpec<T>): T {
    const existing = this.inputs[name];
    const input = spec.create({ clock: this.clock, bench: this.bench });
    if (existing) {
      if (existing.kind === input.kind) {
        if (isControl(input)) input.detach();
        return existing as T;
      }
      if (isControl(input)) input.detach();
      throw new Error(`'${name}' is already declared as a ${existing.kind}`);
    }
    input.name = name;
    this.inputs[name] = input;
    if (isControl(input)) {
      this.controls.push(input);
      const saved = this.cb.bindingFor?.(name);
      if (saved) input.bind(saved);
    } else {
      this.declared.push(input);
      this.bench.addDeclared(input);
    }
    return input;
  }

  get stopped(): boolean {
    return this.abort.signal.aborted;
  }

  millis(): number {
    return this.ctx.millis();
  }

  async start(): Promise<void> {
    try {
      await this.sketch.setup?.(this.ctx);
      await this.flush();
      this.loopAt = this.clock.now();
      while (!this.stopped) {
        await this.whilePaused();
        this.loopAt = this.clock.now();
        await this.sketch.loop(this.ctx);
        await this.flush();
        // Keep the page responsive even if loop() never awaits anything.
        await yieldToBrowser();
      }
    } catch (err) {
      if (err instanceof SketchStopped || this.stopped) return;
      this.log('error', [err instanceof Error ? (err.stack ?? err.message) : err]);
      this.cb.onError?.(err);
    } finally {
      try {
        this.sketch.teardown?.(this.ctx);
      } catch (err) {
        console.error(err);
      }
    }
  }

  stop(): void {
    this.abort.abort();
    // The bench outlives the run: let go of its parts.
    for (const c of this.controls) c.detach();
  }

  private async flush() {
    if (this.sketch.autoShow === false) return;
    if (!this.stopped && this.display.hasPendingChanges()) await this.display.show();
  }

  /**
   * Hold the loop while paused, until resumed or stepped. Time is frozen while paused, so a loop
   * that delays waits for the next Step on its own; this stops one that never delays from spinning.
   */
  private whilePaused(): Promise<void> {
    const free = () => !this.clock.paused || this.clock.now() !== this.loopAt;
    if (free()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const off = this.clock.onChange(() => {
        if (free()) {
          off();
          resolve();
        }
      });
      this.abort.signal.addEventListener('abort', () => {
        off();
        reject(new SketchStopped());
      });
    });
  }

  private log(level: LogLine['level'], args: unknown[]) {
    const text = args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ');
    this.cb.onLog?.({ t: this.ctx?.millis() ?? 0, text, level });
  }
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}
