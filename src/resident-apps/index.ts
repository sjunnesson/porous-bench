// Bundled Lua apps: every .lua file in this folder. The first comment line names it; apps that start
// with a "From inanimate-tech/resident …" line are Resident's own examples, the rest are Bench's.

export interface BundledApp {
  id: string;
  name: string;
  description: string;
  origin: 'bench' | 'resident';
  /** What it draws on, from an `-- @output strip|matrix` line (default: a display). */
  target: 'display' | 'strip' | 'matrix';
  code: string;
}

const files = import.meta.glob<string>('./*.lua', { query: '?raw', import: 'default', eager: true });

export const residentApps: BundledApp[] = Object.entries(files)
  .map(([path, code]) => {
    const id = path.replace(/^\.\/|\.lua$/g, '');
    // First comment line that isn't an attribution line: "Name: description" or just a description.
    const line = code
      .split('\n')
      .find((l) => l.startsWith('--') && !/^--\s*(From |@output)/.test(l))
      ?.replace(/^--\s*/, '');
    const m = line ? /^([^:]{1,40}):\s*(.*)$/.exec(line) : null;
    const origin: BundledApp['origin'] = /^--\s*From inanimate-tech\/resident/m.test(code) ? 'resident' : 'bench';
    const description = (m ? m[2] : (line ?? '')).replace(/^\w/, (c) => c.toUpperCase());
    const tag = /^--\s*@output\s+(display|strip|matrix)\b/m.exec(code)?.[1] as BundledApp['target'] | undefined;
    return { id, name: m ? m[1] : id, description, origin, target: tag ?? 'display', code };
  })
  .sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name));

/** Bench's own examples in a deliberate order (simplest first); the rest alphabetically. */
function order(id: string) {
  const i = ['hello-display', 'patterns', 'characters', 'knob-menu', 'ld2410-radar', 'devil', 'lvgl-motion',
    'led-rainbow', 'led-comet', 'led-fire', 'led-level', 'led-nightlight', 'led-marquee', 'led-life', 'led-plasma'].indexOf(id);
  return i < 0 ? 99 : i;
}
