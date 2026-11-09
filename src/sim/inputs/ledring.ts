import { SimInput } from './input';

/**
 * How an LED looks lit: its hue at full strength, and how bright (0..1). A dim LED is a faint glow
 * of its colour, not a dark one, so views draw the hue at this much opacity.
 */
export function glow(rgb: number): { hue: number; level: number } {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  const m = Math.max(r, g, b);
  if (!m) return { hue: 0, level: 0 };
  const k = 255 / m;
  return { hue: (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k), level: m / 255 };
}

// LEDs built into a board beside its display, driven by the `leds` module as an LED output is: the
// SmartKnob's eight side-firing SK6812s, lighting a ring round the knob (shown with the inputs, as
// the buzzer is). Numbered from the top, clockwise, as an LED ring output's are. Nothing lights
// until show(); brightness scales what shows, as FastLED's does.
export class LedRing extends SimInput {
  readonly kind = 'leds';
  private written: number[];
  private lit: number[];
  private level = 255;

  constructor(
    readonly count: number,
    opts: { label?: string } = {},
  ) {
    super(opts.label ?? 'LED ring');
    this.written = new Array(count).fill(0);
    this.lit = new Array(count).fill(0);
  }

  set(i: number, rgb: number): void {
    if (i >= 0 && i < this.count) this.written[i] = rgb & 0xffffff;
  }
  /** What set() wrote, shown or not. */
  get(i: number): number {
    return i >= 0 && i < this.count ? this.written[i] : 0;
  }
  fill(rgb: number, from = 0, count = this.count): void {
    for (let i = Math.max(0, from); i < Math.min(this.count, from + count); i++) this.written[i] = rgb & 0xffffff;
  }
  /** 0..255. */
  setBrightness(v: number): void {
    this.level = Math.min(255, Math.max(0, Math.round(v)));
    this.changed();
  }
  show(): void {
    this.lit = [...this.written];
    this.changed();
  }
  /** Each LED as it shines, after brightness: 0xRRGGBB. */
  colours(): number[] {
    const k = this.level / 255;
    return this.lit.map((c) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k));
  }
  /** Dark, as a new app finds them. */
  reset(): void {
    this.written.fill(0);
    this.lit.fill(0);
    this.level = 255;
    this.changed();
  }
}
