import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Board } from '../sim/boards';
import { CHANNELS, type PartKind, parseConnection } from '../sim/controls/bench';
import type { SketchRun } from '../sim/runner';
import { gpioName, type Rail, type WiredPart, type Wiring, wiring } from '../sim/wiring';

// The bench as a wiring diagram, to build it on a desk: the board on the left with the GPIOs in use,
// the supply rails down the gutter, and each part on the right, every signal wire running straight
// across to its pin. Each part says which of the app's controls it drives, as Connections has it.
// The SVG carries its own styles, so a saved copy looks the same outside Bench.

const ROW = 24;
const PAD = 20;
const BOARD_W = 190;
const GUTTER = 190;
const PART_W = 250;
const GAP = 18;
const RAILS: Rail[] = ['3V3', '5V', 'GND'];
const DISCLAIMER = "Please verify that the wiring is correct against your board's own pinout before you power it up.";
const RAIL_X: Record<Rail, number> = { '3V3': 26, '5V': 44, GND: 62 };

const STYLE = `
  .wd text { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; fill: #11181c; }
  .wd .title { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 13px; font-weight: 500; }
  .wd .small { font-size: 9.5px; letter-spacing: 0.08em; fill: #5a666d; }
  .wd .drives { font-size: 10px; fill: #1b4b7a; }
  .wd .box { fill: #f4f7f9; stroke: #1b4b7a; stroke-opacity: 0.55; }
  .wd .board { fill: #f4f7f9; stroke: #11181c; stroke-opacity: 0.7; }
  .wd .pin { fill: #f4f7f9; stroke: #11181c; stroke-width: 1; }
  .wd .w { fill: none; stroke-width: 2; stroke-linecap: round; }
  .wd .sig { stroke: #1b4b7a; }
  .wd .r-3V3 { stroke: #c0392b; } .wd .f-3V3 { fill: #c0392b; }
  .wd .r-5V { stroke: #d4801c; } .wd .f-5V { fill: #d4801c; }
  .wd .r-GND { stroke: #11181c; } .wd .f-GND { fill: #11181c; }
  .wd .missing { stroke: #8c3b1e; stroke-dasharray: 4 4; }
  .wd text.warn { fill: #8c3b1e; }
  .wd .nc { stroke: #5a666d; stroke-width: 1; }
  .wd g.part { transition: opacity 0.15s; }
  .wd.hot g.part:not(.hot) { opacity: 0.22; }
`;

interface Laid {
  part: WiredPart;
  y: number;
  h: number;
  drives: string[];
  /** y of each wire's row. */
  rows: number[];
}

export function WiringView({ run, board, onSvg }: { run: SketchRun; board: Board; onSvg?(svg: SVGSVGElement | null): void }) {
  const bench = run.bench;
  const version = useSyncExternalStore(bench.subscribe, bench.getVersion);
  const w = useMemo(() => wiring(run.device, board, bench.hardware()), [run, board, bench, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hot, setHot] = useState<string | null>(null);

  // Which of the app's controls each part drives, as "speed (turn)".
  const drives = (p: WiredPart) =>
    run.controls.flatMap((c) => {
      const conn = parseConnection(c.source);
      if (conn?.part !== p.id) return [];
      const ch = CHANNELS[p.kind as PartKind]?.find((x) => x.id === conn.channel);
      return [`${c.label}${ch && CHANNELS[p.kind as PartKind].length > 1 ? ` (${ch.label})` : ''}`];
    });

  // Lay the parts out down the right: the rails need the board's supply pins above the first part.
  const rails = RAILS.filter((r) => [w.output, ...w.parts].some((p) => p?.wires.some((x) => x.rail === r)));
  const top = PAD + 44 + rails.length * ROW + 10;
  const laid: Laid[] = [];
  let y = top;
  for (const part of [...(w.output ? [w.output] : []), ...w.parts]) {
    const d = drives(part);
    const head = 42 + d.length * 14 + (d.length ? 4 : 0);
    const rows = part.wires.map((_, i) => y + head + i * ROW + ROW / 2);
    const h = head + part.wires.length * ROW + 8;
    laid.push({ part, y, h, drives: d, rows });
    y += h + GAP;
  }
  const bottom = Math.max(y - GAP, top + 40);
  const boardR = PAD + BOARD_W;
  const partL = boardR + GUTTER;
  const width = partL + PART_W + PAD;
  // Room under the diagram for the disclaimer, so a printed copy carries it too.
  const height = bottom + PAD + 22;
  const railTop = (r: Rail) => PAD + 44 + rails.indexOf(r) * ROW + ROW / 2;
  const railBottom = (r: Rail) => Math.max(railTop(r), ...laid.flatMap((l) => l.part.wires.flatMap((x, i) => (x.rail === r ? [l.rows[i]] : []))));

  const notes = studentNotes(w);
  const nothing = laid.length === 0;
  // A board that is the display's own reads better by the display's name.
  const boardName = / \(on the board\)$/.test(board.name) ? run.device.name : board.name;

  return (
    <div className="wiring">
      <div className="wiring-head">
        <h2>Wiring · {boardName}</h2>
        <p>
          {nothing
            ? 'Nothing to wire: everything on this bench is on the board. Add an input to see where it goes.'
            : `Build this bench on a desk: each part's pins and the board pin each one goes to.${w.pinout ? ` Pins from the ${w.pinout.source}.` : ''}`}
        </p>
        {!nothing && <p className="wiring-check">{DISCLAIMER} Bench picks these pins from datasheets and schematics, and it can get one wrong.</p>}
        {w.problems.map((p) => (
          <p key={p} className="warn">
            {p}
          </p>
        ))}
      </div>

      {!nothing && (
        <svg
          ref={onSvg}
          className={`wd ${hot ? 'hot' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          style={{ maxWidth: width }}
          role="img"
          aria-label={`Wiring diagram for ${boardName}`}
        >
          <style>{STYLE}</style>
          <rect x={0} y={0} width={width} height={height} fill="#e6ebee" />

          {/* The board, its supply pins at the top. */}
          <rect className="board" x={PAD} y={PAD} width={BOARD_W} height={bottom - PAD} />
          <text className="title" x={PAD + 12} y={PAD + 20}>
            {shortBoard(boardName)}
          </text>
          <text className="small" x={PAD + 12} y={PAD + 35}>
            BOARD
          </text>
          {rails.map((r) => {
            const ry = railTop(r);
            const rx = boardR + RAIL_X[r];
            return (
              <g key={r}>
                <text x={boardR - 12} y={ry + 4} textAnchor="end">
                  {r === '5V' ? (w.pinout?.fiveVolt ?? '5V') : r}
                </text>
                <rect className="pin" x={boardR - 4} y={ry - 4} width={8} height={8} />
                <polyline className={`w r-${r}`} points={`${boardR + 4},${ry} ${rx},${ry} ${rx},${railBottom(r)}`} />
                <text className="small" x={rx + 4} y={ry - 6}>
                  {r}
                </text>
              </g>
            );
          })}

          {laid.map((l) => (
            <g key={l.part.id} className={`part ${hot === l.part.id ? 'hot' : ''}`} onMouseEnter={() => setHot(l.part.id)} onMouseLeave={() => setHot(null)}>
              <rect className="box" x={partL} y={l.y} width={PART_W} height={l.h} />
              <text className="title" x={partL + 12} y={l.y + 19}>
                {l.part.label}
              </text>
              <text className="small" x={partL + 12} y={l.y + 34}>
                {l.part.module.toUpperCase()}
              </text>
              {l.drives.map((d, i) => (
                <text key={d} className="drives" x={partL + 12} y={l.y + 52 + i * 14}>
                  {i === 0 ? 'drives ' : '       '}
                  {d}
                </text>
              ))}
              {l.part.wires.map((x, i) => (
                <WireRow key={x.pin} w={w} wire={x} y={l.rows[i]} boardR={boardR} partL={partL} />
              ))}
            </g>
          ))}
          <text className="small" x={PAD} y={bottom + PAD + 10}>
            {DISCLAIMER}
          </text>
        </svg>
      )}

      {(w.builtins.length > 0 || notes.length > 0) && (
        <div className="wiring-notes">
          {w.builtins.length > 0 && (
            <p>
              <span className="dim">On the board, nothing to wire:</span> {w.builtins.map((b) => b.label).join(', ')}.
            </p>
          )}
          {notes.length > 0 && (
            <>
              <h3>Before you power it up</h3>
              <ul className="notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One module pin: its marker on the part, the wire, and where the wire ends. */
function WireRow({ w, wire, y, boardR, partL }: { w: Wiring; wire: WiredPart['wires'][number]; y: number; boardR: number; partL: number }) {
  const pinMark = <rect className="pin" x={partL - 4} y={y - 4} width={8} height={8} />;
  const name = (
    <text x={partL + 12} y={y + 4}>
      {wire.pin}
    </text>
  );
  const note = wire.note && (
    <text className="small" x={partL + PART_W - 12} y={y + 4} textAnchor="end">
      {wire.note.toUpperCase()}
    </text>
  );
  if (wire.rail) {
    const rx = boardR + RAIL_X[wire.rail];
    return (
      <>
        <line className={`w r-${wire.rail}`} x1={rx} y1={y} x2={partL - 4} y2={y} />
        <circle className={`f-${wire.rail}`} cx={rx} cy={y} r={3.5} />
        <text className="small" x={partL - 10} y={y - 5} textAnchor="end">
          {wire.rail}
        </text>
        {pinMark}
        {name}
        {note}
      </>
    );
  }
  if (wire.gpio === undefined && !wire.missing) {
    // Left unconnected.
    return (
      <>
        <line className="nc" x1={partL - 16} y1={y - 4} x2={partL - 8} y2={y + 4} />
        <line className="nc" x1={partL - 16} y1={y + 4} x2={partL - 8} y2={y - 4} />
        {pinMark}
        {name}
        {note}
      </>
    );
  }
  const where = wire.gpio !== undefined ? gpioName(w, wire.gpio) : w.pinout ? 'no free pin' : 'a free GPIO';
  return (
    <>
      <line className={`w ${wire.missing ? 'missing' : 'sig'}`} x1={boardR + 4} y1={y} x2={partL - 4} y2={y} />
      <rect className="pin" x={boardR - 4} y={y - 4} width={8} height={8} />
      <text x={boardR - 12} y={y + 4} textAnchor="end" className={wire.missing ? 'warn' : undefined}>
        {where}
      </text>
      {wire.role && (
        <text className="small" x={PAD + 12} y={y + 4}>
          {wire.role.toUpperCase()}
        </text>
      )}
      <text className={`small ${wire.missing ? 'warn' : ''}`} x={partL - 10} y={y - 5} textAnchor="end">
        {where}
      </text>
      {pinMark}
      {name}
      {note}
    </>
  );
}

/** The board's name without what's in brackets ("ESP32 DevKitC (WROOM-32, no PSRAM)"), to fit the box. */
function shortBoard(name: string): string {
  return name.replace(/ \(.*\)$/, '').replace(/^Waveshare /, '');
}

/** What to check before plugging in: the general rules, then each kind of part's own. */
function studentNotes(w: Wiring): string[] {
  const parts = [...(w.output ? [w.output] : []), ...w.parts];
  if (!parts.length) return [];
  const rails = new Set(parts.flatMap((p) => p.wires.flatMap((x) => (x.rail ? [x.rail] : []))));
  const general = [
    'Wire it with the USB cable unplugged, and check every wire against the diagram before plugging it back in.',
    ...(w.pinout?.notes ?? []),
    ...(rails.size ? ['Run 3V3, 5V and GND from the board to a breadboard\'s rails, and take each part\'s supply from there. Every GND joins.'] : []),
    ...(rails.has('5V') ? ['Only the parts drawn on the orange rail go to 5V; everything else gets 3V3. A GPIO takes 3.3 V at most.'] : []),
  ];
  const seen = new Set<string>();
  const own = parts.flatMap((p) => {
    if (seen.has(p.module)) return [];
    seen.add(p.module);
    return p.notes.map((n) => `${p.module}: ${n}`);
  });
  return [...general, ...own];
}
