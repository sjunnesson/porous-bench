import { type Climate, TEMP_RANGE } from '../../sim/inputs/climate';
import { useInput } from '../hooks';

/** Temperature and humidity: one slider each, with the values the sketch will read. */
export function ClimateWidget({ input }: { input: Climate }) {
  useInput(input);
  const t = input.temperature;
  const h = input.humidity;
  return (
    <div className="widget widget-pot widget-climate">
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">
          {t.toFixed(1)} °C · {Math.round(h)} %
        </div>
        <div className="widget-sub">temperature</div>
        <input
          type="range"
          min={TEMP_RANGE[0]}
          max={TEMP_RANGE[1]}
          step={0.5}
          value={t}
          onChange={(e) => input.setTemperature(Number(e.target.value))}
          aria-label={`${input.label}: temperature`}
        />
        <div className="widget-sub">
          {TEMP_RANGE[0]} … {TEMP_RANGE[1]} °C
        </div>
        <div className="widget-sub">relative humidity</div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={h}
          onChange={(e) => input.setHumidity(Number(e.target.value))}
          aria-label={`${input.label}: humidity`}
        />
        <div className="widget-sub">0 … 100 %</div>
      </div>
    </div>
  );
}
