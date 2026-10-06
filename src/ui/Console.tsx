import { useEffect, useRef } from 'react';
import type { LogLine } from '../sim/runner';
import { Panel } from './Panel';

export function Console({ lines, onClear }: { lines: LogLine[]; onClear(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <Panel
      id="console"
      title="Console"
      className="console-panel"
      extra={
        <button className="link" onClick={onClear}>
          clear
        </button>
      }
    >
      <div className="console" ref={ref}>
        {lines.length === 0 && <div className="dim">log.info(...) output from the app appears here.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.level}`}>
            <span className="ts">{(l.t / 1000).toFixed(2)}</span>
            <span className="msg">{l.text}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
