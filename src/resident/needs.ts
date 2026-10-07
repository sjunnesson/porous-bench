// Which apps can run on which output. An output (a display module or an LED chain) and the board
// driving it offer capabilities; an app has needs; the App menu lists the apps whose needs are met.
//
// Needs come from two places:
//  - the code itself: the libraries it binds (lvgl, lgfx, screen, leds) and an estimate of the memory
//    it takes to receive, compile and run on a real board;
//  - a header line for what code can't show: `-- @needs motion color 240x135`, where `motion` means it
//    animates (so not e-paper), `color` that it means nothing in 1-bit, and WxH the smallest screen
//    (as apps see it) its fixed layout fits.
//
// Inputs are never a reason to leave an app out: every control and sensor is on the bench, and a real
// device gets them from Bench through the mirror's shim.

import { type Board, type Library } from '../sim/boards';
import type { DeviceProfile } from '../sim/devices/types';
import { remoteApp } from './remote';

export type OutputTarget = 'display' | 'strip' | 'matrix';

export interface AppNeeds {
  output: OutputTarget;
  libraries: Library[];
  motion: boolean;
  color: boolean;
  /** Smallest screen its layout fits, as apps see it. */
  min?: { w: number; h: number };
  /** Peak heap to receive, compile and start it on a real board (KB, estimated). */
  ramKb: number;
}

export interface OutputCaps {
  output: OutputTarget;
  /** The screen (or LED grid) as apps see it. */
  w: number;
  h: number;
  color: boolean;
  /** Refreshes fast enough to animate (everything but e-paper). */
  motion: boolean;
  libraries: Library[];
  appRamKb?: number;
}

// Measured on an ESP32 without PSRAM (Waveshare e-Paper Driver Board, 2026-10-07), for the app as the
// mirror sends it (shim + app, minified): the message costs ~2x its size while it's parsed and
// compiling ~3.5-4x, so ~6x in all. LVGL's first bind keeps ~30 KB and `datetime` ~35 KB once touched.
// Fragmentation leaves only part of the free heap usable in one go: a load fits in about 3/4 of it.
const LOAD_FACTOR = 6;
const LVGL_KB = 30;
const DATETIME_KB = 35;
const USABLE = 0.75;

const NEEDS_LINE = /^--\s*@needs\b(.*)$/m;

/** What an app needs, from its code and its `-- @needs` line. */
export function appNeeds(code: string): AppNeeds {
  const output = (/^--\s*@output\s+(display|strip|matrix)\b/m.exec(code)?.[1] as OutputTarget | undefined) ?? 'display';
  const libraries: Library[] = [];
  if (/\blvgl\.bind\s*\(/.test(code)) libraries.push('lvgl');
  if (/\blgfx\.bind\s*\(/.test(code)) libraries.push('lgfx');
  if (/\bscreen\.\w+\s*\(/.test(code)) libraries.push('screen');
  if (/\bleds\.\w+/.test(code)) libraries.push('leds');

  const words = (NEEDS_LINE.exec(code)?.[1] ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const size = words.map((w) => /^(\d+)x(\d+)$/.exec(w)).find(Boolean);

  const kb = (remoteApp(code).length * LOAD_FACTOR) / 1024;
  const ramKb = Math.ceil(kb + (libraries.includes('lvgl') ? LVGL_KB : 0) + (/\bdatetime\./.test(code) ? DATETIME_KB : 0));

  return {
    output,
    libraries,
    motion: words.includes('motion'),
    color: words.includes('color') || words.includes('colour'),
    min: size ? { w: Number(size[1]), h: Number(size[2]) } : undefined,
    ramKb,
  };
}

/** What an output offers, driven by `board`. */
export function outputCaps(profile: DeviceProfile, board: Board | undefined): OutputCaps {
  const leds = profile.look.leds;
  const turned = (profile.firmwareRotation ?? 0) % 2 === 1;
  const [w, h] = turned ? [profile.height, profile.width] : [profile.width, profile.height];
  const drawing: Library[] = [...(board?.libraries ?? ['screen', 'lgfx', 'lvgl'])];
  // LEDs aren't a screen: a strip has only `leds`; a matrix is also an lgfx display.
  const libraries: Library[] = !leds ? drawing : leds.layout === 'grid' && drawing.includes('lgfx') ? ['leds', 'lgfx'] : ['leds'];
  return {
    output: leds ? (leds.layout === 'grid' ? 'matrix' : 'strip') : 'display',
    w,
    h,
    color: profile.tech === 'lcd' || profile.tech === 'amoled' || profile.tech === 'led',
    motion: profile.tech !== 'epaper',
    libraries,
    appRamKb: board?.appRamKb,
  };
}

/** Why an app can't run on an output: empty when it fits. */
export function misfits(needs: AppNeeds, caps: OutputCaps): string[] {
  if (needs.output !== caps.output) return [`written for ${needs.output === 'display' ? 'a display' : `an LED ${needs.output}`}`];
  const why: string[] = [];
  for (const lib of needs.libraries) if (!caps.libraries.includes(lib)) why.push(`needs ${lib}`);
  if (needs.motion && !caps.motion) why.push('animates');
  if (needs.color && !caps.color) why.push('needs colour');
  if (needs.min && (caps.w < needs.min.w || caps.h < needs.min.h)) why.push(`needs ${needs.min.w}×${needs.min.h}`);
  if (caps.appRamKb !== undefined && needs.ramKb > caps.appRamKb * USABLE) why.push(`needs ~${needs.ramKb} KB`);
  return why;
}
