import { useCallback, useState } from 'react';
import type { Co2 } from '../../sim/inputs/co2';
import { useAnimationFrame, useInput } from '../hooks';

/** What a CO₂ level means for a room, for the readout. */
function describe(ppm: number): string {
  if (ppm < 600) return 'fresh';
  if (ppm < 1000) return 'fine';
  if (ppm < 1400) return 'stuffy';
  return 'open a window';
}

/** The room's CO₂ (and its temperature and humidity, which the sensor reads too); breathe on it to test it. */
export function Co2Widget({ input }: { input: Co2 }) {
  useInput(input);
  const [r, setR] = useState(() => input.read());
  // A measurement every 5 s: follow it.
  const poll = useCallback(() => setR(input.read()), [input]);
  useAnimationFrame(poll);
  return (
    <div className="widget widget-pot widget-co2">
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">{r ? `${r.co2} ppm` : 'starting…'}</div>
        <div className="widget-sub">{r ? `${describe(r.co2)} · ${r.temperature.toFixed(1)} °C · ${Math.round(r.humidity)} %` : 'the first reading comes 5 s after it starts'}</div>
        <input type="range" min={400} max={3000} step={10} value={input.roomPpm} onChange={(e) => input.setRoom(Number(e.target.value))} aria-label={`${input.label}: the room's CO₂`} />
        <div className="widget-sub">
          the room: {Math.round(input.roomPpm)} ppm
          <button onClick={() => input.breathe()}>Breathe on it</button>
        </div>
        <input type="range" min={-10} max={45} step={0.5} value={input.temperature} onChange={(e) => input.setTemperature(Number(e.target.value))} aria-label={`${input.label}: temperature`} />
        <input type="range" min={0} max={100} step={1} value={input.humidity} onChange={(e) => input.setHumidity(Number(e.target.value))} aria-label={`${input.label}: humidity`} />
        <div className="widget-sub">temperature · humidity · a new reading every 5 s</div>
      </div>
    </div>
  );
}
