// `node scripts/logo-app.mjs <logo.svg>`: writes the porous.systems logo into the Porous systems app
// (src/resident-apps/porous-systems.lua), between its "logo data" lines. It reads the logo as the
// brand exports it: a 100×100 viewBox centred on (50, 50), one <line> per spoke, a hollow spoke as an
// outlined capsule <path>, and the words as glyph outlines (<path transform="matrix(s 0 0 s x y)">).
//
// Spokes become { angle in 0.1°, outer radius in 0.1 units } around a shared inner radius (a hollow
// one adds its width and outline). Each letter is stored once,
// as contours of small steps packed one character per step (see ALPHABET), and the words as which
// letter goes where. Everything is in 0.1 logo units, so the app scales it to any screen.

import { readFileSync, writeFileSync } from 'node:fs';

const APP = 'src/resident-apps/porous-systems.lua';
const BEGIN = '-- logo data: written by scripts/logo-app.mjs from the logo SVG, do not edit';
const END = '-- end of logo data';
// One character per step of -40..40 tenths: '#' to 't' less the backslash, so it sits in a plain
// "string". The app builds the same table (V), so change both together.
const ALPHABET = Array.from({ length: 82 }, (_, i) => String.fromCharCode(35 + i))
  .filter((c) => c !== '\\')
  .join('');
const MAX_STEP = (ALPHABET.length - 1) / 2;
const TOLERANCE = 0.07; // how far (logo units) a simplified outline may stray from the curve

const svg = readFileSync(process.argv[2] ?? usage(), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const num = (tag, name) => Number(attr(tag, name));
const tenth = (v) => Math.round(v * 10);
const polar = (x, y) => ({ a: (Math.atan2(y - 50, x - 50) * 180) / Math.PI, r: Math.hypot(x - 50, y - 50) });

// Spokes: solid ones are <line>s; the hollow one is a capsule outline (two sides joined by arcs).
const spokes = [...svg.matchAll(/<line\b[^>]*>/g)].map(([tag]) => {
  const p = polar(num(tag, 'x1'), num(tag, 'y1'));
  return { a: p.a, r1: p.r, r2: polar(num(tag, 'x2'), num(tag, 'y2')).r, w: num(tag, 'stroke-width'), hollow: 0 };
});
for (const [tag] of svg.matchAll(/<path\b[^>]*fill="none"[^>]*>/g)) {
  const pts = [...attr(tag, 'd').matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)|A[^A-Z]*?\s(-?[\d.]+)[ ,](-?[\d.]+)(?=[A-Z])/g)].map((m) =>
    m[1] !== undefined ? [Number(m[1]), Number(m[2])] : [Number(m[3]), Number(m[4])],
  );
  // Side one runs inner → outer, side two outer → inner: the axis is midway between them.
  const [a, b, c, d] = pts;
  const inner = polar((a[0] + d[0]) / 2, (a[1] + d[1]) / 2);
  const outer = polar((b[0] + c[0]) / 2, (b[1] + c[1]) / 2);
  const radius = Number(attr(tag, 'd').match(/A\s*(-?[\d.]+)/)[1]);
  spokes.push({ a: inner.a, r1: inner.r, r2: outer.r, w: radius * 2, hollow: num(tag, 'stroke-width') });
}
spokes.sort((p, q) => p.a - q.a);
const inner = tenth(spokes[0].r1);
if (spokes.some((p) => tenth(p.r1) !== inner)) throw new Error('the spokes start at different radii: the app assumes one');

// The words: glyph outlines in font units, placed and scaled by each path's matrix.
const lines = [...svg.matchAll(/<path\b[^>]*transform="matrix\(([^)]*)\)"[^>]*>/g)].map(([tag, m]) => {
  const [s, , , , tx, ty] = m.split(/[ ,]+/).map(Number);
  const contours = parse(attr(tag, 'd')).map((c) => simplify(c.map(([x, y]) => [tx + x * s, ty + y * s]), TOLERANCE));
  return { baseline: ty, letters: letters(contours) };
});

// Each distinct letter once, positioned by its left edge on the baseline.
const glyphs = [];
const words = lines.map(({ baseline, letters: ls }) => ({
  y: tenth(baseline),
  at: ls.map((contours) => {
    const left = Math.min(...contours.flat().map(([x]) => x));
    const packed = contours.map((c) => pack(c.map(([x, y]) => [tenth(x - left), tenth(y - baseline)])));
    const key = JSON.stringify(packed);
    let i = glyphs.findIndex((g) => g.key === key);
    if (i < 0) i = glyphs.push({ key, packed }) - 1;
    return [i + 1, tenth(left)];
  }),
}));

const lua = [
  BEGIN,
  `local STROKE, INNER = ${tenth(spokes.find((p) => !p.hollow).w)}, ${inner}`,
  '-- spokes: { angle (0.1°), outer radius[, width, outline: a hollow one] }, in 0.1 units',
  'local SPOKES = {',
  ...chunk(spokes.map((p) => `{${[p.a, p.r2, ...(p.hollow ? [p.w, p.hollow] : [])].map(tenth).join(',')}}`), 9).map((r) => `  ${r.join(',')},`),
  '}',
  '-- letters: contours, each its start then one character per x and y step (see V)',
  'local GLYPHS = {',
  ...glyphs.map((g) => `  {${g.packed.map((c) => `{${c.x},${c.y},"${c.steps}"}`).join(',')}},`),
  '}',
  '-- words: { baseline, letter, left edge, letter, left edge, … }',
  'local WORDS = {',
  ...words.map((w) => `  {${w.y},${w.at.flat().join(',')}},`),
  '}',
  END,
].join('\n');

const app = readFileSync(APP, 'utf8');
const start = app.indexOf(BEGIN);
const end = app.indexOf(END);
if (start < 0 || end < 0) throw new Error(`${APP} has no "${BEGIN}" … "${END}" block`);
writeFileSync(APP, app.slice(0, start) + lua + app.slice(end + END.length));
console.log(`${APP}: ${spokes.length} spokes, ${glyphs.length} letters, ${lua.length} bytes of logo data`);

function usage() {
  console.error('usage: node scripts/logo-app.mjs <logo.svg>');
  process.exit(1);
}

/** Contours of an outline path (absolute M, L, Q, Z), curves flattened. */
function parse(d) {
  const tokens = d.match(/[MLQZ]|-?(?:\d+\.?\d*|\.\d+)/g);
  const contours = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let cmd = '';
  for (let i = 0; i < tokens.length; ) {
    if (/[MLQZ]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'Z') {
      cur = null;
      continue;
    }
    const n = () => Number(tokens[i++]);
    if (cmd === 'M') {
      [x, y] = [n(), n()];
      cur = [[x, y]];
      contours.push(cur);
      cmd = 'L';
    } else if (cmd === 'L') {
      [x, y] = [n(), n()];
      cur.push([x, y]);
    } else if (cmd === 'Q') {
      const [cx, cy, ex, ey] = [n(), n(), n(), n()];
      for (let t = 1; t <= 8; t++) {
        const u = t / 8;
        cur.push([(1 - u) ** 2 * x + 2 * (1 - u) * u * cx + u * u * ex, (1 - u) ** 2 * y + 2 * (1 - u) * u * cy + u * u * ey]);
      }
      [x, y] = [ex, ey];
    }
  }
  return contours;
}

/** Douglas–Peucker on a closed contour. */
function simplify(pts, tol) {
  const keep = new Set([0, pts.length - 1]);
  const dist = ([px, py], [ax, ay], [bx, by]) => {
    const [dx, dy] = [bx - ax, by - ay];
    const len = Math.hypot(dx, dy);
    return len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
  };
  const walk = (i, j) => {
    let worst = -1;
    let far = 0;
    for (let k = i + 1; k < j; k++) {
      const d = dist(pts[k], pts[i], pts[j]);
      if (d > far) [far, worst] = [d, k];
    }
    if (far > tol) {
      keep.add(worst);
      walk(i, worst);
      walk(worst, j);
    }
  };
  // Split at the point farthest from the start, so a closed loop simplifies on both halves.
  const mid = pts.reduce((best, p, k) => (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[best][0] - pts[0][0], pts[best][1] - pts[0][1]) ? k : best), 0);
  keep.add(mid);
  walk(0, mid);
  walk(mid, pts.length - 1);
  return [...keep].sort((a, b) => a - b).map((k) => pts[k]);
}

/** Contours grouped into letters: a contour inside another's span (a counter, a bowl) joins it. */
function letters(contours) {
  const spans = contours.map((c) => ({ c, lo: Math.min(...c.map((p) => p[0])), hi: Math.max(...c.map((p) => p[0])) })).sort((a, b) => a.lo - b.lo);
  const out = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && s.lo < last.hi) {
      last.contours.push(s.c);
      last.hi = Math.max(last.hi, s.hi);
    } else out.push({ contours: [s.c], hi: s.hi });
  }
  return out.map((l) => l.contours);
}

/** A contour as its start and one character per step, long moves split into steps the alphabet covers. */
function pack(pts) {
  let steps = '';
  for (let k = 1; k <= pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k % pts.length];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / MAX_STEP));
    let [px, py] = [x0, y0];
    for (let s = 1; s <= n; s++) {
      const [nx, ny] = [x0 + Math.round(((x1 - x0) * s) / n), y0 + Math.round(((y1 - y0) * s) / n)];
      if (nx !== px || ny !== py) steps += ALPHABET[nx - px + MAX_STEP] + ALPHABET[ny - py + MAX_STEP];
      [px, py] = [nx, ny];
    }
  }
  return { x: pts[0][0], y: pts[0][1], steps };
}

function chunk(list, n) {
  return Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
}
