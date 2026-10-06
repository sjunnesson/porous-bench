import { useEffect, useRef } from 'react';
import type { LogLine } from '../sim/runner';

export function Console({ lines, onClear }: { lines: LogLine[]; onClear(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div className="panel console-panel">
      <h2>
        Console <button className="link" onClick={onClear}>clear</button>
      </h2>
      <div className="console" ref={ref}>
        {lines.length === 0 && <div className="dim">log(...) output from the sketch appears here.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.level}`}>
            <span className="ts">{(l.t / 1000).toFixed(2)}</span>
            <span className="msg">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
