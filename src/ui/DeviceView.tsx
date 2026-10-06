import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimClock } from '../sim/clock';
import { fitZoom, PanelRenderer, type ViewOptions } from '../sim/renderer';
import type { SketchRun } from '../sim/runner';
import { useAnimationFrame } from './hooks';

// three.js is big: load the 3D view on demand.
const Device3D = lazy(() => import('./Device3D').then((m) => ({ default: m.Device3D })));

export interface ViewState {
  /** '3d' = the device as a ghosted wireframe; 'flat' = just the glass, pixel-exact with zoom and grid. */
  mode?: '3d' | 'flat';
  zoom: number | 'fit';
  grid: boolean;
  /** How the module is mounted. 'auto' turns it so whatever setRotation() the sketch chose reads upright. */
  rotation: number | 'auto';
}

interface Props {
  run: SketchRun;
  clock: SimClock;
  view: ViewState;
  error: string | null;
  /** A .lua file was dropped on the device. */
  onDropApp?(name: string, code: string): void;
}

interface Stats {
  fps: number;
  busPct: number;
  frameKB: number;
}

export function DeviceView({ run, clock, view, error, onDropApp }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 600, h: 600 });
  const [stats, setStats] = useState<Stats>({ fps: 0, busPct: 0, frameKB: 0 });
  const [simTime, setSimTime] = useState(0);
  const device = run.device;
  const renderer = useMemo(() => new PanelRenderer(device), [device]);
  const threeD = (view.mode ?? '3d') === '3d';
  const [canvas3d, setCanvas3d] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mount = () => (view.rotation === 'auto' ? (4 - run.display.getRotation()) % 4 : view.rotation);
  const options: ViewOptions = {
    zoom: view.zoom === 'fit' ? fitZoom(device, mount(), avail.w - 16, avail.h - 16) : view.zoom,
    grid: view.grid,
    rotation: mount(),
  };
  const optionsRef = useRef({ options, mount });
  optionsRef.current = { options, mount };

  const draw = useCallback(() => {
    const { options: o, mount: m } = optionsRef.current;
    if (canvasRef.current && canvasRef.current.isConnected) renderer.draw(canvasRef.current, run.display.panel, clock.now(), { ...o, rotation: m() });
  }, [renderer, run, clock]);
  useAnimationFrame(draw);

  // Frame rate and bus load, measured in simulated time.
  useEffect(() => {
    setStats({ fps: 0, busPct: 0, frameKB: 0 });
    setSimTime(0);
    let prev = { t: clock.now(), ...run.display.stats };
    const id = setInterval(() => {
      const t = clock.now();
      const s = run.display.stats;
      const dt = t - prev.t;
      if (dt > 0) {
        const shows = s.shows - prev.shows;
        setStats({
          fps: (shows * 1000) / dt,
          busPct: (100 * (s.busMs - prev.busMs)) / dt,
          frameKB: shows ? (s.bytes - prev.bytes) / shows / 1024 : 0,
        });
      }
      setSimTime(run.millis());
      prev = { t, ...s };
    }, 500);
    return () => clearInterval(id);
  }, [run, clock]);

  const screenshot = () => {
    (threeD ? canvas3d : canvasRef.current)?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${device.id}-${run.sketch.name.replace(/\W+/g, '-').toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };

  const busLabel = device.bus.kind === 'spi' ? `SPI ${device.bus.hz / 1e6} MHz` : `I2C ${device.bus.hz / 1e3} kHz`;

  return (
    <section className="stage-wrap">
      <div
        className={`stage ${threeD ? 'stage-3d' : ''} ${dragOver ? 'drop-target' : ''}`}
        ref={stageRef}
        onDragOver={(e) => {
          if (!onDropApp) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void file.text().then((code) => onDropApp?.(file.name, code));
          else {
            const text = e.dataTransfer.getData('text/plain');
            if (text) onDropApp?.('Dropped app', text);
          }
        }}
      >
        {threeD ? (
          <Suspense fallback={null}>
            <Device3D run={run} clock={clock} mount={() => optionsRef.current.mount()} onCanvas={setCanvas3d} />
          </Suspense>
        ) : (
          <canvas ref={canvasRef} className="device-canvas" />
        )}
        {error && (
          <div className="error-overlay">
            <strong>Sketch crashed</strong>
            <pre>{error}</pre>
            <span>Fix the code and save; it restarts automatically.</span>
          </div>
        )}
      </div>
      <div className="statusbar">
        <span title="Frames pushed per second (simulated time)">{stats.fps.toFixed(0)} fps</span>
        <span title="Share of time the display bus is busy">bus {Math.min(100, stats.busPct).toFixed(0)}%</span>
        <span title="Average bytes per show()">{stats.frameKB.toFixed(1)} KB/frame</span>
        <span>{busLabel}</span>
        <span>
          {device.width}×{device.height}
          {threeD ? '' : ` @ ${options.zoom}×`}
        </span>
        <span title="millis()">t = {(simTime / 1000).toFixed(1)} s</span>
        <button className="link" onClick={screenshot} title="Save a PNG of the display">
          Screenshot
        </button>
      </div>
    </section>
  );
}
