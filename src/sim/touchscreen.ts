// A touch panel over the display (a CST820 and the like): one finger, in native panel pixels.
// The UI presses, drags and lifts it; readers take every event from the log in order, so a quick
// tap between two reads is never lost.

export type TouchKind = 'down' | 'move' | 'up';

export interface TouchEvent {
  seq: number;
  kind: TouchKind;
  /** Native panel pixels. */
  x: number;
  y: number;
  /** Sim time. */
  t: number;
}

const LOG = 64;

export class TouchScreen {
  private down = false;
  private x = 0;
  private y = 0;
  /** The newest events (up to 64), oldest first; seq counts every event ever. */
  readonly log: TouchEvent[] = [];
  seq = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private now: () => number,
  ) {}

  press(x: number, y: number): void {
    if (this.down) return this.move(x, y);
    this.down = true;
    this.at(x, y);
    this.push('down');
  }

  move(x: number, y: number): void {
    if (!this.down) return;
    const [px, py] = [this.x, this.y];
    this.at(x, y);
    if (this.x !== px || this.y !== py) this.push('move');
  }

  release(): void {
    if (!this.down) return;
    this.down = false;
    this.push('up');
  }

  isPressed(): boolean {
    return this.down;
  }

  /** The last point touched, in native pixels. */
  point(): [number, number] {
    return [this.x, this.y];
  }

  private at(x: number, y: number) {
    this.x = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    this.y = Math.max(0, Math.min(this.height - 1, Math.round(y)));
  }

  private push(kind: TouchKind) {
    this.log.push({ seq: ++this.seq, kind, x: this.x, y: this.y, t: this.now() });
    if (this.log.length > LOG) this.log.shift();
  }
}
