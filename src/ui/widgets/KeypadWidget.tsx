import { KEYPAD_KEYS, type Keypad } from '../../sim/inputs/keypad';
import { useInput } from '../hooks';

/** The 12 pads: press and hold one (or several with more fingers: touch screens, or a pointer each). */
export function KeypadWidget({ input }: { input: Keypad }) {
  useInput(input);
  const r = input.read();
  const label = (id: string | null) => KEYPAD_KEYS.find((k) => k.id === id)?.label ?? '';
  return (
    <div className="widget widget-keypad">
      <div className="remote" role="group" aria-label={`${input.label}: the pads`}>
        {KEYPAD_KEYS.map((k) => {
          const up = () => input.press(k.id, false);
          return (
            <button
              key={k.id}
              className={input.isTouched(k.id) ? 'down' : ''}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                input.press(k.id, true);
              }}
              onPointerUp={up}
              onPointerCancel={up}
              aria-label={`${input.label}: ${k.label}`}
            >
              {k.label}
            </button>
          );
        })}
      </div>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          <span className={`led ${r.keys.length ? 'on' : ''}`} /> {r.keys.length ? `${r.keys.map(label).join(' ')} touched` : 'nothing touched'}
        </div>
        <div className="widget-sub mono">
          {r.last ? `last ${label(r.last)} · ` : ''}status 0x{r.mask.toString(16).toUpperCase().padStart(3, '0')}
        </div>
        <div className="widget-sub">press and hold a pad</div>
      </div>
    </div>
  );
}
