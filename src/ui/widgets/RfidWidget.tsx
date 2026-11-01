import { useCallback, useState } from 'react';
import { type RfidReader, TAGS } from '../../sim/inputs/rfid';
import { useAnimationFrame, useInput } from '../hooks';

/** The tags beside the reader: click one to lay it on the antenna, again to take it off. */
export function RfidWidget({ input }: { input: RfidReader }) {
  useInput(input);
  const [found, setFound] = useState(() => input.read());
  // The driver notices a tag at its next poll: follow it.
  const poll = useCallback(() => {
    const r = input.read();
    setFound((prev) => (prev.uid === r.uid ? prev : r));
  }, [input]);
  useAnimationFrame(poll);
  const lying = input.lying;
  return (
    <div className="widget widget-rfid">
      <div className="tags" role="group" aria-label={`${input.label}: the tags`}>
        {TAGS.map((t) => (
          <button key={t.id} className={lying === t.id ? 'down' : ''} onClick={() => input.place(lying === t.id ? null : t.id)} aria-pressed={lying === t.id} title={`UID ${input.uid(t.id)}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          <span className={`led ${found.present ? 'on' : ''}`} /> {found.present ? `${TAGS.find((t) => input.uid(t.id) === found.uid)?.label ?? 'a tag'} found` : 'no tag'}
        </div>
        <div className="widget-sub mono">{found.uid ? `UID ${found.uid}` : ' '}</div>
        <div className="widget-sub">click a tag to lay it on the reader</div>
      </div>
    </div>
  );
}
