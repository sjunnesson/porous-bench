import type { Color } from './color';

export interface SpriteFrame {
  px: Uint16Array;
  /** 1 = opaque */
  mask: Uint8Array;
}

export interface Sprite {
  width: number;
  height: number;
  frames: SpriteFrame[];
}

/**
 * Pixel-art sprite from text rows. Each character maps to a colour via `palette`;
 * '.' and ' ' are transparent.
 *
 *   const ghost = sprite({ palette: { '#': colors.WHITE, o: colors.BLUE },
 *                          frames: [[ '.###.', '#o#o#', '#####', '#.#.#' ]] });
 */
export function sprite(def: { palette: Record<string, Color>; frames: string[][] }): Sprite {
  const height = Math.max(...def.frames.map((f) => f.length));
  const width = Math.max(...def.frames.flatMap((f) => f.map((row) => row.length)));
  const frames = def.frames.map((rows) => {
    const px = new Uint16Array(width * height);
    const mask = new Uint8Array(width * height);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const c = def.palette[ch];
        if (c === undefined) throw new Error(`sprite: no palette entry for '${ch}'`);
        px[y * width + x] = c;
        mask[y * width + x] = 1;
      }
    });
    return { px, mask };
  });
  return { width, height, frames };
}
