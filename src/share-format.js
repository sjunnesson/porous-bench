// What a share link carries, and how it's written: the setup as JSON, compressed with raw DEFLATE,
// in base64url, after the format's version (`1.<data>`). A long link holds it after `#share=`; a
// short one names it, stored on Bench's server (api/). Plain JavaScript, typed with JSDoc, so the
// Vercel functions can run it as it is: Vercel's builder can't compile TypeScript 7.

/**
 * Everything a link carries.
 * @typedef {object} Setup
 * @property {import('./sim/leds').Output} output
 * @property {string} board
 * @property {import('./sim/controls/bench').PartSpec[]} parts The parts you added (the board's own come with the board).
 * @property {Record<string, string>} connections Each of the app's controls, by name: the part and channel it reads ('part:channel', or 'none').
 * @property {{ bundled: string } | { name: string, code: string, description?: string }} app A bundled app by its id, or your own as its code.
 */

/** The format, first in the data: a later Bench can still read links made today. */
const VERSION = '1';
/** Decompressed, a setup Bench made is far smaller than this; a bigger one isn't read. */
const MAX_BYTES = 1 << 20;
/**
 * Caps on what a link may ask Bench to build. Each part becomes a 3D model and a widget, and the
 * parts are saved, so a link with thousands would hang the page again on every reload.
 */
const MAX_PARTS = 64;
const MAX_CONNECTIONS = 128;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 2000;

/**
 * A setup as link data (`1.<base64url>`).
 * @param {Setup} setup
 * @returns {Promise<string>}
 */
export async function encodeSetup(setup) {
  const packed = await through(new TextEncoder().encode(JSON.stringify(setup)), new CompressionStream('deflate-raw'));
  return `${VERSION}.${toBase64Url(packed)}`;
}

/**
 * The setup in link data; null if it's damaged, cut short or not a setup.
 * @param {string} data
 * @returns {Promise<Setup | null>}
 */
export async function decodeSetup(data) {
  if (!data.startsWith(`${VERSION}.`)) return null;
  try {
    const bytes = await through(fromBase64Url(data.slice(VERSION.length + 1)), new DecompressionStream('deflate-raw'), MAX_BYTES);
    return asSetup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Decoded JSON as a Setup, or null if it isn't one (the rest is checked as it's opened).
 * @param {any} s
 * @returns {Setup | null}
 */
function asSetup(s) {
  const app = s?.app;
  const ok =
    short(s?.output?.kind) &&
    short(s.board) &&
    Array.isArray(s.parts) &&
    s.parts.length <= MAX_PARTS &&
    s.parts.every((/** @type {any} */ p) => short(p?.id) && short(p.kind) && short(p.label)) &&
    typeof s.connections === 'object' &&
    s.connections !== null &&
    !Array.isArray(s.connections) &&
    Object.keys(s.connections).length <= MAX_CONNECTIONS &&
    Object.entries(s.connections).every(([k, c]) => short(k) && typeof c === 'string' && c.length <= 2 * MAX_NAME) &&
    (short(app?.bundled) ||
      (short(app?.name) && typeof app.code === 'string' && (app.description === undefined || (typeof app.description === 'string' && app.description.length <= MAX_DESCRIPTION))));
  return ok ? s : null;
}

/**
 * A name, id or label no longer than Bench would make one.
 * @param {unknown} v
 */
function short(v) {
  return typeof v === 'string' && v.length <= MAX_NAME;
}

/**
 * Runs bytes through a (de)compression stream, giving up past `limit` bytes out.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {CompressionStream | DecompressionStream} stream
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function through(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Base64 with the URL-safe alphabet and no padding: nothing a chat app or browser rewrites.
 * @param {Uint8Array} bytes
 */
export function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @param {string} text */
function fromBase64Url(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
