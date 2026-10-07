import type { LightSensor } from '../../sim/inputs/light';
import { useInput } from '../hooks';

const SIZE = 44;
const C = SIZE / 2;

/** What a lux reading feels like, for the readout. */
function describe(lux: number): string {
  if (lux < 10) return 'dark';
  if (lux < 100) return 'dim';
  if (lux < 1000) return 'indoor';
  if (lux < 5000) return 'overcast';
  return 'sunlight';
}

/** Ambient light: a dark → bright slider (log scale) with a little sun that grows its rays. */
export function LightWidget({ input }: { input: LightSensor }) {
  useInput(input);
  const level = input.level;
  const lux = input.lux();
  const raw = Math.round(level * 4095);
  const rays = 8;
  return (
    <div className="widget widget-pot widget-light">
      <svg width={SIZE} height={SIZE} aria-hidden style={{ flex: 'none', border: '1px solid var(--control)' }}>
        {Array.from({ length: rays }, (_, i) => {
          const a = (i / rays) * Math.PI * 2;
          const r0 = 9;
          const r1 = 9 + 2 + level * 9;
          return (
            <line
              key={i}
              x1={C + Math.cos(a) * r0}
              y1={C + Math.sin(a) * r0}
              x2={C + Math.cos(a) * r1}
              y2={C + Math.sin(a) * r1}
              style={{ stroke: 'var(--now)', strokeWidth: 1, opacity: 0.15 + level * 0.85 }}
            />
          );
        })}
        <circle cx={C} cy={C} r={6} style={{ fill: 'var(--now)', fillOpacity: 0.05 + level * 0.9, stroke: level > 0.5 ? 'var(--now)' : 'var(--blue)', strokeWidth: 1 }} />
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(level * 1000)}
          onChange={(e) => input.set(Number(e.target.value) / 1000)}
          aria-label={`${input.label}: brightness`}
        />
        <div className="widget-sub">
          {lux} lx · {describe(lux)} · analogRead ≈ {raw}
        </div>
      </div>
    </div>
  );
}
