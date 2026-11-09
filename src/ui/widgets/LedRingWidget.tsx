import { glow, type LedRing } from '../../sim/inputs/ledring';
import { useInput } from '../hooks';

const SIZE = 64;
const C = SIZE / 2;

const css = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** LEDs beside the display, as the app last showed them: LED 0 at the top, clockwise. */
export function LedRingWidget({ input }: { input: LedRing }) {
  useInput(input);
  const colours = input.colours();
  const lit = colours.filter((c) => c !== 0).length;
  return (
    <div className="widget widget-ledring">
      <svg width={SIZE} height={SIZE} className="ledring" aria-label={`${lit} of ${input.count} LEDs lit`}>
        <circle cx={C} cy={C} r={C - 9} className="ledring-ring" />
        {colours.map((c, i) => {
          const a = -Math.PI / 2 + (i / input.count) * Math.PI * 2;
          const { hue, level } = glow(c);
          return (
            <circle key={i} cx={C + Math.cos(a) * (C - 9)} cy={C + Math.sin(a) * (C - 9)} r={5} className={level ? 'ledring-led on' : 'ledring-led'} style={level ? { fill: css(hue), fillOpacity: 0.2 + 0.8 * level } : undefined} />
          );
        })}
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">{lit ? `${lit} lit` : 'dark'}</div>
        <div className="widget-sub">
          {input.count} LEDs, driven by <code>leds</code>
        </div>
      </div>
    </div>
  );
}
