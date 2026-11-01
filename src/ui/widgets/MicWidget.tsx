import { useCallback, useEffect, useRef, useState } from 'react';
import { BAND_RANGE, BANDS, LEVEL_RANGE, type Mic } from '../../sim/inputs/mic';
import { useAnimationFrame, useInput } from '../hooks';

const W = 64;
const H = 44;

/** What this computer's mic adds to dBFS to stand for dB SPL: uncalibrated, but a quiet room reads quiet. */
const LIVE_OFFSET = 100;

/** A level in words, for the readout. */
function describe(db: number): string {
  if (db < 40) return 'quiet room';
  if (db < 55) return 'room';
  if (db < 70) return 'talking';
  if (db < 85) return 'loud';
  return 'very loud';
}

interface Live {
  ctx: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  bins: Float32Array<ArrayBuffer>;
}

/** This computer's microphone, per octave band in dB SPL (uncalibrated), from the analyser's latest FFT. */
function liveBands(live: Live): number[] {
  live.analyser.getFloatFrequencyData(live.bins);
  const hz = live.ctx.sampleRate / live.analyser.fftSize;
  return BANDS.map((fc) => {
    let power = 0;
    for (let k = Math.max(1, Math.floor(fc / Math.SQRT2 / hz)); k < Math.min(live.bins.length, Math.ceil((fc * Math.SQRT2) / hz)); k++) {
      if (Number.isFinite(live.bins[k])) power += 10 ** (live.bins[k] / 10);
    }
    return power > 0 ? 10 * Math.log10(power) + LIVE_OFFSET : 0;
  });
}

/**
 * The sound around the mic: a room level, claps, a beat to play, or this computer's own microphone.
 * The bars are the octave bands the driver reports, 63 Hz to 8 kHz.
 */
export function MicWidget({ input }: { input: Mic }) {
  useInput(input);
  const [block, setBlock] = useState(() => input.read());
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const live = useRef<Live | null>(null);

  const stop = useCallback(() => {
    const l = live.current;
    if (!l) return;
    for (const t of l.stream.getTracks()) t.stop();
    void l.ctx.close();
    live.current = null;
    input.setLive(null);
    setListening(false);
  }, [input]);
  useEffect(() => stop, [stop]);
  // Opening the mic waits on the browser's prompt: one at a time, and none once the widget's gone.
  const opening = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = async () => {
    if (opening.current || live.current) return;
    opening.current = true;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!mounted.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const ctx = new AudioContext();
      void ctx.resume(); // Safari starts a context made after an await suspended
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      ctx.createMediaStreamSource(stream).connect(analyser);
      live.current = { ctx, stream, analyser, bins: new Float32Array(analyser.frequencyBinCount) };
      setListening(true);
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError' ? 'The browser was not allowed to use the microphone.' : "Couldn't open this computer's microphone.");
    } finally {
      opening.current = false;
    }
  };

  // The level moves by itself (music, claps, the live mic): follow it.
  const tick = useCallback(() => {
    if (live.current) input.setLive(liveBands(live.current));
    setBlock(input.read());
  }, [input]);
  useAnimationFrame(tick);

  const band = (db: number) => Math.min(1, Math.max(0, (db - BAND_RANGE[0]) / (BAND_RANGE[1] - BAND_RANGE[0])));
  const bw = W / BANDS.length;
  return (
    <div className="widget widget-pot widget-mic">
      <svg width={W} height={H} aria-hidden style={{ flex: 'none', border: '1px solid var(--control)' }}>
        {block.bands.map((db, i) => {
          const h = Math.max(1, band(db) * (H - 4));
          return <rect key={i} x={i * bw + 1.5} y={H - 2 - h} width={bw - 3} height={h} style={{ fill: band(db) > 0.75 ? 'var(--now)' : 'var(--blue)', opacity: 0.75 }} />;
        })}
      </svg>
      <div className="widget-meta">
        <div className="widget-title">{input.label}</div>
        <div className="widget-sub mono">
          {block.db.toFixed(0)} dB SPL · {describe(block.db)}
        </div>
        <input
          type="range"
          min={LEVEL_RANGE[0]}
          max={LEVEL_RANGE[1]}
          value={input.roomLevel}
          disabled={listening}
          onChange={(e) => input.setRoom(Number(e.target.value))}
          aria-label={`${input.label}: the room's level`}
        />
        <div className="widget-sub">
          <button onClick={() => input.clap()}>Clap</button>
          <button className={input.playing ? 'active' : ''} onClick={() => input.setMusic(!input.playing)} disabled={listening}>
            Music
          </button>
          <button className={listening ? 'active' : ''} onClick={() => (listening ? stop() : void start())} title="Uncalibrated: levels are near, not exact">
            {listening ? 'Stop listening' : "This computer's mic"}
          </button>
        </div>
        {error && <div className="widget-sub">{error}</div>}
      </div>
    </div>
  );
}
