import type { Pot } from '../../sim/inputs/pot';
import { useInput } from '../hooks';

export function PotWidget({ input }: { input: Pot }) {
  useInput(input);
  const raw = Math.round(input.value * 4095);
  return (
    <div className="widget widget-pot">
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(input.value * 1000)}
          onChange={(e) => input.set(Number(e.target.value) / 1000)}
          aria-label={input.label}
        />
        <div className="widget-sub">
          analogRead ≈ {raw} · {Math.round((raw / 4095) * 3300)} mV
        </div>
      </div>
    </div>
  );
}
