import { useEffect, useRef } from 'react';
import type { Knob } from '../../sim/inputs/knob';
import { useInput } from '../hooks';
import { keyLabel } from './keys';

const SIZE = 104;
const C = SIZE / 2;
const CAP = 17;

/** Drag the ring (or scroll) to turn; press the centre cap to push. */
export function KnobWidget({ input }: { input: Knob }) {
  useInput(input);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ angle: number; acc: number } | null>(null);
  const step = 360 / input.detents;
  const pos = input.getPosition();
  const pushed = input.isPressed();

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

  return (
    <div className="widget widget-knob">
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        className="knob"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (r.left + C), e.clientY - (r.top + C));
          if (d <= CAP) input.button.setDown(true);
          else drag.current = { angle: angleAt(e), acc: 0 };
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (!g) return;
          const a = angleAt(e);
          let da = a - g.angle;
          if (da > 180) da -= 360;
          if (da < -180) da += 360;
          g.angle = a;
          g.acc += da;
          const clicks = Math.trunc(g.acc / step);
          if (clicks) {
            g.acc -= clicks * step;
            input.turn(clicks);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
          input.button.setDown(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          input.button.setDown(false);
        }}
      >
        {Array.from({ length: input.detents }, (_, i) => {
          const a = ((i * step - 90) * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={C + Math.cos(a) * (C - 2)}
              y1={C + Math.sin(a) * (C - 2)}
              x2={C + Math.cos(a) * (C - 7)}
              y2={C + Math.sin(a) * (C - 7)}
              className="tick"
            />
          );
        })}
        <g transform={`rotate(${pos * step} ${C} ${C})`}>
          <circle cx={C} cy={C} r={C - 10} className="knob-body" />
          <line x1={C} y1={14} x2={C} y2={C - CAP - 3} className="knob-mark" />
        </g>
        <circle cx={C} cy={C} r={CAP} className={`knob-cap ${pushed ? 'down' : ''}`} />
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">{pos}</div>
        <div className="widget-sub">
          <kbd>{keyLabel(input.keys.left)}</kbd>
          <kbd>{keyLabel(input.keys.right)}</kbd> turn · <kbd>{keyLabel(input.keys.press)}</kbd> push
        </div>
        {(Number.isFinite(input.min) || Number.isFinite(input.max)) && (
          <div className="widget-sub">
            range {Number.isFinite(input.min) ? input.min : '−∞'} … {Number.isFinite(input.max) ? input.max : '∞'}
            {input.wrap ? ' (wraps)' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
