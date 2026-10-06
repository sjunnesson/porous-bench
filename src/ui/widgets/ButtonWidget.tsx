import type { Button } from '../../sim/inputs/button';
import { useInput } from '../hooks';
import { keyLabel } from './keys';

export function ButtonWidget({ input }: { input: Button }) {
  useInput(input);
  const down = input.isPressed();
  return (
    <div className="widget widget-button">
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
      />
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          {input.key && <kbd>{keyLabel(input.key)}</kbd>}
          {input.gpio !== undefined && <span>GPIO{input.gpio}</span>}
          <span className={`led ${down ? 'on' : ''}`} /> {down ? 'LOW (pressed)' : 'HIGH'}
        </div>
      </div>
    </div>
  );
}
