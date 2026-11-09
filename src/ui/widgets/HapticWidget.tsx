import { useCallback, useEffect, useRef, useState } from 'react';
import type { Haptic } from '../../sim/inputs/haptic';
import { useAnimationFrame, useInput } from '../hooks';
import { keyLabel } from './keys';

const SIZE = 104;
const C = SIZE / 2;
const CAP = 17;
/** Drawn ticks at most: a 1° detent would be a solid ring. */
const MAX_TICKS = 72;

/**
 * The SmartKnob's knob. Drag the ring to turn it, press the centre to press it, scroll to step. The
 * ticks are its detents as the app set them (larger: magnetic ones, darker: the ends); let go, it
 * settles back to the nearest one, and the ring flashes for each click the motor plays.
 */
export function HapticWidget({ input }: { input: Haptic }) {
  useInput(input);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [, redraw] = useState(0);
  const [flash, setFlash] = useState(false);
  const played = useRef(input.played);

  // While it settles on its own, and for a click, draw every frame.
  const tick = useCallback(() => {
    if (input.settling()) redraw((n) => n + 1);
    if (input.played !== played.current) {
      played.current = input.played;
      setFlash(true);
    }
  }, [input]);
  useAnimationFrame(tick);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 120);
    return () => clearTimeout(t);
  }, [flash]);

  const angleAt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      input.turn(e.deltaY > 0 ? -1 : 1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [input]);

  const c = input.config;
  const pos = input.position();
  const angle = input.angle();
  const bounded = c.min <= c.max;
  // The detents within half a turn either side, every n-th when they're fine.
  const span = Math.floor(180 / c.width);
  const from = bounded ? Math.max(c.min, pos - span) : pos - span;
  const to = bounded ? Math.min(c.max, pos + span) : pos + span;
  const every = Math.max(1, Math.ceil((to - from + 1) / MAX_TICKS));
  const ticks: { p: number; a: number }[] = [];
  for (let p = from; p <= to; p++) if ((p - from) % every === 0 || p === c.min || p === c.max || c.magnets.includes(p)) ticks.push({ p, a: input.centreOf(p) });

  const end = (ref: number) => ref === c.min || ref === c.max;
  const ring = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  };

  return (
    <div className="widget widget-knob">
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        className={`knob haptic ${flash ? 'clicked' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (r.left + C), e.clientY - (r.top + C));
          if (d <= CAP) input.press.setDown(true);
          else {
            drag.current = angleAt(e);
            input.grab();
          }
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const a = angleAt(e);
          let da = a - drag.current;
          if (da > 180) da -= 360;
          if (da < -180) da += 360;
          drag.current = a;
          input.turnBy(da);
        }}
        onPointerUp={() => {
          if (drag.current !== null) input.release();
          drag.current = null;
          input.press.setDown(false);
        }}
        onPointerCancel={() => {
          if (drag.current !== null) input.release();
          drag.current = null;
          input.press.setDown(false);
        }}
      >
        {ticks.map(({ p, a }) => {
          const magnet = c.magnets.includes(p);
          const [x1, y1] = ring(a, C - 2);
          const [x2, y2] = ring(a, C - (magnet || (bounded && end(p)) ? 9 : 6));
          return <line key={p} x1={x1} y1={y1} x2={x2} y2={y2} className={`tick ${bounded && end(p) ? 'end' : ''} ${magnet ? 'magnet' : ''}`} />;
        })}
        <g transform={`rotate(${angle} ${C} ${C})`}>
          <circle cx={C} cy={C} r={C - 10} className="knob-body" />
          <line x1={C} y1={14} x2={C} y2={C - CAP - 3} className="knob-mark" />
        </g>
        <circle cx={C} cy={C} r={CAP} className={`knob-cap ${input.isPressed() ? 'down' : ''}`} />
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">{pos}</div>
        <div className="widget-sub">
          <kbd>{keyLabel(input.keys.left)}</kbd>
          <kbd>{keyLabel(input.keys.right)}</kbd> turn · <kbd>{keyLabel(input.keys.press)}</kbd> or <kbd>A</kbd> press
        </div>
        <div className="widget-sub">
          {bounded ? `${c.min} … ${c.max}` : 'no ends'} · {Math.round(c.width * 10) / 10}° each ·{' '}
          {c.magnets.length ? `magnets at ${c.magnets.join(', ')}` : c.detent > 0 ? `detents ${c.detent}` : 'no detents'}
        </div>
        {c.text && <div className="widget-sub">“{c.text.replace(/\n/g, ' ')}”</div>}
      </div>
    </div>
  );
}
