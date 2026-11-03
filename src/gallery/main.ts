// The gallery: apps made with Bench, running live, shown as nothing but their screens, each at its
// real size and all at one scale. Each entry is a short share link's id (entries.json, added with
// `npm run gallery -- add <link>`). Clicking a screen opens it in Bench.
//
// A screen under the pointer is the board in your hand: the app's keys work (A, B and any dial's),
// a touch panel takes presses and drags, and a board with an IMU tilts towards the pointer (and a
// quick back-and-forth shakes it). Nothing says so: the screens are all there is, and a ↗ beside the
// one under the pointer opens it in Bench (on a touch panel a click is a press). An app boots when its screen first comes near the view and stops
// while it's off it (each runs on its own clock), so a long gallery costs what's in view. Sizes are
// millimetres times one CSS variable, --mm (CSS pixels per mm), set to suit the window.

import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '../styles.css';
import './gallery.css';
import { startAnalytics } from '../analytics';
import { decodeSetup } from '../share-format';
import { glassMm, isCircle } from '../sim/enclosure';
import type { Imu } from '../sim/inputs/imu';
import { drawLeds, ledCells } from '../sim/leds';
import type { SketchRun } from '../sim/runner';
import entries from './entries.json';
import { type Exhibit, openSetup } from './open';
import { glassPixel, shakeDetector, tiltAt } from './pointer';

export interface Entry {
  /** The short share link's id (bench.porous.systems/s/<id>). */
  id: string;
  /** In place of the app's own name, where a name is given (the link's label for screen readers). */
  title?: string;
}

startAnalytics((url) => url.split(/[?#]/)[0]);

/** Where a screen opens: this Bench when the gallery is one of its pages, otherwise Bench's own site. */
const BENCH = location.pathname.startsWith('/gallery') ? '' : 'https://bench.porous.systems';
/** The widest screen the scale makes room for, in mm: past it, an LED strip is shown cut off. */
const FIT_MM = 340;
/** How far a screen leans on the page at its edge, as the IMU sees it lean further. */
const LEAN_DEG = 10;

const root = document.getElementById('root')!;
root.innerHTML = `
  <header class="masthead"><h1><a href="${BENCH || '/'}">Bench</a> Gallery</h1></header>
  <ol class="drawer"></ol>
`;
const drawer = root.querySelector<HTMLOListElement>('.drawer')!;

const list = entries as Entry[];
if (!list.length) {
  drawer.insertAdjacentHTML(
    'afterend',
    `<p class="empty">Nothing here yet.${import.meta.env.DEV ? ' Add an app with <code>npm run gallery -- add &lt;share link&gt;</code>.' : ''}</p>`,
  );
}

/** A live screen: its app, where it's drawn, and what was drawn last. */
interface Live {
  exhibit: Exhibit;
  /** The glass in mm, before it's turned. */
  glass: { w: number; h: number; round: boolean };
  item: HTMLLIElement;
  frame: HTMLAnchorElement;
  canvas: HTMLCanvasElement;
  run: SketchRun | null;
  image: ImageData;
  turn: number;
  drawn: { shows: number; brightness: number; at: number };
  visible: boolean;
}
const shown: Live[] = [];

const observer = new IntersectionObserver(
  (changes) => {
    for (const c of changes) {
      const live = shown.find((l) => l.item === c.target);
      if (!live) continue;
      live.visible = c.isIntersecting;
      if (live.visible && !live.run) live.run = live.exhibit.start((err) => console.warn(`${live.exhibit.name} stopped:`, err));
      live.exhibit.clock.paused = !live.visible || document.hidden;
    }
  },
  { rootMargin: '200px' },
);
addEventListener('visibilitychange', () => {
  for (const l of shown) if (l.run) l.exhibit.clock.paused = !l.visible || document.hidden;
});

// Slots in the list's order, filled as each setup arrives.
list.forEach((entry) => {
  const item = document.createElement('li');
  item.className = 'specimen loading';
  drawer.append(item);
  void load(entry, item);
});

async function load(entry: Entry, item: HTMLLIElement) {
  let why = '';
  try {
    const r = await fetch(`/api/share/${encodeURIComponent(entry.id)}`);
    const setup = r.ok ? await decodeSetup(await r.text()) : null;
    const exhibit = setup
      ? openSetup(setup)
      : r.ok
        ? 'its setup is damaged'
        : r.status === 404
          ? 'nothing is stored under that link'
          : `the share store answered ${r.status}`;
    if (typeof exhibit !== 'string') return show(entry, item, exhibit);
    why = exhibit;
  } catch {
    why = "Bench's share store couldn't be reached";
  }
  // Said where you'd look for it, not on the page: the gallery shows screens, and this one has none.
  item.remove();
  console.warn(`Gallery: ${entry.id} didn't open: ${why}.`);
}

function show(entry: Entry, item: HTMLLIElement, exhibit: Exhibit) {
  const { device } = exhibit;
  const g = glassMm(device);
  const glass = { w: g.w, h: g.h, round: device.shape === 'round' || isCircle(g.w, g.h, g.radius) };
  const name = entry.title ?? exhibit.name;

  item.className = 'specimen';
  item.dataset.tech = device.tech;
  if (device.touch) item.dataset.touch = '';
  item.style.setProperty('--w', String(glass.w));
  item.style.setProperty('--h', String(glass.h));
  item.innerHTML = `
    <a class="frame" href="${BENCH}/s/${entry.id}" aria-label="${escape(name)}, open in Bench"><canvas class="glass"></canvas></a>
    <a class="open" href="${BENCH}/s/${entry.id}" title="Open in Bench" aria-label="Open ${escape(name)} in Bench">↗</a>`;
  const frame = item.querySelector<HTMLAnchorElement>('.frame')!;
  const canvas = item.querySelector<HTMLCanvasElement>('.glass')!;
  canvas.style.borderRadius = glass.round ? '50%' : `calc(${+g.radius.toFixed(3)} * var(--mm))`;
  if (device.tech === 'led') {
    // LEDs are painted as glowing dots: room for the glow, as the 3D view gives them.
    const cells = ledCells(device);
    const per = device.look.leds?.layout === 'ring' ? 64 : 24;
    canvas.width = Math.min(2048, cells.w * per);
    canvas.height = Math.min(2048, cells.h * per);
  } else {
    canvas.width = device.width;
    canvas.height = device.height;
  }

  const live: Live = {
    exhibit,
    glass,
    item,
    frame,
    canvas,
    run: null,
    image: new ImageData(device.width, device.height),
    turn: -1,
    drawn: { shows: -1, brightness: -1, at: 0 },
    visible: false,
  };
  shown.push(live);
  // Before it boots, the screen lies the way its firmware turns it.
  orient(live, device.firmwareRotation ?? 0);
  handle(live);
  autoScale();
  observer.observe(item);
}

/** Lay the screen so the app reads upright: turned against the rotation the app draws in. */
function orient(live: Live, rotation: number) {
  const turn = (4 - (rotation % 4)) % 4;
  if (turn === live.turn) return;
  live.turn = turn;
  const [fw, fh] = turn % 2 ? [live.glass.h, live.glass.w] : [live.glass.w, live.glass.h];
  live.item.style.setProperty('--fw', String(fw));
  live.item.style.setProperty('--fh', String(fh));
  live.item.style.setProperty('--turn', `${turn * 90}deg`);
  fit(live);
}

/** Pixels drawn larger than the panel's own stay crisp squares; drawn smaller, they're smoothed. */
function fit(live: Live) {
  const { device } = live.exhibit;
  const shownPx = live.glass.w * scale * (devicePixelRatio || 1);
  live.canvas.style.imageRendering = device.tech !== 'led' && shownPx >= device.width ? 'pixelated' : 'auto';
  // A strip longer than the drawer is cut off at its edge, and fades out there.
  live.item.classList.toggle('cut', (live.turn % 2 ? live.glass.h : live.glass.w) * scale > inner());
}

/** The drawer's width inside its padding. */
function inner(): number {
  const style = getComputedStyle(drawer);
  return drawer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

// ---- the screen in your hand ----------------------------------------------------------------------

/** The screen under the pointer (or focused): the one the keyboard reaches. */
let active: Live | null = null;
/** Keys held down on it, let go when it stops being the one. */
const held = new Set<string>();

function press(code: string, down: boolean): boolean {
  if (!active?.run) return false;
  let handled = false;
  for (const control of active.run.controls) if (control.handleKey(code, down)) handled = true;
  if (handled && down) held.add(code);
  if (!down) held.delete(code);
  return handled;
}
function letGo() {
  for (const code of [...held]) press(code, false);
}
const onKey = (down: boolean) => (e: KeyboardEvent) => {
  if (down && (e.metaKey || e.ctrlKey || e.altKey)) return;
  if ((e.target as HTMLElement).closest?.('input, select, textarea') && !held.has(e.code)) return;
  if (press(e.code, down)) e.preventDefault();
};
addEventListener('keydown', onKey(true));
addEventListener('keyup', onKey(false));
addEventListener('blur', letGo);

function activate(live: Live | null) {
  if (active === live) return;
  if (active) {
    letGo();
    level(active);
    active.item.classList.remove('active');
  }
  active = live;
  live?.item.classList.add('active');
}

function imuOf(live: Live): Imu | undefined {
  return live.run?.bench.first<Imu>('imu');
}

/** Put the board down flat, and the screen back square on the page. */
function level(live: Live) {
  imuOf(live)?.setTilt(0, 0);
  live.item.style.setProperty('--rx', '0deg');
  live.item.style.setProperty('--ry', '0deg');
}

function handle(live: Live) {
  const { frame } = live;
  const shake = shakeDetector();
  /** A press on the touch panel is under way: the click it ends in isn't a click on the link. */
  let touching = false;
  let pressed = false;

  /** The pointer from the screen's centre, in CSS px, and as a share of its half-size. */
  const offset = (e: PointerEvent) => {
    const r = frame.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { dx, dy, sx: dx / (r.width / 2), sy: dy / (r.height / 2) };
  };
  const pixel = (e: PointerEvent) => {
    const { dx, dy } = offset(e);
    const { device } = live.exhibit;
    return glassPixel(dx, dy, live.turn, live.glass.w * scale, live.glass.h * scale, device.width, device.height, live.glass.round);
  };

  // The screen and the ↗ beside it are one place to point at: the ↗ stays in reach.
  const { item } = live;
  item.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && activate(live));
  item.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && !pressed) activate(null);
  });
  item.addEventListener('focusin', () => activate(live));
  item.addEventListener('focusout', (e) => {
    if (active === live && !item.contains(e.relatedTarget as Node | null) && !item.matches(':hover')) activate(null);
  });

  frame.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || active !== live) return;
    const { sx, sy } = offset(e);
    const imu = imuOf(live);
    if (imu) {
      const t = tiltAt(sx, sy, live.turn);
      imu.setTilt(t.x, t.y);
      // On the page, the side under the pointer goes down a little: away from you.
      live.item.style.setProperty('--ry', `${(Math.max(-1, Math.min(1, sx)) * LEAN_DEG).toFixed(2)}deg`);
      live.item.style.setProperty('--rx', `${(-Math.max(-1, Math.min(1, sy)) * LEAN_DEG).toFixed(2)}deg`);
      if (shake(e.clientX, e.clientY, e.timeStamp)) imu.shake();
    }
    const touch = live.run?.display.touch;
    if (touch?.isPressed()) {
      const p = pixel(e);
      if (p) touch.move(...p);
    }
  });

  frame.addEventListener('pointerdown', (e) => {
    const touch = live.run?.display.touch;
    touching = false;
    if (e.pointerType === 'touch' || e.button !== 0 || !touch) return;
    const p = pixel(e);
    if (!p) return;
    touching = true;
    pressed = true;
    frame.setPointerCapture(e.pointerId);
    touch.press(...p);
    e.preventDefault(); // no drag of the link
  });
  const lift = () => {
    if (!pressed) return;
    pressed = false;
    live.run?.display.touch?.release();
    // Dragged off the screen and let go there: it's no longer the one.
    if (!item.matches(':hover')) activate(null);
  };
  frame.addEventListener('pointerup', lift);
  frame.addEventListener('pointercancel', lift);
  frame.addEventListener('lostpointercapture', lift);
  // A press on the touch panel is the app's, not a click on the link.
  frame.addEventListener('click', (e) => {
    if (touching) e.preventDefault();
    touching = false;
  });
  frame.addEventListener('dragstart', (e) => e.preventDefault());
}

// ---- drawing ------------------------------------------------------------------------------------

function draw(live: Live) {
  const run = live.run;
  if (!run || !live.visible || document.hidden) return;
  const { display } = run;
  // The app's rotation, once it has set it and drawn.
  if (display.stats.shows) orient(live, display.getRotation());
  const { panel } = display;
  const now = performance.now();
  // A flip, a change of brightness or (e-paper) a refresh under way changes the glass; otherwise
  // it's drawn again only now and then.
  const still = display.stats.shows === live.drawn.shows && panel.brightness === live.drawn.brightness && now - live.drawn.at < 500;
  if (still && live.exhibit.device.tech !== 'epaper') return;
  live.drawn = { shows: display.stats.shows, brightness: panel.brightness, at: now };
  panel.render(live.exhibit.clock.now(), live.image.data);
  const ctx = live.canvas.getContext('2d')!;
  if (live.exhibit.device.tech === 'led') {
    ctx.clearRect(0, 0, live.canvas.width, live.canvas.height);
    drawLeds(ctx, live.exhibit.device, live.image.data, 0, 0, live.canvas.width, live.canvas.height);
  } else ctx.putImageData(live.image, 0, 0);
}

function frame() {
  for (const live of shown) draw(live);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- scale --------------------------------------------------------------------------------------

// Big enough to read the smaller screens, small enough that the biggest fits.
let scale = 0;
function setScale(mm: number) {
  scale = mm;
  document.documentElement.style.setProperty('--mm', `${scale}px`);
  for (const l of shown) fit(l);
}
function autoScale() {
  // Every screen fits across the drawer whole, up to a 32 × 8 matrix (about a third of a metre);
  // only a longer LED strip is cut (fit()). At most 6 px a mm, which puts most panels' pixels about
  // one to one on a 2× display, and at least 2.5, where a 1.47" panel's text still reads: on a
  // phone, that cuts a matrix rather than shrinking every screen to fit it.
  const room = inner() || innerWidth;
  const widest = Math.max(80, ...shown.map((l) => Math.min(FIT_MM, l.turn % 2 ? l.glass.h : l.glass.w)));
  setScale(Math.max(Math.min(2.5, (room * 0.92) / 80), Math.min(6, (room * 0.92) / widest)));
}
addEventListener('resize', autoScale);
autoScale();

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
