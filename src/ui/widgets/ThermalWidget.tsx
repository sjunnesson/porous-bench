import { useCallback, useRef, useState } from 'react';
import { SIZE, type Thermal } from '../../sim/inputs/thermal';
import { useAnimationFrame, useInput } from '../hooks';

const CELL = 11;
const W = SIZE * CELL;

/** A temperature as a colour, from a little under the room (pale) to skin (rust). */
export function heat(t: number, room: number): string {
  const f = Math.min(1, Math.max(0, (t - room + 1) / 12));
  const cool = [0xdf, 0xe6, 0xea];
  const hot = [0x8c, 0x3b, 0x1e];
  return `rgb(${cool.map((c, i) => Math.round(c + (hot[i] - c) * f)).join(',')})`;
}

/** The 64 pixels as it reads them: drag over them to move the warm figure, and set how near it is. */
export function ThermalWidget({ input }: { input: Thermal }) {
  useInput(input);
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [px, setPx] = useState(() => input.pixels());
  // Ten frames a second: follow them.
  const poll = useCallback(() => setPx(input.pixels()), [input]);
  useAnimationFrame(poll);
  const f = input.target;
  const h = input.hotspot();
  const moveTo = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    input.setFigure({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r: f?.r ?? 1.2 });
  };
  return (
    <div className="widget widget-pot widget-thermal">
      <svg
        ref={ref}
        width={W}
        height={W}
        style={{ flex: 'none', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          moveTo(e);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        aria-label={`${input.label}: drag to move the warm figure`}
      >
        {px.map((t, i) => (
          <rect key={i} x={(i % SIZE) * CELL} y={Math.floor(i / SIZE) * CELL} width={CELL - 1} height={CELL - 1} style={{ fill: heat(t, input.room) }} />
        ))}
        {h.warm && <circle cx={(h.x + 0.5) * CELL} cy={(h.y + 0.5) * CELL} r={3} style={{ fill: 'none', stroke: 'var(--ink)', strokeWidth: 1 }} />}
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub mono">
          max {h.max.toFixed(2)} °C · {h.warm ? `warm at ${h.x.toFixed(1)}, ${h.y.toFixed(1)}` : 'no one warm'}
        </div>
        <div className="widget-sub">
          <label>
            <input type="checkbox" checked={!!f} onChange={(e) => input.setFigure(e.target.checked ? { x: 0.5, y: 0.5, r: 1.2 } : null)} />
            someone in view
          </label>
        </div>
        <input type="range" min={0.2} max={4} step={0.1} value={f?.r ?? 1.2} disabled={!f} onChange={(e) => f && input.setFigure({ ...f, r: Number(e.target.value) })} aria-label={`${input.label}: how near the figure is`} />
        <div className="widget-sub">far · near</div>
        <input type="range" min={10} max={35} step={0.5} value={input.room} onChange={(e) => input.setBackground(Number(e.target.value))} aria-label={`${input.label}: the room's temperature`} />
        <div className="widget-sub">the room: {input.room.toFixed(1)} °C</div>
      </div>
    </div>
  );
}
