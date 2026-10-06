import { useRef } from 'react';
import type { Imu } from '../../sim/inputs/imu';
import { useInput } from '../hooks';

const SIZE = 104;
const R = SIZE / 2 - 8;

/** Drag the bubble to tilt the device (x/y gravity in g); double-click to level. */
export function ImuWidget({ input }: { input: Imu }) {
  useInput(input);
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const { x, y } = input.getTilt();
  const [ax, ay, az] = input.accel();

  const setFrom = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    input.setTilt((e.clientX - (r.left + r.width / 2)) / R, (e.clientY - (r.top + r.height / 2)) / R);
  };

  return (
    <div className="widget widget-imu">
      <svg
        ref={ref}
        width={SIZE}
        height={SIZE}
        className="tilt-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          setFrom(e);
        }}
        onPointerMove={(e) => dragging.current && setFrom(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onDoubleClick={() => input.setTilt(0, 0)}
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="tilt-ring" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R / 2} className="tilt-ring inner" />
        <line x1={SIZE / 2} y1={8} x2={SIZE / 2} y2={SIZE - 8} className="tilt-axis" />
        <line x1={8} y1={SIZE / 2} x2={SIZE - 8} y2={SIZE / 2} className="tilt-axis" />
        <circle cx={SIZE / 2 + x * R} cy={SIZE / 2 + y * R} r={8} className={`tilt-bubble ${input.isShaking() ? 'shaking' : ''}`} />
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub mono">
          accel {ax.toFixed(2)} {ay.toFixed(2)} {az.toFixed(2)} g
        </div>
        <div className="widget-sub">Drag to tilt · double-click to level</div>
        <button onClick={() => input.shake()} className={input.isShaking() ? 'active' : ''}>
          Shake
        </button>
      </div>
    </div>
  );
}
