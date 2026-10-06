import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { session } from './resident/session';
import { residentSketch } from './resident/sketch';
import { residentApps } from './resident-apps';
import { SimClock } from './sim/clock';
import { devices, findDevice } from './sim/devices';
import type { Button } from './sim/inputs/button';
import type { Knob } from './sim/inputs/knob';
import { type LogLine, SketchRun } from './sim/runner';
import type { InputSpecs, Sketch } from './sim/sketch';
import { Console } from './ui/Console';
import { DeviceInfo } from './ui/DeviceInfo';
import { DeviceView, type ViewState } from './ui/DeviceView';
import { useClockState, usePersisted } from './ui/hooks';
import { InputPanel } from './ui/InputPanel';
import { Panel } from './ui/Panel';
import { ResidentPanel } from './ui/ResidentPanel';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const TECH_LABEL = { lcd: 'LCD', oled: 'OLED', epaper: 'E-paper' } as const;

const GROUPS = ['Your app', 'Bench examples', 'Resident examples'] as const;

/** One Lua app in the Sketch menu. */
interface Entry {
  id: string;
  name: string;
  group: (typeof GROUPS)[number];
  sketch: Sketch<InputSpecs>;
  code: string;
}

/** Which hardware the user picked for a sketch's control, kept across reloads. */
function loadBinding(sketchId: string, control: string): string | null {
  try {
    return localStorage.getItem(`bench:binding:${sketchId}:${control}`);
  } catch {
    return null;
  }
}
function saveBinding(sketchId: string, control: string, source: string) {
  try {
    localStorage.setItem(`bench:binding:${sketchId}:${control}`, source);
  } catch {
    /* not persisted */
  }
}

const bundled: Entry[] = residentApps.map((a) => ({
  id: `resident:${a.id}`,
  name: a.name,
  group: a.origin === 'resident' ? 'Resident examples' : 'Bench examples',
  sketch: residentSketch({ name: a.name, code: a.code, description: a.description || undefined }),
  code: a.code,
}));

export default function App() {
  const clock = useMemo(() => new SimClock(), []);
  const { paused, speed } = useClockState(clock);
  const [sketchId, setSketchId] = usePersisted('sketch', 'resident:hello-display');
  const [deviceId, setDeviceId] = usePersisted('device', 'waveshare-esp32-c6-lcd-1.47');
  const [view, setView] = usePersisted<ViewState>('view', { zoom: 'fit', grid: true, rotation: 'auto' });
  const [restarts, setRestarts] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Resident: an app pushed over the relay, dropped on the device or run from the editor.
  useSyncExternalStore(session.subscribe, session.getVersion);
  const live = session.live;
  const liveEntry = useMemo<Entry | null>(
    () => (live ? { id: 'resident:live', name: `▶ ${live.name}`, group: 'Your app', sketch: residentSketch({ ...live, live }), code: live.code } : null),
    [live],
  );
  const lastLive = useRef(live);
  useEffect(() => {
    if (live && live !== lastLive.current) setSketchId('resident:live');
    lastLive.current = live;
  }, [live, setSketchId]);

  const entries: Entry[] = [...(liveEntry ? [liveEntry] : []), ...bundled];
  const entry = entries.find((s) => s.id === sketchId) ?? entries[0];
  const device = findDevice(deviceId) ?? devices[0];

  const [run, setRun] = useState<SketchRun | null>(null);
  useEffect(() => {
    const r = new SketchRun(entry.sketch, device, clock, {
      onLog: (line) => setLogs((l) => [...l.slice(-299), line]),
      onError: (err) => setError(err instanceof Error ? (err.stack ?? err.message) : String(err)),
      // Controls appear as the app declares them; each picks up the hardware chosen last time.
      bindingFor: (control) => loadBinding(entry.id, control),
    });
    setRun(r);
    setLogs([]);
    setError(null);
    session.log = (level, text) => r.stopped || setLogs((l) => [...l.slice(-299), { t: r.millis(), text, level: level === 'info' ? 'log' : level }]);
    void r.start();
    return () => r.stop();
  }, [entry.sketch, device, clock, restarts]);

  // Keyboard → buttons and knobs declared by the sketch.
  useEffect(() => {
    if (!run) return;
    const handler = (down: boolean) => (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, select, textarea')) return;
      let handled = false;
      for (const control of run.controls) if (control.handleKey(e.code, down)) handled = true;
      for (const input of run.declared) {
        if (input.kind === 'button') {
          const b = input as Button;
          if (b.key === e.code) {
            b.setDown(down);
            handled = true;
          }
        } else if (input.kind === 'knob') {
          const k = input as Knob;
          if (e.code === k.keys.left || e.code === k.keys.right) {
            if (down) k.turn(e.code === k.keys.left ? -1 : 1);
            handled = true;
          } else if (e.code === k.keys.press) {
            k.button.setDown(down);
            handled = true;
          }
        }
      }
      if (handled) e.preventDefault();
    };
    const onDown = handler(true);
    const onUp = handler(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [run]);

  const byTech = (['lcd', 'oled', 'epaper'] as const).map((tech) => ({ tech, list: devices.filter((d) => d.tech === tech) }));

  return (
    <div className="app">
      <header className="toolbar">
        <a className="brand" href="https://porous.systems" title="porous.systems">
          <span>porous.systems</span> Bench
        </a>

        <div className="group">
          <button onClick={() => setRestarts((n) => n + 1)} title="Reboot: run setup() again">
            ↻ Restart
          </button>
          <button onClick={() => (clock.paused = !paused)} className={paused ? 'active' : ''}>
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button onClick={() => clock.advance(1000 / 60)} disabled={!paused} title="Advance one 60 Hz frame">
            Step
          </button>
          <select value={speed} onChange={(e) => ((clock.speed = Number(e.target.value)), e.target.blur())} title="Simulation speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>

        <div className="group">
          <div className="segmented small-seg">
            <button className={(view.mode ?? '3d') === '3d' ? 'active' : ''} onClick={() => setView({ ...view, mode: '3d' })} title="The device as a 3D wireframe">
              3D
            </button>
            <button className={view.mode === 'flat' ? 'active' : ''} onClick={() => setView({ ...view, mode: 'flat' })} title="Just the glass, pixel-exact">
              Flat
            </button>
          </div>
          <select
            disabled={(view.mode ?? '3d') === '3d'}
            value={String(view.zoom)}
            onChange={(e) => (setView({ ...view, zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) }), e.target.blur())}
            title="Zoom"
          >
            <option value="fit">Fit</option>
            {[1, 2, 3, 4, 5, 6, 8].map((z) => (
              <option key={z} value={z}>
                {z}×
              </option>
            ))}
          </select>
          <button disabled={(view.mode ?? '3d') === '3d'} className={view.grid ? 'active' : ''} onClick={() => setView({ ...view, grid: !view.grid })} title="Show pixel grid">
            Grid
          </button>
          <button
            onClick={() => setView({ ...view, rotation: view.rotation === 'auto' ? 0 : view.rotation === 3 ? 'auto' : view.rotation + 1 })}
            title="How the module is mounted. Auto follows the sketch's setRotation()."
          >
            ⟳ {view.rotation === 'auto' ? 'Auto' : `${view.rotation * 90}°`}
          </button>
        </div>
      </header>

      <main className="main">
        {/* Left: the code — which app, its source, the relay, its logs. */}
        <aside className="sidebar sidebar-info" aria-label="App and code">
          <Panel id="app" title="App">
            <select className="wide" value={entry.id} onChange={(e) => (setSketchId(e.target.value), e.target.blur())} aria-label="App">
              {GROUPS.filter((group) => entries.some((e) => e.group === group)).map((group) => (
                <optgroup key={group} label={group}>
                  {entries
                    .filter((e) => e.group === group)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {entry.sketch.description && <p className="sketch-desc">{entry.sketch.description}</p>}
          </Panel>
          <ResidentPanel code={entry.code} appName={entry.name.replace(/^▶ /, '')} />
          <Console lines={logs} onClear={() => setLogs([])} />
        </aside>
        {run && (
          <DeviceView
            run={run}
            clock={clock}
            view={view}
            error={error}
            onDropApp={(name, code) => session.setLive({ name: name.replace(/\.lua$/, ''), code, source: 'file' })}
          />
        )}
        {/* Right: the hardware — controls, the display, and the parts on the desk. */}
        <aside className="sidebar sidebar-controls" aria-label="Controls and hardware">
          {run && (
            <InputPanel
              run={run}
              display={
                <DeviceInfo device={device}>
                  <select className="wide" value={device.id} onChange={(e) => (setDeviceId(e.target.value), e.target.blur())} aria-label="Display">
                    {byTech.map(({ tech, list }) => (
                      <optgroup key={tech} label={TECH_LABEL[tech]}>
                        {list.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </DeviceInfo>
              }
              onBind={(control, source) => {
                control.bind(source);
                saveBinding(entry.id, control.name, source);
              }}
            />
          )}
        </aside>
      </main>
    </div>
  );
}
