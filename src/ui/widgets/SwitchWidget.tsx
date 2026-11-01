import type { Switch } from '../../sim/inputs/switch';
import { useInput } from '../hooks';

/** A switch that stays where it's put: click to flip it. */
export function SwitchWidget({ input }: { input: Switch }) {
  useInput(input);
  const on = input.isOn();
  return (
    <div className="widget widget-switch">
      <button className={`push toggle ${on ? 'down' : ''}`} onClick={() => input.flip()} aria-pressed={on} aria-label={`${input.label}: flip`} title="Click to flip" />
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          <span className={`led ${on ? 'on' : ''}`} /> {on ? 'ON · LOW' : 'off · HIGH'}
        </div>
        <div className="widget-sub">click to flip · a reed switch: is the magnet near?</div>
      </div>
    </div>
  );
}
