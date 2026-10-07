import type { Touch } from '../../sim/inputs/touch';
import { useInput } from '../hooks';
import { keyLabel } from './keys';

/** Capacitive touch pad: press and hold to put a finger on it. */
export function TouchWidget({ input }: { input: Touch }) {
  useInput(input);
  const down = input.isPressed();
  return (
    <div className="widget widget-touch">
      <button
        className={`push ${down ? 'down' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          input.setDown(true);
        }}
        onPointerUp={() => input.setDown(false)}
        onPointerCancel={() => input.setDown(false)}
        aria-pressed={down}
        aria-label={input.label}
        title="Press and hold to touch"
      />
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          {input.key && <kbd>{keyLabel(input.key)}</kbd>}
          <span className={`led ${down ? 'on' : ''}`} /> {down ? 'touched' : 'untouched'}
        </div>
        <div className="widget-sub">touchRead ≈ {input.touchRead()}</div>
      </div>
    </div>
  );
}
