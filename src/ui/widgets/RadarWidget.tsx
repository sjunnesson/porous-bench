import { useCallback, useRef } from 'react';
import { FOV_DEG, type LD2410, MAX_RANGE_M, type RadarMode } from '../../sim/inputs/ld2410';
import { useAnimationFrame, useInput } from '../hooks';

const W = 300;
const H = 200;
const ORIGIN = { x: W / 2, y: H - 12 };
const SCALE = (H - 22) / 6.3; // px per metre
const MODES: { id: RadarMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Drag', hint: 'Click to send the person walking there, or drag to carry them' },
  { id: 'wander', label: 'Wander', hint: 'Walks 4 s, stands 3 s, repeat' },
  { id: 'approach', label: 'Approach', hint: 'Walks in, waits, walks out of range, gone for a while' },
  { id: 'empty', label: 'Empty', hint: 'Nobody in the room' },
];

const toCanvas = (x: number, y: number) => ({ x: ORIGIN.x + x * SCALE, y: ORIGIN.y - y * SCALE });
const toWorld = (px: number, py: number) => ({ x: (px - ORIGIN.x) / SCALE, y: Math.max(0.15, (ORIGIN.y - py) / SCALE) });

/** The same little character as in the 3D view, in 2D: walks when it moves, blinks when it doesn't. */
function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, verdict: string, walking: boolean, facing: number, now: number) {
  const phase = now / 110;
  const bob = walking ? Math.abs(Math.sin(phase)) * 1.5 : Math.sin(now / 600) * 0.4;
  const swing = walking ? Math.sin(phase) * 3 : 0;
  ctx.save();
  ctx.translate(x, y - bob);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#1b4b7a';
  ctx.fillStyle = '#f4f7f9';
  // Ground ring: the radar's verdict.
  ctx.strokeStyle = verdict;
  ctx.beginPath();
  ctx.ellipse(0, bob, 9, 3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#1b4b7a';
  // Legs
  for (const [lx, s] of [[-2.5, 1], [2.5, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(lx, -6);
    ctx.lineTo(lx + swing * s, 0);
    ctx.stroke();
  }
  // Body
  ctx.beginPath();
  ctx.ellipse(0, -9, 4.5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Head
  ctx.beginPath();
  ctx.arc(0, -18, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Antenna with the verdict bulb
  ctx.beginPath();
  ctx.moveTo(0.5, -24.5);
  ctx.lineTo(1.5, -29);
  ctx.stroke();
  ctx.fillStyle = verdict;
  ctx.beginPath();
  ctx.arc(1.5, -30, 1.8, 0, Math.PI * 2);
  ctx.fill();
  // Eyes look the way it's walking; a blink every few seconds.
  ctx.fillStyle = '#11181c';
  const blink = now % 3600 < 120;
  for (const ex of [-2.2, 2.2]) {
    ctx.beginPath();
    ctx.ellipse(ex + facing * 1.6, -18.5, 1.1, blink ? 0.2 : 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function RadarWidget({ input }: { input: LD2410 }) {
  useInput(input);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motion = useRef({ x: 0, y: 0, speed: 0, facing: 1 });
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
    ctx.fillStyle = 'rgba(27,75,122,0.06)';
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x, ORIGIN.y);
    ctx.arc(ORIGIN.x, ORIGIN.y, MAX_RANGE_M * SCALE, start, end);
    ctx.closePath();
    ctx.fill();

    // Range gates (0.75 m each)
    ctx.lineWidth = 1;
    for (let g = 1; g <= 8; g++) {
      ctx.strokeStyle = g % 4 === 0 ? 'rgba(27,75,122,0.4)' : 'rgba(27,75,122,0.14)';
      ctx.beginPath();
      ctx.arc(ORIGIN.x, ORIGIN.y, g * 0.75 * SCALE, start, end);
      ctx.stroke();
    }
    ctx.fillStyle = '#5a666d';
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    for (const m of [1, 2, 3, 4, 5, 6]) ctx.fillText(`${m} m`, ORIGIN.x + 3, ORIGIN.y - m * SCALE + 11);

    // Sensor
    ctx.fillStyle = '#11181c';
    ctx.fillRect(ORIGIN.x - 9, ORIGIN.y, 18, 6);

    // Target
    const t = input.target();
    const p = toCanvas(t.x, t.y);
    const st = input.latest().report.state;
    // Rust is "now": a target moving this instant. Blue: present and still. Muted: nobody.
    const fill = !t.present ? 'rgba(90,102,109,0.35)' : st & 1 ? '#8c3b1e' : st & 2 ? '#1b4b7a' : '#93aec6';
    ctx.strokeStyle = 'rgba(17,24,28,0.25)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x, ORIGIN.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const now = performance.now();
    const m = motion.current;
    const dx = p.x - m.x;
    if (Math.abs(dx) > 0.3) m.facing = Math.sign(dx);
    m.speed += (Math.hypot(dx, p.y - m.y) - m.speed) * 0.2;
    m.x = p.x;
    m.y = p.y;
    const goal = input.walkGoal();
    if (goal) {
      const g = toCanvas(goal.x, goal.y);
      ctx.strokeStyle = '#8c3b1e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(g.x - 4, g.y - 4);
      ctx.lineTo(g.x + 4, g.y + 4);
      ctx.moveTo(g.x + 4, g.y - 4);
      ctx.lineTo(g.x - 4, g.y + 4);
      ctx.stroke();
    }
    if (t.present) drawCharacter(ctx, p.x, p.y, fill, m.speed > 0.15, m.facing, now);
  }, [input]);
  useAnimationFrame(draw);

  const toPerson = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return toWorld(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  };
  // A click sends the person walking there; a drag carries them directly.
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, dragging: false };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) p.dragging = true;
    if (p.dragging) {
      const w = toPerson(e);
      input.movePerson(w.x, w.y);
    }
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    press.current = null;
    if (p && !p.dragging) {
      const w = toPerson(e);
      input.walkTo(w.x, w.y);
    }
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
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (press.current = null)}
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
