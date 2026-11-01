import { useCallback, useState } from 'react';
import type { Tof } from '../../sim/inputs/tof';
import { useAnimationFrame, useInput } from '../hooks';

/** How far away what's in front of the sensor is, or nothing at all. */
export function TofWidget({ input }: { input: Tof }) {
  useInput(input);
  const [mm, setMm] = useState(() => input.mm());
  // A new reading every 50 ms: follow it.
  const poll = useCallback(() => setMm(input.mm()), [input]);
  useAnimationFrame(poll);
  const target = input.targetMm;
  return (
    <div className="widget widget-pot widget-tof">
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">{mm === null ? 'out of range' : `${mm} mm`}</div>
        <input
          type="range"
          min={0}
          max={1500}
          step={5}
          value={target ?? 1500}
          disabled={target === null}
          onChange={(e) => input.setTarget(Number(e.target.value))}
          aria-label={`${input.label}: how far away the hand is`}
        />
        <div className="widget-sub">
          <label>
            <input type="checkbox" checked={target === null} onChange={(e) => input.setTarget(e.target.checked ? null : 250)} />
            nothing in front of it
          </label>
        </div>
        <div className="widget-sub">a hand {target === null ? 'away' : `at ${Math.round(target)} mm`} · reads 4 cm to 4 m, 20 times a second</div>
      </div>
    </div>
  );
}
