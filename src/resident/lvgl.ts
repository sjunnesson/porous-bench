// Bench's LVGL: the widget tree behind Lua's `lvgl` module, laid out the way LVGL 9 does it and drawn
// with Canvas2D in the light default theme (Montserrat, the reference board's fonts). Each refresh
// renders the screen, then writes only the pixels that changed into the display's frame buffer, so
// the bus transfer covers what LVGL's partial flush would.
//
// The Lua side (lua/lvgl.lua) owns handles, animations and timers; this file owns geometry, styles
// and pixels. Without a canvas (tests under Node), the tree still works and nothing is drawn.

import { color565 } from '../sim/color';
import type { Display } from '../sim/display';

type Props = Record<string, unknown>;
interface StyleEntry {
  props: Props;
  selector: number;
  /** The lvgl.Style it came from, or undefined for the object's own local style. */
  sid?: number;
}

interface Node {
  id: number;
  kind: string;
  parent: Node | null;
  children: Node[];
  props: Props;
  theme: Props;
  /** Local styles (set_style, one per part) and added lvgl.Styles (by id), in the order applied. */
  styles: StyleEntry[];
  flags: number;
  states: number;
  alignTo?: { base: number | null; type: number; x: number; y: number };
  // Layout result, in screen coordinates.
  x: number;
  y: number;
  w: number;
  h: number;
}

const SPEC = 1 << 29;
const SIZE_CONTENT = SPEC | 2001;
const RADIUS_CIRCLE = 0x7fff;
const FLAG_HIDDEN = 1 << 0;
const FLAG_FLOATING = 1 << 18;
const FLAG_IGNORE_LAYOUT = 1 << 17;
const FLAG_OVERFLOW_VISIBLE = 1 << 20;
const STATE_CHECKED = 0x0001;
const LAYOUT_FLEX = 1;

// Material palette entries the default theme uses.
const PRIMARY = '#2196F3';
const TEXT = '#212121';
const SCREEN = '#F5F5F5';
const CARD = '#FFFFFF';
const GREY = '#E0E0E0';
const SHADOW = '#9E9E9E';

/** Text properties that a child inherits from its parent when it doesn't set them (as in LVGL). */
const INHERITED = new Set(['text_color', 'text_font', 'text_align', 'text_letter_space', 'text_line_space', 'text_opa']);

const THEME_CLASS: Record<string, string> = {
  Object: 'object', Label: 'label', Button: 'button', Image: 'image', Textarea: 'textarea', Checkbox: 'checkbox',
  Dropdown: 'dropdown', Roller: 'roller', Led: 'led', Line: 'line', Arc: 'arc', Scale: 'scale',
};

/** Widgets Bench draws as a plain box for now. */
const PLACEHOLDER = new Set(['Image', 'Dropdown', 'Textarea', 'Scale', 'List', 'Keyboard', 'Calendar']);

// LV_SYMBOL_* are Font Awesome glyphs in LVGL's fonts; Montserrat on the web doesn't carry them.
const SYMBOLS: Record<number, string> = {
  0xf00c: '✓', 0xf00d: '✕', 0xf04b: '▶', 0xf04c: '❚❚', 0xf04d: '■', 0xf048: '⏮', 0xf051: '⏭', 0xf053: '‹',
  0xf054: '›', 0xf077: '▲', 0xf078: '▼', 0xf067: '+', 0xf068: '−', 0xf071: '⚠', 0xf0f3: '♪', 0xf015: '⌂',
  0xf013: '⚙', 0xf011: '⏻', 0xf021: '↻', 0xf1eb: '≋', 0xf240: '▮', 0xf241: '▮', 0xf242: '▯', 0xf243: '▯',
  0xf244: '▯', 0xf0e7: 'ϟ', 0xf001: '♫', 0xf079: '⟲', 0xf074: '⤨', 0xf0c9: '≡', 0xf00b: '≡', 0x2022: '•',
};
const symbols = (s: string) => s.replace(/[-]/g, (c) => SYMBOLS[c.codePointAt(0)!] ?? '□');

function cssColor(v: unknown, fallback: string): string {
  if (typeof v === 'number') return `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
  if (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  return fallback;
}
const opa = (v: unknown, fallback = 255) => (typeof v === 'number' ? Math.max(0, Math.min(255, v)) / 255 : fallback / 255);

/** Decode an LVGL coordinate: a number of pixels, a percentage (of `base`), or SIZE_CONTENT. */
function coord(v: unknown, base: number): number | 'content' | null {
  if (typeof v !== 'number') return null;
  if (v >= SPEC && v < SPEC * 2) {
    const n = v & (SPEC - 1);
    if (n === 2001) return 'content';
    const pct = n <= 1000 ? n : -(n - 1000);
    return Math.round((base * pct) / 100);
  }
  return v;
}

/** Expand style shorthands (pad_all, pad_hor, size, width, …) into the properties the layout reads. */
function expand(props: Props): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'pad_all') for (const s of ['pad_top', 'pad_bottom', 'pad_left', 'pad_right']) out[s] = v;
    else if (k === 'pad_hor') out.pad_left = out.pad_right = v;
    else if (k === 'pad_ver') out.pad_top = out.pad_bottom = v;
    else if (k === 'pad_gap') out.pad_row = out.pad_column = v;
    else if (k === 'size') out.w = out.h = v;
    else if (k === 'width') out.w = v;
    else if (k === 'height') out.h = v;
    else out[k] = v;
  }
  return out;
}

export class LvglScreen {
  private nodes = new Map<number, Node>();
  private next = 1;
  readonly screen: Node;
  private userTheme: Record<string, Props> | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private last: Uint16Array | null = null;
  private fontsWanted = new Set<string>();
  private warned = new Set<string>();
  /** Something changed since the last refresh. */
  dirty = true;

  constructor(
    private display: Display,
    private dpi: number,
    private warn: (text: string) => void,
  ) {
    this.screen = this.node('Screen', null);
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(1, 1);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
  }

  // ---- the tree (driven from Lua) -----------------------------------------------------------

  create(kind: string, parentId: number | null): number {
    const parent = parentId == null ? this.screen : this.nodes.get(parentId);
    if (!parent) throw new Error(`${kind}: parent was deleted`);
    if (PLACEHOLDER.has(kind) && !this.warned.has(kind)) {
      this.warned.add(kind);
      this.warn(`lvgl.${kind}: Bench draws this widget as a plain box for now`);
    }
    const n = this.node(kind, parent);
    return n.id;
  }

  set(id: number, props: Props): void {
    const n = this.get(id);
    for (const [k, v] of Object.entries(expand(props))) {
      if (k === 'align' && v && typeof v === 'object') {
        // align = { type, x_ofs, y_ofs }
        const a = v as Props;
        n.props.align = a.type;
        if (a.x_ofs !== undefined) n.props.x = a.x_ofs;
        if (a.y_ofs !== undefined) n.props.y = a.y_ofs;
        continue;
      }
      if (k === 'angles' && Array.isArray(v)) {
        n.props.start_angle = v[0];
        n.props.end_angle = v[1];
        continue;
      }
      if (k === 'bg_angles' && Array.isArray(v)) {
        n.props.bg_start_angle = v[0];
        n.props.bg_end_angle = v[1];
        continue;
      }
      if (k === 'arc_color' && n.kind === 'Arc') {
        // luavgl: on an Arc, set{arc_color} styles the indicator (the background arc keeps the theme's).
        n.props.indicator_color = v;
        continue;
      }
      if (k === 'parent' && typeof v === 'number') {
        this.reparent(n, v);
        continue;
      }
      n.props[k] = v;
    }
    if (props.flex_flow !== undefined && n.props.layout === undefined) n.props.layout = LAYOUT_FLEX;
    if (props.value !== undefined && n.kind === 'Arc') delete n.props.end_angle; // value drives the indicator
    this.dirty = true;
  }

  getProp(id: number, key: string): unknown {
    const n = this.nodes.get(id);
    return n ? (n.props[key] ?? n.theme[key]) : undefined;
  }

  alignTo(id: number, base: number | null, type: number, x: number, y: number): void {
    this.get(id).alignTo = { base, type, x, y };
    this.dirty = true;
  }

  delete(id: number): number[] {
    const n = this.nodes.get(id);
    if (!n || n === this.screen) return [];
    const gone = this.drop(n);
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    this.dirty = true;
    return gone;
  }

  clean(id: number): number[] {
    const n = this.get(id);
    const gone = n.children.flatMap((c) => this.drop(c));
    n.children = [];
    this.dirty = true;
    return gone;
  }

  flag(id: number, f: number, on: boolean): void {
    const n = this.get(id);
    n.flags = on ? n.flags | f : n.flags & ~f;
    this.dirty = true;
  }
  hasFlag(id: number, f: number): boolean {
    return (this.get(id).flags & f) === f;
  }
  state(id: number, s: number, on: boolean): void {
    const n = this.get(id);
    n.states = on ? n.states | s : n.states & ~s;
    this.dirty = true;
  }
  hasState(id: number, s: number): boolean {
    return (this.get(id).states & s) === s;
  }
  /** On an Arc, a part selector decides whether a style reaches the track, the indicator or the knob. */
  private forPart(n: Node, raw: Props, selector: number): Props {
    const props = expand(raw);
    const part = selector & 0xff0000;
    if (n.kind === 'Arc' && part === 0x020000) {
      const p = { ...props };
      if (props.arc_color !== undefined) p.indicator_color = props.arc_color;
      delete p.arc_color;
      return p;
    }
    if (n.kind === 'Arc' && part === 0x030000) {
      const p: Props = {};
      if (props.bg_color !== undefined) p.knob_color = props.bg_color;
      if (props.pad_top !== undefined) p.knob_pad = props.pad_top;
      if (props.bg_opa === 0) p.knob = false;
      return p;
    }
    return props;
  }

  /**
   * obj:add_style(style, selector) with the style's id, or obj:set_style(props, selector) without:
   * that one merges into the object's local style for the part (as luavgl replaces local props).
   */
  addStyle(id: number, raw: Props, selector = 0, sid?: number | null): void {
    const n = this.get(id);
    const props = this.forPart(n, raw, selector);
    if (sid == null) {
      const local = n.styles.find((e) => e.sid === undefined && e.selector === selector);
      if (local) Object.assign(local.props, props);
      else n.styles.push({ props, selector });
    } else n.styles.push({ props, selector, sid });
    this.dirty = true;
  }

  /** style:set{...} / remove_prop / delete: every object that added the style sees the change. */
  updateStyle(sid: number, raw: Props): void {
    for (const n of this.nodes.values()) {
      for (const e of n.styles) if (e.sid === sid) e.props = this.forPart(n, raw, e.selector);
    }
    this.dirty = true;
  }
  childCount(id: number): number {
    return this.get(id).children.length;
  }
  getState(id: number): number {
    return this.get(id).states;
  }
  removeStyles(id: number): void {
    this.get(id).styles = [];
    this.dirty = true;
  }
  /** x1, y1, x2, y2 (inclusive, like lv_area_t) and the position within the parent. */
  coords(id: number): number[] {
    this.layout();
    const n = this.get(id);
    const p = n.parent;
    return [n.x, n.y, n.x + n.w - 1, n.y + n.h - 1, p ? n.x - p.x : n.x, p ? n.y - p.y : n.y];
  }
  parentOf(id: number): number | undefined {
    return this.get(id).parent?.id;
  }

  /** h:set_theme{...}: defaults for widgets created from now on; `screen` applies at once. */
  setTheme(theme: Record<string, Props> | null): void {
    this.userTheme = theme ? Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, expand(v ?? {})])) : null;
    if (this.userTheme?.screen) Object.assign(this.screen.props, this.userTheme.screen);
    this.dirty = true;
  }

  invalidateAll(): void {
    this.last = null;
    this.dirty = true;
  }

  // ---- refresh -------------------------------------------------------------------------------

  /** Draw the screen and copy the changed pixels to the display. Returns whether any changed. */
  refresh(): boolean {
    this.dirty = false;
    this.layout();
    if (!this.ctx || !this.canvas) return false;
    const W = this.display.width();
    const H = this.display.height();
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      this.last = null;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    this.draw(ctx, this.screen, 1);

    const data = ctx.getImageData(0, 0, W, H).data;
    const last = this.last ?? new Uint16Array(W * H).fill(0xffff);
    const first = !this.last;
    let changed = false;
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
      const c = color565(data[i], data[i + 1], data[i + 2]);
      if (first || c !== last[p]) {
        last[p] = c;
        this.display.drawPixel(p % W, (p / W) | 0, c);
        changed = true;
      }
    }
    this.last = last;
    return changed;
  }

  // ---- internals -----------------------------------------------------------------------------

  private node(kind: string, parent: Node | null): Node {
    const n: Node = { id: this.next++, kind, parent, children: [], props: {}, theme: {}, styles: [], flags: 0, states: 0, x: 0, y: 0, w: 0, h: 0 };
    n.theme = this.themeFor(kind);
    this.nodes.set(n.id, n);
    parent?.children.push(n);
    this.dirty = true;
    return n;
  }

  private get(id: number): Node {
    const n = this.nodes.get(id);
    if (!n) throw new Error('lvgl: object deleted');
    return n;
  }

  private drop(n: Node): number[] {
    const ids = [n.id];
    for (const c of n.children) ids.push(...this.drop(c));
    this.nodes.delete(n.id);
    return ids;
  }

  private reparent(n: Node, parentId: number) {
    const p = this.get(parentId);
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    n.parent = p;
    p.children.push(n);
  }

  private dpx(v: number) {
    return v === 0 ? 0 : Math.max(1, Math.floor((this.dpi * v + 80) / 160));
  }

  /** LVGL 9's default theme (light, small display), plus whatever the app installed with set_theme. */
  private themeFor(kind: string): Props {
    const dpx = (v: number) => this.dpx(v);
    const PAD = dpx(16);
    const PAD_SMALL = dpx(10);
    const RADIUS = dpx(8);
    const BORDER = dpx(2);
    const base: Record<string, Props> = {
      Screen: { bg_color: SCREEN, bg_opa: 255, text_color: TEXT, pad_row: PAD_SMALL, pad_column: PAD_SMALL },
      Object: { bg_color: CARD, bg_opa: 255, radius: RADIUS, border_color: GREY, border_width: BORDER, pad_top: PAD, pad_bottom: PAD, pad_left: PAD, pad_right: PAD, pad_row: PAD_SMALL, pad_column: PAD_SMALL, w: dpx(100), h: dpx(100) },
      Button: { bg_color: PRIMARY, bg_opa: 255, radius: RADIUS, shadow_color: SHADOW, shadow_width: dpx(3), shadow_opa: 128, shadow_offset_y: dpx(4), text_color: '#FFFFFF', pad_left: PAD, pad_right: PAD, pad_top: PAD_SMALL, pad_bottom: PAD_SMALL, w: SIZE_CONTENT, h: SIZE_CONTENT },
      Label: { w: SIZE_CONTENT, h: SIZE_CONTENT },
      Arc: { arc_color: GREY, arc_width: dpx(15), arc_rounded: 1, indicator_color: PRIMARY, knob_color: PRIMARY, knob_pad: dpx(4), w: this.dpi, h: this.dpi, bg_start_angle: 135, bg_end_angle: 45, start_angle: 135, value: 0 },
      Line: { line_color: '#000000', line_width: 1, w: SIZE_CONTENT, h: SIZE_CONTENT },
      Led: { color: PRIMARY, brightness: 255, radius: RADIUS_CIRCLE, w: dpx(20), h: dpx(20) },
      Checkbox: { pad_column: dpx(10), w: SIZE_CONTENT, h: SIZE_CONTENT, text: 'Check box', box_color: PRIMARY, border_width: BORDER },
      Roller: { bg_color: CARD, bg_opa: 255, radius: RADIUS, border_color: GREY, border_width: BORDER, pad_left: PAD_SMALL, pad_right: PAD_SMALL, w: SIZE_CONTENT, h: SIZE_CONTENT, options: '', selected: 0, visible_row_count: 3 },
    };
    const theme: Props = { ...(PLACEHOLDER.has(kind) ? base.Object : (base[kind] ?? {})) };
    const user = this.userTheme;
    if (user && kind !== 'Screen') {
      Object.assign(theme, user.object ?? {});
      const cls = THEME_CLASS[kind];
      if (cls && user[cls]) Object.assign(theme, user[cls]);
    }
    return theme;
  }

  /** A style property: set on the object, then added styles, then the theme, then inherited. */
  private prop(n: Node, key: string): unknown {
    if (n.props[key] !== undefined) return n.props[key];
    // Local styles win over added ones (LVGL keeps them first); among added ones, the latest wins.
    for (const e of n.styles) if (e.sid === undefined && e.props[key] !== undefined) return e.props[key];
    for (let i = n.styles.length - 1; i >= 0; i--) {
      const e = n.styles[i];
      if (e.sid !== undefined && e.props[key] !== undefined) return e.props[key];
    }
    if (n.theme[key] !== undefined) return n.theme[key];
    if (INHERITED.has(key) && n.parent) return this.prop(n.parent, key);
    return undefined;
  }
  private num(n: Node, key: string, fallback = 0): number {
    const v = this.prop(n, key);
    return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : fallback;
  }

  private font(n: Node): { css: string; size: number; line: number } {
    const f = this.prop(n, 'text_font') as { size?: number; weight?: number } | undefined;
    const size = f?.size ?? 14;
    const weight = f?.weight ?? 500;
    const css = `${weight} ${size}px Montserrat, sans-serif`;
    if (!this.fontsWanted.has(css) && typeof document !== 'undefined' && document.fonts) {
      this.fontsWanted.add(css);
      // Redraw once the face is in: until then the browser's fallback is what we measured.
      void document.fonts.load(css).then(() => this.invalidateAll());
    }
    return { css, size, line: Math.ceil(size * 1.17) };
  }

  private measure(text: string, css: string): number {
    if (!this.ctx) return text.length * 7;
    this.ctx.font = css;
    return this.ctx.measureText(symbols(text)).width;
  }

  /** Lines of a label's text, wrapped to `width` when it has one. */
  private lines(n: Node, width: number | null): string[] {
    const text = String(this.prop(n, 'text') ?? (n.kind === 'Label' ? 'Text' : ''));
    const { css } = this.font(n);
    const ls = this.num(n, 'text_letter_space');
    const out: string[] = [];
    for (const para of text.split('\n')) {
      if (width == null) {
        out.push(para);
        continue;
      }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const tryLine = line + word;
        if (line && this.measure(tryLine, css) + ls * tryLine.length > width) {
          out.push(line.trimEnd());
          line = word.trimStart();
        } else line = tryLine;
      }
      out.push(line);
    }
    return out;
  }

  private textSize(n: Node, width: number | null): { w: number; h: number } {
    const { css, line } = this.font(n);
    const ls = this.num(n, 'text_letter_space');
    const lines = this.lines(n, width);
    const w = Math.max(0, ...lines.map((l) => this.measure(l, css) + ls * Math.max(0, l.length - 1)));
    const h = lines.length * line + Math.max(0, lines.length - 1) * this.num(n, 'text_line_space');
    return { w: Math.ceil(w), h };
  }

  /** A Line's points; an empty Lua table can arrive as {} rather than []. */
  private points(n: Node): number[][] {
    const p = this.prop(n, 'points');
    const list = Array.isArray(p) ? p : p && typeof p === 'object' ? Object.values(p) : [];
    return list.filter((q): q is number[] => Array.isArray(q) && q.length >= 2);
  }

  private pads(n: Node) {
    const b = this.num(n, 'border_width');
    return { l: this.num(n, 'pad_left') + b, r: this.num(n, 'pad_right') + b, t: this.num(n, 'pad_top') + b, b: this.num(n, 'pad_bottom') + b };
  }

  /** Size of what's inside: text, line points, or the children's extent. */
  private contentSize(n: Node, cw: number | null): { w: number; h: number } {
    switch (n.kind) {
      case 'Label':
        return this.textSize(n, cw);
      case 'Line': {
        const pts = this.points(n);
        const lw = this.num(n, 'line_width', 1);
        return { w: Math.max(0, ...pts.map((p) => p[0])) + lw, h: Math.max(0, ...pts.map((p) => p[1])) + lw };
      }
      case 'Checkbox': {
        const t = this.textSize(n, null);
        const box = this.font(n).line;
        return { w: box + this.num(n, 'pad_column') + t.w, h: Math.max(box, t.h) };
      }
      case 'Roller': {
        const { css, line } = this.font(n);
        const opts = String(this.prop(n, 'options') ?? '').split('\n');
        const rows = this.num(n, 'visible_row_count', 3);
        return { w: Math.ceil(Math.max(20, ...opts.map((o) => this.measure(o, css)))), h: rows * line + (rows - 1) * 6 };
      }
    }
    let w = 0;
    let h = 0;
    for (const c of n.children) {
      if (c.flags & FLAG_HIDDEN) continue;
      this.size(c, cw ?? 0, 0);
      const x = coord(this.prop(c, 'x'), 0);
      const y = coord(this.prop(c, 'y'), 0);
      w = Math.max(w, (typeof x === 'number' ? x : 0) + c.w);
      h = Math.max(h, (typeof y === 'number' ? y : 0) + c.h);
    }
    // Flex rows/columns add up along the main axis.
    if (this.isFlex(n)) {
      const row = this.flexRow(n);
      const kids = n.children.filter((c) => !(c.flags & (FLAG_HIDDEN | FLAG_FLOATING | FLAG_IGNORE_LAYOUT)));
      const gap = this.num(n, row ? 'pad_column' : 'pad_row');
      const main = kids.reduce((s, c) => s + (row ? c.w : c.h), 0) + gap * Math.max(0, kids.length - 1);
      const cross = Math.max(0, ...kids.map((c) => (row ? c.h : c.w)));
      return row ? { w: main, h: cross } : { w: cross, h: main };
    }
    return { w, h };
  }

  private size(n: Node, pw: number, ph: number) {
    const p = this.pads(n);
    const w0 = coord(this.prop(n, 'w'), pw);
    const h0 = coord(this.prop(n, 'h'), ph);
    let w = typeof w0 === 'number' ? w0 : 0;
    let h = typeof h0 === 'number' ? h0 : 0;
    if (w0 === 'content' || h0 === 'content' || w0 === null || h0 === null) {
      const inner = this.contentSize(n, typeof w0 === 'number' ? Math.max(0, w0 - p.l - p.r) : null);
      if (w0 === 'content' || w0 === null) w = inner.w + p.l + p.r;
      if (h0 === 'content' || h0 === null) h = inner.h + p.t + p.b;
    }
    const clamp = (v: number, lo: string, hi: string, base: number) => {
      const a = coord(this.prop(n, lo), base);
      const b = coord(this.prop(n, hi), base);
      if (typeof b === 'number') v = Math.min(v, b);
      if (typeof a === 'number') v = Math.max(v, a);
      return v;
    };
    n.w = Math.max(0, clamp(w, 'min_width', 'max_width', pw));
    n.h = Math.max(0, clamp(h, 'min_height', 'max_height', ph));
  }

  private isFlex(n: Node) {
    return this.num(n, 'layout') === LAYOUT_FLEX || this.prop(n, 'flex_flow') !== undefined;
  }
  private flexRow(n: Node) {
    return (this.num(n, 'flex_flow') & 1) === 0;
  }

  /** Where an alignment puts a box of w×h inside (or around) a box. */
  private aligned(type: number, bx: number, by: number, bw: number, bh: number, w: number, h: number): [number, number] {
    const mid = (a: number, b: number) => Math.floor((a - b) / 2);
    switch (type) {
      case 2: return [bx + mid(bw, w), by];
      case 3: return [bx + bw - w, by];
      case 4: return [bx, by + bh - h];
      case 5: return [bx + mid(bw, w), by + bh - h];
      case 6: return [bx + bw - w, by + bh - h];
      case 7: return [bx, by + mid(bh, h)];
      case 8: return [bx + bw - w, by + mid(bh, h)];
      case 9: return [bx + mid(bw, w), by + mid(bh, h)];
      case 10: return [bx, by - h];
      case 11: return [bx + mid(bw, w), by - h];
      case 12: return [bx + bw - w, by - h];
      case 13: return [bx, by + bh];
      case 14: return [bx + mid(bw, w), by + bh];
      case 15: return [bx + bw - w, by + bh];
      case 16: return [bx - w, by];
      case 17: return [bx - w, by + mid(bh, h)];
      case 18: return [bx - w, by + bh - h];
      case 19: return [bx + bw, by];
      case 20: return [bx + bw, by + mid(bh, h)];
      case 21: return [bx + bw, by + bh - h];
      default: return [bx, by];
    }
  }

  private layout() {
    const W = this.display.width();
    const H = this.display.height();
    const s = this.screen;
    s.x = 0;
    s.y = 0;
    s.w = W;
    s.h = H;
    // Twice, so align_to can use a base laid out later in the tree.
    this.place(s);
    this.place(s);
  }

  /** Lay out n's children inside its content box (n is already placed). */
  private place(n: Node) {
    const p = this.pads(n);
    const cx = n.x + p.l;
    const cy = n.y + p.t;
    const cw = Math.max(0, n.w - p.l - p.r);
    const ch = Math.max(0, n.h - p.t - p.b);
    for (const c of n.children) this.size(c, cw, ch);
    const flex = this.isFlex(n);
    const inFlow = (c: Node) => flex && !(c.flags & (FLAG_HIDDEN | FLAG_FLOATING | FLAG_IGNORE_LAYOUT));
    for (const c of n.children) {
      if (inFlow(c)) continue;
      const xo = coord(this.prop(c, 'x'), cw);
      const yo = coord(this.prop(c, 'y'), ch);
      const ox = typeof xo === 'number' ? xo : 0;
      const oy = typeof yo === 'number' ? yo : 0;
      let x: number;
      let y: number;
      const base = c.alignTo?.base != null ? this.nodes.get(c.alignTo.base) : null;
      if (c.alignTo && (base || c.alignTo.base == null)) {
        const b = base ?? n;
        [x, y] = this.aligned(c.alignTo.type, b.x, b.y, b.w, b.h, c.w, c.h);
        x += c.alignTo.x;
        y += c.alignTo.y;
      } else {
        [x, y] = this.aligned(this.num(c, 'align', 1), cx, cy, cw, ch, c.w, c.h);
        x += ox;
        y += oy;
      }
      c.x = x;
      c.y = y;
    }
    if (flex) this.flex(n, cx, cy, cw, ch, n.children.filter(inFlow));
    for (const c of n.children) {
      const tx = coord(this.prop(c, 'translate_x'), c.w);
      const ty = coord(this.prop(c, 'translate_y'), c.h);
      c.x += typeof tx === 'number' ? tx : 0;
      c.y += typeof ty === 'number' ? ty : 0;
      this.place(c);
    }
  }

  private flex(n: Node, cx: number, cy: number, cw: number, ch: number, kids: Node[]) {
    const row = this.flexRow(n);
    const reverse = (this.num(n, 'flex_flow') & 8) !== 0;
    const gap = this.num(n, row ? 'pad_column' : 'pad_row');
    const mainPlace = this.num(n, 'flex_main_place');
    const crossPlace = this.num(n, 'flex_cross_place');
    const list = reverse ? [...kids].reverse() : kids;
    const room = row ? cw : ch;
    const used = list.reduce((s, c) => s + (row ? c.w : c.h), 0);
    let free = room - used - gap * Math.max(0, list.length - 1);
    let start = 0;
    let between = gap;
    if (mainPlace === 1) start = free; // END
    else if (mainPlace === 2) start = free / 2; // CENTER
    else if (mainPlace === 3 && list.length) { between = gap + free / (list.length + 1); start = between - gap; } // SPACE_EVENLY
    else if (mainPlace === 4 && list.length) { between = gap + free / list.length; start = (between - gap) / 2; } // SPACE_AROUND
    else if (mainPlace === 5 && list.length > 1) between = gap + free / (list.length - 1); // SPACE_BETWEEN
    free = 0;
    let pos = start;
    for (const c of list) {
      const crossRoom = (row ? ch : cw) - (row ? c.h : c.w);
      const cross = crossPlace === 1 ? crossRoom : crossPlace === 2 ? crossRoom / 2 : 0;
      c.x = Math.round(row ? cx + pos : cx + cross);
      c.y = Math.round(row ? cy + cross : cy + pos);
      pos += (row ? c.w : c.h) + between;
    }
  }

  // ---- drawing -------------------------------------------------------------------------------

  private roundRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.max(0, Math.min(r >= RADIUS_CIRCLE ? Infinity : r, w / 2, h / 2));
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
  }

  private draw(ctx: OffscreenCanvasRenderingContext2D, n: Node, alpha: number) {
    if (n.flags & FLAG_HIDDEN) return;
    const a = alpha * opa(this.prop(n, 'opa'));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // Transform: rotation (0.1°) and scale (256 = 1×) around the pivot.
    const rot = this.num(n, 'transform_rotation');
    const sx = this.num(n, 'transform_scale_x', 256) / 256;
    const sy = this.num(n, 'transform_scale_y', 256) / 256;
    if (rot || sx !== 1 || sy !== 1) {
      const px = n.x + this.num(n, 'transform_pivot_x');
      const py = n.y + this.num(n, 'transform_pivot_y');
      ctx.translate(px, py);
      ctx.rotate((rot / 10) * (Math.PI / 180));
      ctx.scale(sx, sy);
      ctx.translate(-px, -py);
    }

    const r = this.num(n, 'radius');
    const bgOpa = opa(this.prop(n, 'bg_opa'), 0);
    // Shadow, under the background.
    const sw = this.num(n, 'shadow_width');
    if (sw > 0 && bgOpa > 0 && n.kind !== 'Led') {
      ctx.save();
      ctx.shadowColor = this.rgba(this.prop(n, 'shadow_color'), opa(this.prop(n, 'shadow_opa'), 255), '#000000');
      ctx.shadowBlur = sw;
      ctx.shadowOffsetX = this.num(n, 'shadow_offset_x');
      ctx.shadowOffsetY = this.num(n, 'shadow_offset_y');
      ctx.fillStyle = this.rgba(this.prop(n, 'bg_color'), bgOpa, CARD);
      this.roundRect(ctx, n.x, n.y, n.w, n.h, r);
      ctx.fill();
      ctx.restore();
    }
    if (bgOpa > 0 && n.kind !== 'Led') {
      const grad = this.prop(n, 'bg_grad_color');
      const dir = this.num(n, 'bg_grad_dir');
      if (grad !== undefined && dir) {
        const g = dir === 1 ? ctx.createLinearGradient(0, n.y, 0, n.y + n.h) : ctx.createLinearGradient(n.x, 0, n.x + n.w, 0);
        g.addColorStop(0, this.rgba(this.prop(n, 'bg_color'), bgOpa, CARD));
        g.addColorStop(1, this.rgba(grad, bgOpa, CARD));
        ctx.fillStyle = g;
      } else ctx.fillStyle = this.rgba(this.prop(n, 'bg_color'), bgOpa, CARD);
      this.roundRect(ctx, n.x, n.y, n.w, n.h, r);
      ctx.fill();
    }
    const bw = this.num(n, 'border_width');
    if (bw > 0 && n.kind !== 'Checkbox' && opa(this.prop(n, 'border_opa'), 255) > 0) {
      ctx.strokeStyle = this.rgba(this.prop(n, 'border_color'), opa(this.prop(n, 'border_opa'), 255), GREY);
      ctx.lineWidth = bw;
      this.roundRect(ctx, n.x + bw / 2, n.y + bw / 2, n.w - bw, n.h - bw, Math.max(0, r - bw / 2));
      ctx.stroke();
    }
    const ow = this.num(n, 'outline_width');
    if (ow > 0) {
      const op = this.num(n, 'outline_pad');
      ctx.strokeStyle = this.rgba(this.prop(n, 'outline_color'), opa(this.prop(n, 'outline_opa'), 255), PRIMARY);
      ctx.lineWidth = ow;
      this.roundRect(ctx, n.x - op - ow / 2, n.y - op - ow / 2, n.w + 2 * (op + ow / 2), n.h + 2 * (op + ow / 2), r + op);
      ctx.stroke();
    }

    switch (n.kind) {
      case 'Label':
        this.drawText(ctx, n, n.x + this.pads(n).l, n.y + this.pads(n).t, n.w - this.pads(n).l - this.pads(n).r);
        break;
      case 'Arc':
        this.drawArc(ctx, n);
        break;
      case 'Line':
        this.drawLine(ctx, n);
        break;
      case 'Led':
        this.drawLed(ctx, n);
        break;
      case 'Checkbox':
        this.drawCheckbox(ctx, n);
        break;
      case 'Roller':
        this.drawRoller(ctx, n);
        break;
      default:
        if (PLACEHOLDER.has(n.kind)) {
          ctx.fillStyle = this.rgba(SHADOW, 1, SHADOW);
          ctx.font = '500 10px Montserrat, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.kind, n.x + n.w / 2, n.y + n.h / 2);
        }
    }

    // Children, clipped to this object unless it lets them overflow.
    if (n.children.length) {
      ctx.save();
      if (!(n.flags & FLAG_OVERFLOW_VISIBLE) && n !== this.screen) {
        ctx.beginPath();
        ctx.rect(n.x, n.y, n.w, n.h);
        ctx.clip();
      }
      for (const c of n.children) this.draw(ctx, c, a);
      ctx.restore();
    }
    ctx.restore();
  }

  private rgba(v: unknown, alpha: number, fallback: string): string {
    const hex = cssColor(v, fallback);
    const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
    const n = parseInt(full.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  private drawText(ctx: OffscreenCanvasRenderingContext2D, n: Node, x: number, y: number, width: number) {
    const { css, line } = this.font(n);
    const fixed = coord(this.prop(n, 'w'), 0);
    const lines = this.lines(n, typeof fixed === 'number' ? width : null);
    const align = this.num(n, 'text_align');
    const ls = this.num(n, 'text_letter_space');
    ctx.font = css;
    ctx.letterSpacing = `${ls}px`;
    ctx.fillStyle = this.rgba(this.prop(n, 'text_color'), opa(this.prop(n, 'text_opa'), 255), TEXT);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const step = line + this.num(n, 'text_line_space');
    lines.forEach((l, i) => {
      const s = symbols(l);
      const tw = ctx.measureText(s).width;
      const lx = align === 2 ? x + (width - tw) / 2 : align === 3 ? x + width - tw : x;
      ctx.fillText(s, lx, y + i * step + line / 2 + 0.5);
    });
    ctx.letterSpacing = '0px';
  }

  private drawArc(ctx: OffscreenCanvasRenderingContext2D, n: Node) {
    const rad = (d: number) => (d * Math.PI) / 180;
    const rotation = this.num(n, 'rotation');
    const bgStart = this.num(n, 'bg_start_angle', 135) + rotation;
    let bgEnd = this.num(n, 'bg_end_angle', 45) + rotation;
    while (bgEnd <= bgStart) bgEnd += 360;
    const range = (this.prop(n, 'range') as number[] | undefined) ?? [0, 100];
    let start: number;
    let end: number;
    if (n.props.end_angle !== undefined) {
      start = this.num(n, 'start_angle', 135) + rotation;
      end = this.num(n, 'end_angle') + rotation;
      while (end < start) end += 360;
    } else {
      const v = Math.max(range[0], Math.min(range[1], this.num(n, 'value')));
      const t = (v - range[0]) / (range[1] - range[0] || 1);
      const mode = this.num(n, 'mode');
      if (mode === 2) { start = bgEnd - (bgEnd - bgStart) * t; end = bgEnd; } // REVERSE
      else if (mode === 1) { const mid = (bgStart + bgEnd) / 2; const half = ((bgEnd - bgStart) / 2) * (t * 2 - 1); start = Math.min(mid, mid + half); end = Math.max(mid, mid + half); } // SYMMETRICAL
      else { start = bgStart; end = bgStart + (bgEnd - bgStart) * t; }
    }
    const width = this.num(n, 'arc_width', this.dpx(15));
    const p = this.pads(n);
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const radius = Math.max(1, Math.min(n.w - p.l - p.r, n.h - p.t - p.b) / 2 - width / 2);
    const round = this.num(n, 'arc_rounded') !== 0;
    ctx.lineCap = round ? 'round' : 'butt';
    ctx.lineWidth = width;
    const arcOpa = opa(this.prop(n, 'arc_opa'), 255);
    ctx.strokeStyle = this.rgba(this.prop(n, 'arc_color'), arcOpa, GREY);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, rad(bgStart), rad(bgEnd));
    ctx.stroke();
    if (end > start) {
      ctx.strokeStyle = this.rgba(this.prop(n, 'indicator_color'), arcOpa, PRIMARY);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, rad(start), rad(end));
      ctx.stroke();
    }
    if (this.prop(n, 'knob') !== false && n.props.end_angle === undefined) {
      const kr = width / 2 + this.num(n, 'knob_pad');
      ctx.fillStyle = this.rgba(this.prop(n, 'knob_color'), 1, PRIMARY);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(rad(end)) * radius, cy + Math.sin(rad(end)) * radius, kr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLine(ctx: OffscreenCanvasRenderingContext2D, n: Node) {
    const pts = this.points(n);
    if (pts.length < 2) return;
    const invert = !!this.prop(n, 'y_invert');
    ctx.strokeStyle = this.rgba(this.prop(n, 'line_color'), opa(this.prop(n, 'line_opa'), 255), '#000000');
    ctx.lineWidth = this.num(n, 'line_width', 1);
    const round = this.num(n, 'line_rounded') !== 0;
    ctx.lineCap = round ? 'round' : 'butt';
    ctx.lineJoin = round ? 'round' : 'miter';
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const x = n.x + px;
      const y = n.y + (invert ? n.h - py : py);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private drawLed(ctx: OffscreenCanvasRenderingContext2D, n: Node) {
    const bright = Math.max(0, Math.min(255, this.num(n, 'brightness', 255))) / 255;
    const base = cssColor(this.prop(n, 'color'), PRIMARY);
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const rr = Math.min(n.w, n.h) / 2;
    // Dim towards black, and glow when lit (LVGL's LED uses a shadow the same way).
    ctx.save();
    ctx.shadowColor = this.rgba(base, bright, base);
    ctx.shadowBlur = this.dpx(15) * bright;
    ctx.fillStyle = this.rgba(base, 1, base);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${0.75 * (1 - bright)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCheckbox(ctx: OffscreenCanvasRenderingContext2D, n: Node) {
    const p = this.pads(n);
    const box = this.font(n).line;
    const x = n.x + p.l;
    const y = n.y + p.t + Math.max(0, (n.h - p.t - p.b - box) / 2);
    const checked = (n.states & STATE_CHECKED) !== 0;
    const primary = this.rgba(this.prop(n, 'box_color'), 1, PRIMARY);
    this.roundRect(ctx, x + 1, y + 1, box - 2, box - 2, this.dpx(4));
    ctx.fillStyle = checked ? primary : this.rgba(CARD, 1, CARD);
    ctx.fill();
    ctx.lineWidth = this.dpx(2);
    ctx.strokeStyle = primary;
    ctx.stroke();
    if (checked) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1.5, box / 8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + box * 0.25, y + box * 0.52);
      ctx.lineTo(x + box * 0.43, y + box * 0.7);
      ctx.lineTo(x + box * 0.75, y + box * 0.32);
      ctx.stroke();
    }
    this.drawText(ctx, n, x + box + this.num(n, 'pad_column'), n.y + p.t, n.w);
  }

  private drawRoller(ctx: OffscreenCanvasRenderingContext2D, n: Node) {
    const { css, line } = this.font(n);
    const opts = String(this.prop(n, 'options') ?? '').split('\n');
    const sel = Math.max(0, Math.min(opts.length - 1, this.num(n, 'selected')));
    const rowH = line + 6;
    const cy = n.y + n.h / 2;
    ctx.fillStyle = this.rgba(PRIMARY, 1, PRIMARY);
    ctx.fillRect(n.x + this.num(n, 'border_width'), cy - rowH / 2, n.w - 2 * this.num(n, 'border_width'), rowH);
    ctx.font = css;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(n.x, n.y, n.w, n.h);
    ctx.clip();
    opts.forEach((o, i) => {
      ctx.fillStyle = i === sel ? '#FFFFFF' : this.rgba(this.prop(n, 'text_color'), 1, TEXT);
      ctx.fillText(symbols(o), n.x + n.w / 2, cy + (i - sel) * rowH + 0.5);
    });
    ctx.restore();
  }
}
