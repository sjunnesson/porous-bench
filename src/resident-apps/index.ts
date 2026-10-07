// Bundled Lua apps: every .lua file in this folder. The first comment line names it; apps that start
// with a "From inanimate-tech/resident …" line are Resident's own examples, the rest are Bench's.
// `-- @output` and `-- @needs` lines say what hardware it runs on (see src/resident/needs.ts).

import { type AppNeeds, appNeeds } from '../resident/needs';

export interface BundledApp {
  id: string;
  name: string;
  description: string;
  origin: 'bench' | 'resident';
  /** What it draws on, from an `-- @output strip|matrix` line (default: a display). */
  target: 'display' | 'strip' | 'matrix';
  /** What it needs from the output and the board driving it. */
  needs: AppNeeds;
  code: string;
}

const files = import.meta.glob<string>('./*.lua', { query: '?raw', import: 'default', eager: true });

/** An app's name and description from its first comment line ("Name: description", or just a description). */
export function appHeader(code: string): { name?: string; description: string } {
  const line = code
    .split('\n')
    .find((l) => l.startsWith('--') && !/^--\s*(From |@output|@needs)/.test(l))
    ?.replace(/^--\s*/, '');
  const m = line ? /^([^:]{1,40}):\s*(.*)$/.exec(line) : null;
  return { name: m?.[1], description: (m ? m[2] : (line ?? '')).replace(/^\w/, (c) => c.toUpperCase()) };
}

export const residentApps: BundledApp[] = Object.entries(files)
  .map(([path, code]) => {
    const id = path.replace(/^\.\/|\.lua$/g, '');
    const { name, description } = appHeader(code);
    const origin: BundledApp['origin'] = /^--\s*From inanimate-tech\/resident/m.test(code) ? 'resident' : 'bench';
    const needs = appNeeds(code);
    return { id, name: name ?? id, description, origin, target: needs.output, needs, code };
  })
  .sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name));

/** Bench's own examples in a deliberate order (simplest first); the rest alphabetically. */
function order(id: string) {
  const i = ['hello-display', 'patterns', 'characters', 'knob-menu', 'ld2410-radar', 'devil', 'lvgl-motion',
    'led-rainbow', 'led-comet', 'led-fire', 'led-level', 'led-nightlight', 'led-marquee', 'led-life', 'led-plasma'].indexOf(id);
  return i < 0 ? 99 : i;
}
