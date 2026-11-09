// What Bench counts about how it's used, through Vercel Web Analytics: no cookies, nothing kept in the
// browser. EVENTS is every event it sends, with the names of the values each carries: at most two,
// as many as Vercel's Pro plan keeps. A value is one of Bench's own names (a bundled app's id, a
// display's or board's id, a part's kind, a kind of error), never something of a person's: not their
// app's code or name, a folder, a device ID, an error's text or a share link's id. privacy.html lists
// every event (tests/analytics.test.ts checks it does).
//
// Each distinct event, values and all, is sent once per page load. A count then reads as "visits that
// did this", and counts side by side read as a funnel (visits that ran an app, ran their own code,
// mirrored it to a board) without anything that follows a person from one step to the next.

import { inject, track as send } from '@vercel/analytics';

export const EVENTS = {
  /** The output and board an app ran on: the display's (or LED chain's) id and the board's. */
  setup: ['display', 'board'],
  /** An app started: a bundled app's id or `own`, and the output kind (display, strip, ring, matrix). */
  ran_app: ['app', 'output'],
  /** The visitor's own code ran, and how it came in: editor, file, drop, watch, relay or bench (Start from my bench). */
  own_code: ['via'],
  /** An app stopped on an error: compile, runtime, deadline, memory, halt or store_full. */
  app_error: ['app', 'stage'],
  /** An app booted cleanly after an error earlier in the visit. */
  recovered: ['app'],
  /** An app this output and board can't run, and why: motion, colour, touch, haptic, size, memory or lib:<name>. */
  wont_fit: ['app', 'reason'],
  /** A part put on the bench, by the visitor (user) or by an app that asked for it (app). */
  part_added: ['kind', 'by'],
  /** The view in use: 3d, flat or wiring. */
  view: ['mode'],
  /** A prompt for Claude copied (app or firmware), for which display. */
  copied_prompt: ['which', 'display'],
  /** A share link made: short, or long when the server couldn't keep it. */
  shared: ['link'],
  /** A share link opened: short or long, and its app (a bundled app's id, `own` or `none`). */
  opened_share: ['link', 'app'],
  /** A share link that didn't open: damaged, not_found, unreachable or storage. */
  share_failed: ['reason'],
  /** Connect pressed in Receive apps, to take apps pushed over the relay. */
  relay_connected: [],
  /** Mirroring to a real board: live, offline, refused, unreachable or too_big; and the display Bench showed. */
  mirror: ['result', 'display'],
  /** Something in Bench itself broke: where (page, promise, app, 3d, wiring), and the error's kind (TypeError, webgl…). */
  crash: ['where', 'kind'],
  /** The page froze running an app last time (seen on the next load). */
  froze: ['app'],
  /** Bench's device skill fetched, from api/device-skill.js on the server: by which prompt, and what fetched it (claude, curl, browser, other). */
  device_skill: ['from', 'client'],
} as const satisfies Record<string, readonly [] | readonly [string] | readonly [string, string]>;

type EventName = keyof typeof EVENTS;
type Values<E extends EventName> = { [K in (typeof EVENTS)[E][number]]: string };

/** Call once, before anything is tracked: counts page views, with the URL as `scrub` leaves it. */
export function startAnalytics(scrub: (url: string) => string): void {
  inject({ mode: import.meta.env.DEV ? 'development' : 'production', beforeSend: (e) => ({ ...e, url: scrub(e.url) }) });
}

const sent = new Set<string>();

/** Count an event, once per page load for each set of values. Outside a page (tests) it does nothing. */
export function track<E extends Exclude<EventName, 'device_skill'>>(name: E, ...values: (typeof EVENTS)[E] extends readonly [] ? [] : [Values<E>]): void {
  if (typeof window === 'undefined') return;
  const key = `${name} ${JSON.stringify(values[0] ?? {})}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    send(name, values[0]);
  } catch {
    /* counting never gets in the way */
  }
}

/** How an app is named in events: a bundled app's id, or `own` for anything the visitor brought. */
export function appRef(entryId: string): string {
  return entryId === 'resident:live' ? 'own' : entryId.replace(/^resident:/, '');
}

/** The kind of an error, never its text: its class name (TypeError), or `other`. */
export function errorKind(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  return /^[A-Za-z]{1,40}$/.test(name) ? name : 'other';
}

/** The stage a Lua error stopped an app at, from Resident's message (src/resident/lua/prelude.lua). */
export function errorStage(message: string): 'halt' | 'deadline' | 'memory' | 'runtime' {
  if (message.startsWith('app halted:')) return 'halt';
  if (message.includes('execution deadline exceeded')) return 'deadline';
  if (message.includes('not enough memory')) return 'memory';
  return 'runtime';
}

/**
 * What a reason from `misfits()` (src/resident/needs.ts) counts as. Null for an app written for
 * another kind of output: that's expected, not something anyone got stuck on.
 */
export function misfitKind(why: string): string | null {
  if (why.startsWith('written for')) return null;
  if (why === 'animates') return 'motion';
  if (why === 'needs colour') return 'colour';
  if (why === 'needs a touchscreen') return 'touch';
  if (why === 'needs a haptic knob') return 'haptic';
  if (/^needs \d+×\d+$/.test(why)) return 'size';
  if (/^needs ~\d+ KB$/.test(why)) return 'memory';
  const lib = /^needs ([\w-]+)$/.exec(why);
  return lib ? `lib:${lib[1]}` : 'other';
}

const failed = new Set<string>();

/** An app (appRef) stopped on an error. */
export function appFailed(app: string, stage: 'compile' | ReturnType<typeof errorStage> | 'store_full'): void {
  failed.add(app);
  track('app_error', { app, stage });
}

/** An app (appRef) booted without an error: if it had failed before, it recovered. */
export function appBooted(app: string): void {
  if (failed.delete(app)) track('recovered', { app });
}
