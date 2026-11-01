import { useCallback, useRef } from 'react';
import type { Joystick } from '../../sim/inputs/joystick';
import { useAnimationFrame, useInput } from '../hooks';

const SIZE = 76;
const R = SIZE / 2 - 8;

/**
 * Drag the stick; it springs back to the middle when you let go, as the real one does. A gamepad
 * plugged into this computer drives it too: its left stick and its first button.
 */
export function JoystickWidget({ input }: { input: Joystick }) {
  useInput(input);
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const pad = useRef({ driving: false, pressed: false });
  const { x, y } = input.position;

  const setFrom = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    input.set((e.clientX - (r.left + r.width / 2)) / R, -(e.clientY - (r.top + r.height / 2)) / R);
  };
  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    input.set(0, 0);
  };

  // A gamepad's left stick, while it's pushed; let go, and the stick returns to the middle once.
  const poll = useCallback(() => {
    const gp = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads().find((g) => g) : null;
    if (dragging.current) return;
    // A gamepad unplugged mid-push lets go of what it held.
    const [ax = 0, ay = 0] = gp?.axes ?? [];
    const moved = Math.abs(ax) > 0.08 || Math.abs(ay) > 0.08;
    if (moved) input.set(ax, -ay); // a gamepad's y is + downwards
    else if (pad.current.driving) input.set(0, 0);
    pad.current.driving = moved;
    const pressed = !!gp?.buttons[0]?.pressed;
    if (pressed !== pad.current.pressed) input.button.setDown(pressed);
    pad.current.pressed = pressed;
  }, [input]);
  useAnimationFrame(poll);

  const down = input.isPressed();
  return (
    <div className="widget widget-joystick">
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
        onPointerUp={release}
        onPointerCancel={release}
        aria-label={`${input.label}: drag to push the stick`}
      >
        <rect x={2} y={2} width={SIZE - 4} height={SIZE - 4} className="tilt-ring" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="tilt-ring inner" />
        <line x1={SIZE / 2} y1={8} x2={SIZE / 2} y2={SIZE - 8} className="tilt-axis" />
        <line x1={8} y1={SIZE / 2} x2={SIZE - 8} y2={SIZE / 2} className="tilt-axis" />
        <circle cx={SIZE / 2 + x * R} cy={SIZE / 2 - y * R} r={9} className={`tilt-bubble ${down ? 'shaking' : ''}`} />
      </svg>
      <button
        className={`push ${down ? 'down' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          input.button.setDown(true);
        }}
        onPointerUp={() => input.button.setDown(false)}
        onPointerCancel={() => input.button.setDown(false)}
        aria-pressed={down}
        aria-label={`${input.label}: press the stick`}
        title="Press the stick (SW)"
      />
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub mono">
          x {input.axis('x').toFixed(2)} · y {input.axis('y').toFixed(2)}
        </div>
        <div className="widget-sub">
          analogRead ≈ {input.raw('x')}, {input.raw('y')}
        </div>
        <div className="widget-sub">drag · springs back · a gamepad works too</div>
      </div>
    </div>
  );
}
