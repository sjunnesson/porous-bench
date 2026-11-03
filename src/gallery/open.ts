// A share link's setup as the gallery runs it: the output and the board driving it, the parts on the
// bench and what each of the app's controls is connected to, and the app, booted as Bench boots it
// (src/resident/run.ts). Nothing of the visitor's is touched: the app's store starts empty each time,
// its events go nowhere and nothing is counted. No DOM here, so the tests run it too.

import type { LuaFactory } from 'wasmoon';
import { appSketch, type ResidentAppSource } from '../resident/run';
import { outputCaps } from '../resident/needs';
import { Zone } from '../resident/zone';
import { appHeader, residentApps } from '../resident-apps';
import type { Setup } from '../share-format';
import { type Board, boardsFor } from '../sim/boards';
import { SimClock } from '../sim/clock';
import { boardBench, CHANNELS } from '../sim/controls/bench';
import { outputDevice } from '../sim/devices';
import type { DeviceProfile } from '../sim/devices/types';
import { SketchRun } from '../sim/runner';

export interface Exhibit {
  device: DeviceProfile;
  board: Board;
  /** The app's name and description, as it gives them. */
  name: string;
  description: string;
  /** A bundled app's id, if it's one. */
  bundled?: string;
  /** What this Bench doesn't have, so left out (the link may be from a later one). */
  missing: string[];
  /** Each exhibit runs on its own clock, so one off the screen can stop while the others go on. */
  clock: SimClock;
  /** Boot the app (once). `onError`: it stopped on an error. */
  start(onError?: (err: unknown) => void): SketchRun;
}

const zone = new Zone();

/** The setup as an exhibit, or why it can't be one. */
export function openSetup(setup: Setup, opts: { factory?: () => Promise<LuaFactory> } = {}): Exhibit | string {
  const device = outputDevice(setup.output);
  if (!device) return setup.output.kind === 'display' ? `this Bench doesn't have the display "${setup.output.device}"` : `this Bench doesn't have that LED ${setup.output.kind}`;
  const missing: string[] = [];
  const boards = boardsFor(device);
  const board = boards.find((b) => b.id === setup.board) ?? boards[0];
  if (board.id !== setup.board) missing.push(`the board "${setup.board}"`);

  let app: ResidentAppSource;
  if ('bundled' in setup.app) {
    const id = setup.app.bundled;
    const found = residentApps.find((a) => a.id === id);
    if (!found) return `this Bench doesn't have the app "${id}"`;
    app = { id, name: found.name, code: found.code, description: found.description || undefined };
  } else app = { name: setup.app.name, code: setup.app.code, description: setup.app.description ?? (appHeader(setup.app.code).description || undefined) };

  const parts = setup.parts.filter((p) => Object.hasOwn(CHANNELS, p.kind));
  for (const p of setup.parts) if (!Object.hasOwn(CHANNELS, p.kind)) missing.push(`the part "${p.kind}"`);

  const clock = new SimClock();
  const libraries = outputCaps(device, board).libraries;
  let run: SketchRun | null = null;
  return {
    device,
    board,
    name: app.name,
    description: app.description ?? '',
    bundled: app.id,
    missing: [...new Set(missing)],
    clock,
    start(onError) {
      if (run) return run;
      const sketch = appSketch(app, { zone: () => zone, factory: opts.factory });
      const bench = boardBench(device, clock, parts, board.id);
      run = new SketchRun(sketch, device, clock, { bindingFor: (control) => setup.connections[control] ?? null, onError }, bench, libraries);
      void run.start();
      return run;
    },
  };
}
