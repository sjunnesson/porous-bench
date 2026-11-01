import { useCallback, useState } from 'react';
import { type IrReceiver, REMOTE_KEYS } from '../../sim/inputs/ir';
import { useAnimationFrame, useInput } from '../hooks';

/** The remote's keys as they lie on it: the arrows around OK, then the digits. */
export const REMOTE_ROWS = [
  ['', 'up', ''],
  ['left', 'ok', 'right'],
  ['', 'down', ''],
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['star', '0', 'hash'],
];

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** The kit's remote: press and hold a key to send it; the receiver decodes it a moment later. */
export function IrWidget({ input }: { input: IrReceiver }) {
  useInput(input);
  const [seen, setSeen] = useState(() => input.read());
  // The driver decodes frames over time: follow it.
  const poll = useCallback(() => {
    const r = input.read();
    setSeen((prev) => (prev.key === r.key && prev.last === r.last ? prev : r));
  }, [input]);
  useAnimationFrame(poll);
  const last = REMOTE_KEYS.find((k) => k.id === seen.last);
  const sending = input.sending;
  return (
    <div className="widget widget-ir">
      <div className="remote" role="group" aria-label={`${input.label}: the remote`}>
        {REMOTE_ROWS.flat().map((id, i) => {
          const key = REMOTE_KEYS.find((k) => k.id === id);
          if (!key) return <span key={`gap-${i}`} />; // not a number: the digits are keys too
          const up = () => input.press(id, false);
          return (
            <button
              key={id}
              className={sending === id ? 'down' : ''}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                input.press(id, true);
              }}
              onPointerUp={up}
              onPointerCancel={up}
              aria-label={`${input.label}: ${id}`}
            >
              {key.label}
            </button>
          );
        })}
      </div>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          <span className={`led ${seen.key ? 'on' : ''}`} /> {seen.key ? `${REMOTE_KEYS.find((k) => k.id === seen.key)?.label} held` : 'nothing held'}
        </div>
        <div className="widget-sub mono">{last ? `last ${last.label} · NEC ${hex(0)} ${hex(last.code)}` : 'no key yet'}</div>
        <div className="widget-sub">press and hold a key on the remote</div>
      </div>
    </div>
  );
}
