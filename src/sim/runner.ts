import { type SimClock, SketchStopped, yieldToBrowser } from './clock';
import type { DeviceProfile } from './devices/types';
import { Display } from './display';
import type { SimInput } from './inputs/input';
import type { InputSpecs, Sketch, SketchContext } from './sketch';

export interface LogLine {
  t: number;
  text: string;
  level: 'log' | 'warn' | 'error';
}

export interface RunCallbacks {
  onLog?(line: LogLine): void;
  onError?(err: unknown): void;
}

/** One boot of a sketch on a device: fresh display, fresh inputs, millis() from 0. */
export class SketchRun {
  readonly display: Display;
  readonly inputs: Record<string, SimInput>;
  private abort = new AbortController();
  private startMs: number;
  private ctx: SketchContext;

  constructor(
    readonly sketch: Sketch<InputSpecs>,
    readonly device: DeviceProfile,
    private clock: SimClock,
    private cb: RunCallbacks = {},
  ) {
    this.startMs = clock.now();
    this.display = new Display(device, clock, this.abort.signal);
    this.inputs = {};
    for (const [name, spec] of Object.entries(sketch.inputs ?? {})) {
      const input = spec.create({ clock });
      input.name = name;
      this.inputs[name] = input;
    }
    this.ctx = {
      display: this.display,
      inputs: this.inputs,
      device,
      millis: () => Math.floor(this.clock.now() - this.startMs),
      delay: (ms) => this.clock.sleep(ms, this.abort.signal),
      log: (...args) => this.log('log', args),
      warn: (...args) => this.log('warn', args),
      error: (...args) => this.log('error', args),
    };
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
      while (!this.stopped) {
        await this.whilePaused();
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
  }

  private async flush() {
    if (this.sketch.autoShow === false) return;
    if (!this.stopped && this.display.hasPendingChanges()) await this.display.show();
  }

  private whilePaused(): Promise<void> {
    if (!this.clock.paused) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const off = this.clock.onChange(() => {
        if (!this.clock.paused) {
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
