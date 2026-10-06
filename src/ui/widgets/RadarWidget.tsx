import { useCallback, useRef } from 'react';
import { FOV_DEG, type LD2410, MAX_RANGE_M, type RadarMode } from '../../sim/inputs/ld2410';
import { useAnimationFrame, useInput } from '../hooks';

const W = 300;
const H = 200;
const ORIGIN = { x: W / 2, y: H - 12 };
const SCALE = (H - 22) / 6.3; // px per metre
const MODES: { id: RadarMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Drag', hint: 'Drag the person around; speed decides moving vs. still' },
  { id: 'wander', label: 'Wander', hint: 'Walks 4 s, stands 3 s, repeat' },
  { id: 'approach', label: 'Approach', hint: 'Walks in, waits, walks out of range, gone for a while' },
  { id: 'empty', label: 'Empty', hint: 'Nobody in the room' },
];

const toCanvas = (x: number, y: number) => ({ x: ORIGIN.x + x * SCALE, y: ORIGIN.y - y * SCALE });
const toWorld = (px: number, py: number) => ({ x: (px - ORIGIN.x) / SCALE, y: Math.max(0.15, (ORIGIN.y - py) / SCALE) });

export function RadarWidget({ input }: { input: LD2410 }) {
  useInput(input);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const { report, bytes, overflowed } = input.latest();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const half = ((FOV_DEG / 2) * Math.PI) / 180;
    const start = -Math.PI / 2 - half;
    const end = -Math.PI / 2 + half;

    // Field of view
    ctx.fillStyle = 'rgba(80,140,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x, ORIGIN.y);
    ctx.arc(ORIGIN.x, ORIGIN.y, MAX_RANGE_M * SCALE, start, end);
    ctx.closePath();
    ctx.fill();

    // Range gates (0.75 m each)
    ctx.lineWidth = 1;
    for (let g = 1; g <= 8; g++) {
      ctx.strokeStyle = g % 4 === 0 ? 'rgba(160,180,220,0.45)' : 'rgba(160,180,220,0.16)';
      ctx.beginPath();
      ctx.arc(ORIGIN.x, ORIGIN.y, g * 0.75 * SCALE, start, end);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,210,230,0.55)';
    ctx.font = '10px system-ui, sans-serif';
    for (const m of [1, 2, 3, 4, 5, 6]) ctx.fillText(`${m} m`, ORIGIN.x + 3, ORIGIN.y - m * SCALE + 11);

    // Sensor
    ctx.fillStyle = '#9aa4b8';
    ctx.fillRect(ORIGIN.x - 9, ORIGIN.y, 18, 6);

    // Target
    const t = input.target();
    const p = toCanvas(t.x, t.y);
    const st = input.latest().report.state;
    const fill = !t.present ? 'rgba(150,150,160,0.35)' : st & 1 ? '#ff9f43' : st & 2 ? '#3ddc84' : '#c9ccd6';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x, ORIGIN.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y - 13, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }, [input]);
  useAnimationFrame(draw);

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = toWorld(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    input.movePerson(w.x, w.y);
  };

  const stateText = report.state === 0 ? 'none' : ['', 'moving', 'stationary', 'moving + stationary'][report.state];

  return (
    <div className="widget widget-radar">
      <div className="widget-title">{input.label}</div>
      <div className="segmented">
        {MODES.map((m) => (
          <button key={m.id} className={input.mode === m.id ? 'active' : ''} title={m.hint} onClick={() => input.setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="radar-canvas"
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          onPointer(e);
        }}
        onPointerMove={(e) => dragging.current && onPointer(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      />
      <table className="readout">
        <tbody>
          <tr>
            <th>target state</th>
            <td>
              <span className={`led ${report.state ? 'on' : ''}`} /> {stateText} <span className="dim">(OUT pin {report.state ? 'HIGH' : 'LOW'})</span>
            </td>
          </tr>
          <tr>
            <th>moving</th>
            <td>
              {report.movingDistance} cm · energy {report.movingEnergy}
            </td>
          </tr>
          <tr>
            <th>stationary</th>
            <td>
              {report.stationaryDistance} cm · energy {report.stationaryEnergy}
            </td>
          </tr>
          <tr>
            <th>UART frame</th>
            <td className="hex">{bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ') : 'waiting for sketch to read…'}</td>
          </tr>
          {overflowed > 0 && (
            <tr>
              <th>overflow</th>
              <td className="warn">{overflowed} bytes dropped: the sketch isn't reading fast enough</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
