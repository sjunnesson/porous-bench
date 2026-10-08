// Bench's device skill (docs/resident/DEVICE-SKILL.md) is how other Claude sessions learn Bench, so
// it must say what the code does. These tests compare it with the device profiles, the boards, the
// Lua modules the sandbox defines and the stand-ins the mirror shim carries.

import { describe, expect, it } from 'vitest';
import skill from '../docs/resident/DEVICE-SKILL.md?raw';
import prelude from '../src/resident/lua/prelude.lua?raw';
import shim from '../src/resident/lua/remote.lua?raw';
import { BOARDS } from '../src/sim/boards';
import { SimClock } from '../src/sim/clock';
import { devices } from '../src/sim/devices';
import { Display } from '../src/sim/display';

/** A section's text, from its heading to the next heading at the same level or above. */
function section(heading: string): string {
  const lines = skill.split('\n');
  const start = lines.findIndex((l) => /^#+ /.test(l) && l.replace(/^#+ /, '').startsWith(heading));
  if (start < 0) throw new Error(`DEVICE-SKILL.md has no section "${heading}"`);
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && l.match(/^#+/)![0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** A Markdown table's body rows, as cells. */
function rows(text: string): string[][] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l))
    .slice(1)
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

/** The size apps see: the panel after the rotation the firmware sets. */
function appSize(d: (typeof devices)[number]): string {
  const display = new Display(d, new SimClock());
  display.setRotation(d.firmwareRotation ?? 0);
  return `${display.width()}×${display.height()}`;
}

const displays = devices.filter((d) => d.tech !== 'led');

describe('DEVICE-SKILL.md', () => {
  it('lists every display at the size apps see, and nothing that is gone', () => {
    const table = rows(section('Hardware'));
    const sizes = table.flatMap((r) => r[1].match(/\d+×\d+/g) ?? []);
    for (const d of displays) expect(sizes, `${d.name} (${appSize(d)}) is missing from the Hardware table`).toContain(appSize(d));
    for (const s of sizes) expect(displays.map(appSize), `the Hardware table lists ${s}, which no display has`).toContain(s);
  });

  it('names every display with a touch panel under touchscreen', () => {
    const text = section('touchscreen');
    for (const d of displays.filter((d) => d.touch)) expect(text, `${d.name} is missing under touchscreen`).toContain(d.name.replace(/^Waveshare /, ''));
  });

  it("gives every board's libraries and memory as boards.ts does", () => {
    const table = rows(section('Boards: libraries and memory'));
    for (const b of BOARDS) {
      // A chip on a module goes by the module's name; any other board by its own, less the chip in brackets.
      const module = b.name.endsWith('(on the board)') ? devices.find((d) => d.id === b.id) : undefined;
      const name = module?.name ?? b.name.replace(/\s*\(.*\)$/, '');
      const row = table.find((r) => r[0].includes(name));
      expect(row, `${name} is missing from the Boards table`).toBeDefined();
      const [, libraries, memory] = row!;
      const listed = [...libraries.matchAll(/(no )?`(\w+)`/g)].filter((m) => !m[1]).map((m) => m[2]);
      expect(listed.sort(), `${name}'s libraries`).toEqual([...b.libraries].sort());
      const expected = b.appRamKb === undefined ? 'not measured' : b.appRamKb >= 1024 ? 'PSRAM' : `~${b.appRamKb} KB`;
      expect(memory, `${name}'s memory for apps`).toContain(expected);
    }
  });

  it('documents every Lua module the sandbox defines, and none it does not', () => {
    const sandbox = prelude.slice(0, prelude.indexOf('the sandbox boundary'));
    const modules = new Set([...sandbox.matchAll(/^\s*([a-z][a-z0-9_]*) = (?:\{|setmetatable)/gm)].map((m) => m[1]));
    const headings = [...skill.matchAll(/^### (.+)$/gm)].flatMap((m) => m[1].replace(/\(.*\)/, '').split(',')).map((h) => h.trim());
    for (const m of modules) expect(headings.includes(m) || skill.includes(`\`${m}\``), `the Lua module \`${m}\` is not in the skill`).toBe(true);
    for (const h of headings) expect([...modules], `the skill has a section for \`${h}\`, which the sandbox doesn't define`).toContain(h);
  });

  it("names every stand-in the mirror shim carries to a real board", () => {
    const text = section('On a real board');
    for (const [, part] of shim.matchAll(/^-- @@part (\w+)$/gm)) expect(text, `the shim's \`${part}\` stand-in is missing`).toContain(`\`${part}\``);
  });
});
