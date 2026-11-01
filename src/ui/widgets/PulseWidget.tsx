import { useCallback, useRef, useState } from 'react';
import { BPM_RANGE, type Pulse } from '../../sim/inputs/pulse';
import { useAnimationFrame, useInput } from '../hooks';

const W = 120;
const H = 36;
/** Three seconds of samples. */
const KEEP = 300;

/** A fingertip on the sensor (or not) and the heart rate behind it, with the IR trace it reads. */
export function PulseWidget({ input }: { input: Pulse }) {
  useInput(input);
  const trace = useRef<{ ir: number[]; cursor: number }>({ ir: [], cursor: -1 });
  const [, redraw] = useState(0);
  const [r, setR] = useState(() => input.read());
  // The samples it takes since the last frame, kept for the trace; the driver's view for the readout.
  const poll = useCallback(() => {
    const t = trace.current;
    const { ir, last } = input.samplesSince(t.cursor);
    t.cursor = last;
    if (ir.length) {
      t.ir = [...t.ir, ...ir].slice(-KEEP);
      redraw((n) => n + 1);
    }
    setR(input.read());
  }, [input]);
  useAnimationFrame(poll);

  const ir = trace.current.ir;
  // Scale to what's on screen, so the 1% beat shows, but no finer than 1000 counts: noise stays flat.
  const mid = (Math.min(...ir) + Math.max(...ir)) / 2;
  const span = Math.max(1000, Math.max(...ir) - Math.min(...ir));
  const points = ir.map((v, i) => `${((i + KEEP - ir.length) / KEEP) * W},${H / 2 + ((v - mid) / span) * (H - 4)}`).join(' ');
  return (
    <div className="widget widget-pot widget-pulse">
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-value">{r.bpm !== null ? `${r.bpm} bpm` : r.finger ? 'finding the pulse…' : 'no finger'}</div>
        <svg width={W} height={H} aria-hidden style={{ display: 'block', border: '1px solid var(--rule)', margin: '6px 0' }}>
          {ir.length > 1 && <polyline points={points} style={{ fill: 'none', stroke: r.finger ? 'var(--now)' : 'var(--muted)', strokeWidth: 1 }} />}
        </svg>
        <div className="widget-sub">
          <button className={input.finger ? 'active' : ''} onClick={() => input.setFinger(!input.finger)} aria-pressed={input.finger}>
            {input.finger ? 'Lift the finger' : 'Rest a finger on it'}
          </button>
          <span className="mono">IR {r.ir}</span>
        </div>
        <input type="range" min={BPM_RANGE[0]} max={BPM_RANGE[1]} value={input.heartRate} onChange={(e) => input.setBpm(Number(e.target.value))} aria-label={`${input.label}: heart rate`} />
        <div className="widget-sub">heart {input.heartRate} bpm · a rate after a few steady beats</div>
      </div>
    </div>
  );
}
