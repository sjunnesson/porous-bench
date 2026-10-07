// Shrinks Lua source for the trip to a real device: drops comments, indentation, trailing spaces and
// blank lines, and keeps everything else byte for byte (strings and long brackets included). A board
// without PSRAM compiles the app in the same ~140 KB as its Wi-Fi and TLS: Bench's 13.4 KB Hello
// display (with the remote shim) failed there with "not enough memory", and 10.5 KB of it compiled.

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

export function minifyLua(src: string): string {
  let out = '';
  let i = 0;
  let lineStart = true; // at the start of a line: indentation is dropped
  while (i < src.length) {
    const c = src[i];
    if (lineStart && (c === ' ' || c === '\t')) {
      i++;
      continue;
    }
    lineStart = false;
    if (c === '-' && src[i + 1] === '-') {
      const level = longBracket(src, i + 2);
      if (level >= 0) {
        // A block comment can sit between two tokens: leave a space so they stay apart.
        i = closeLongBracket(src, i + 4 + level, level);
        out += ' ';
      } else {
        while (i < src.length && src[i] !== '\n') i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const level = longBracket(src, i);
    if (level >= 0) {
      const end = closeLongBracket(src, i + 2 + level, level);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '\n') lineStart = true;
    out += c;
    i++;
  }
  // Trailing spaces (left before a dropped comment) and the blank lines comments leave behind.
  return out.replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').replace(/^\n/, '');
}
