import { useCallback, useState } from 'react';
import type { Pir } from '../../sim/inputs/pir';
import { useAnimationFrame, useInput } from '../hooks';

/** Press and hold to move in front of the PIR; its output stays high for holdMs after you stop. */
export function PirWidget({ input }: { input: Pir }) {
  useInput(input);
  const [held, setHeld] = useState(false);
  // motion() decays with the clock, not with an input event: poll it.
  const [motion, setMotion] = useState(() => input.motion());
  const poll = useCallback(() => setMotion(input.motion()), [input]);
  useAnimationFrame(poll);

  const release = () => {
    if (!held) return;
    setHeld(false);
    input.setMoving(false);
  };
  return (
    <div className="widget widget-pir">
      <button
        className={`push ${held ? 'down' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setHeld(true);
          input.setMoving(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        aria-pressed={held}
        aria-label={`${input.label}: wave`}
        title="Press and hold to wave at it"
      />
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub">
          <span className={`led ${motion ? 'on' : ''}`} />
          {motion ? <span style={{ color: 'var(--now)', letterSpacing: '0.12em' }}>MOTION</span> : <span>still</span>}
          <span>· OUT {motion ? 'HIGH' : 'LOW'}</span>
        </div>
        <div className="widget-sub">hold to wave · stays high {(input.holdMs / 1000).toFixed(1)} s after</div>
      </div>
    </div>
  );
}
