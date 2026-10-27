// Shrinks Lua source for the trip to a real device: drops comments, indentation, blank lines and the
// spaces between tokens that don't need one, and keeps everything else byte for byte (strings and
// long brackets included, and every line break). A board without PSRAM compiles the app in the same
// ~140 KB as its Wi-Fi and TLS: Bench's 13.4 KB Hello display (with the remote shim) failed there with
// "not enough memory", and 10.5 KB of it compiled. On the C6-LCD-1.47 the spaces were a fifth of a
// minified app (Flame C6: 10.4 KB, 8.6 without them).

/** The level of a long bracket opening at `i` (`[[` is 0, `[==[` is 2), or -1 when there's none. */
function longBracket(src: string, i: number): number {
  if (src[i] !== '[') return -1;
  let j = i + 1;
  while (src[j] === '=') j++;
  return src[j] === '[' ? j - i - 1 : -1;
}

/** Index just past the long bracket of `level` that closes after `from`, or the end of the source. */
function closeLongBracket(src: string, from: number, level: number): number {
  const close = `]${'='.repeat(level)}]`;
  const end = src.indexOf(close, from);
  return end < 0 ? src.length : end + close.length;
}

const WORD = /[A-Za-z0-9_]/;
/** Pairs of marks that, written together, read as another token (`- -` as a comment, `[ [` as a
 *  long string, `< =` as `<=`). */
const JOINED = new Set(['--', '..', '==', '~=', '<=', '>=', '//', '<<', '>>', '::', '[[', '[=']);

/** Whether `a` and `b`, either side of dropped space, would run into one token without it: two names
 *  or numbers, a numeral and a dot after it (`1 ..` and `0xFF ..` read as malformed numbers), or two
 *  marks that make another. */
function needsSpace(a: string, b: string): boolean {
  if (WORD.test(a)) return WORD.test(b) || b === '.';
  return JOINED.has(a + b);
}

/** `spaced` keeps a space wherever there was one between tokens: the code as it was minified
 *  before 2026-10-27, which Bench's memory estimate for compiling an app was measured on. */
export function minifyLua(src: string, spaced = false): string {
  let out = '';
  let i = 0;
  let lineStart = true; // at the start of a line: indentation is dropped
  let gap = false; // spaces or a block comment dropped since the last character out
  const put = (s: string) => {
    if (gap && out && !out.endsWith('\n') && (spaced || needsSpace(out[out.length - 1], s[0]))) out += ' ';
    gap = false;
    out += s;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      gap = !lineStart;
      i++;
      continue;
    }
    lineStart = false;
    if (c === '-' && src[i + 1] === '-') {
      const level = longBracket(src, i + 2);
      if (level >= 0) {
        // A block comment can sit between two tokens: it counts as a space between them.
        i = closeLongBracket(src, i + 4 + level, level);
        gap = true;
      } else {
        while (i < src.length && src[i] !== '\n') i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      put(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    const level = longBracket(src, i);
    if (level >= 0) {
      const end = closeLongBracket(src, i + 2 + level, level);
      put(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '\n') {
      lineStart = true;
      gap = false;
      out += c;
    } else {
      put(c);
    }
    i++;
  }
  // The blank lines comments leave behind.
  return out.replace(/\n{2,}/g, '\n').replace(/^\n/, '');
}
