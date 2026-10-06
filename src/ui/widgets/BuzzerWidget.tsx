import { useCallback, useEffect, useRef } from 'react';
import type { Buzzer } from '../../sim/inputs/buzzer';
import { useAnimationFrame, useInput, usePersisted } from '../hooks';

let audio: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  return audio;
}
// Browsers only start audio after a user gesture.
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => audioContext(), { once: true });

/** Shows the piezo's state and plays it through Web Audio (square wave, like a piezo). */
export function BuzzerWidget({ input }: { input: Buzzer }) {
  useInput(input);
  const [muted, setMuted] = usePersisted('buzzer-muted', false);
  const osc = useRef<{ o: OscillatorNode; g: GainNode } | null>(null);

  const stop = useCallback(() => {
    if (!osc.current) return;
    const { o, g } = osc.current;
    g.gain.setTargetAtTime(0, o.context.currentTime, 0.005);
    o.stop(o.context.currentTime + 0.05);
    osc.current = null;
  }, []);

  const tick = useCallback(() => {
    const on = !muted && input.isSounding();
    if (!on) return stop();
    const ctx = audioContext();
    if (!ctx || ctx.state !== 'running') return;
    if (!osc.current) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      g.gain.value = 0.035;
      o.connect(g).connect(ctx.destination);
      o.start();
      osc.current = { o, g };
    }
    osc.current.o.frequency.setTargetAtTime(input.freq, ctx.currentTime, 0.002);
  }, [input, muted, stop]);
  useAnimationFrame(tick);
  useEffect(() => stop, [stop]);

  const sounding = input.isSounding();
  return (
    <div className="widget widget-buzzer">
      <div className={`speaker ${sounding ? 'on' : ''}`} aria-hidden>
        <span />
      </div>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub mono">{sounding ? `${input.freq} Hz` : 'silent'}</div>
        <label className="widget-sub">
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> mute
        </label>
      </div>
    </div>
  );
}
