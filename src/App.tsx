import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { session } from './resident/session';
import { appPrompt } from './resident/prompt';
import { residentSketch } from './resident/sketch';
import { residentApps } from './resident-apps';
import { SimClock } from './sim/clock';
import { boardBench, DEFAULT_PARTS, type PartSpec } from './sim/controls/bench';
import { benchApp } from './sim/generate';
import { ledProfile, MATRIX_SIZES, type OutputKind, RING_COUNTS, STRIP_COUNTS } from './sim/leds';
import { devices, findDevice } from './sim/devices';
import type { Button } from './sim/inputs/button';
import type { Knob } from './sim/inputs/knob';
import { type LogLine, SketchRun } from './sim/runner';
import type { InputSpecs, Sketch } from './sim/sketch';
import { Console } from './ui/Console';
import { Copy } from './ui/Copy';
import { DeviceInfo } from './ui/DeviceInfo';
import { DeviceView, type ViewState } from './ui/DeviceView';
import { useClockState, usePersisted } from './ui/hooks';
import { InputPanel } from './ui/InputPanel';
import { Panel } from './ui/Panel';
import { ResidentPanel } from './ui/ResidentPanel';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const TECH_LABEL = { lcd: 'LCD', oled: 'OLED', epaper: 'E-paper', led: 'LED' } as const;

const GROUPS = ['Your app', 'Bench examples', 'Resident examples'] as const;

/** One Lua app in the Sketch menu. */
interface Entry {
  id: string;
  name: string;
  group: (typeof GROUPS)[number];
  sketch: Sketch<InputSpecs>;
  code: string;
  /** The output it's written for (your own app runs on whatever is chosen). */
  target?: 'display' | 'strip' | 'matrix';
}

/** The parts you put on the bench, kept in this browser (first visit: a starter set). */
function loadParts(): PartSpec[] {
  try {
    const raw = localStorage.getItem('bench:parts');
    return raw ? (JSON.parse(raw) as PartSpec[]) : DEFAULT_PARTS;
  } catch {
    return DEFAULT_PARTS;
  }
}
function saveParts(parts: PartSpec[]) {
  try {
    localStorage.setItem('bench:parts', JSON.stringify(parts));
  } catch {
    /* not persisted */
  }
}

/** What the user connected each of an app's controls to, kept across reloads. */
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
  target: a.target,
}));

export default function App() {
  const clock = useMemo(() => new SimClock(), []);
  const { paused, speed } = useClockState(clock);
  const [sketchId, setSketchId] = usePersisted('sketch', 'resident:hello-display');
  const [deviceId, setDeviceId] = usePersisted('device', 'waveshare-esp32-c6-lcd-1.47');
  // The output: a display module, or an LED strip, ring or matrix (kept in this browser).
  const [outputKind, setOutputKind] = usePersisted<OutputKind>('output-kind', 'display');
  const [stripCount, setStripCount] = usePersisted('output-strip', 30);
  const [ringCount, setRingCount] = usePersisted('output-ring', 16);
  const [matrixSize, setMatrixSize] = usePersisted('output-matrix', '8x8');
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

  const device = useMemo(() => {
    if (outputKind === 'strip') return ledProfile({ kind: 'strip', count: stripCount });
    if (outputKind === 'ring') return ledProfile({ kind: 'ring', count: ringCount });
    if (outputKind === 'matrix') {
      const [w, h] = matrixSize.split('x').map(Number);
      return ledProfile({ kind: 'matrix', w, h });
    }
    return findDevice(deviceId) ?? devices[0];
  }, [outputKind, deviceId, stripCount, ringCount, matrixSize]);

  // The App menu shows what fits the output: display apps, strip apps (strips and rings), matrix apps.
  const target = outputKind === 'ring' ? 'strip' : outputKind;
  const allEntries: Entry[] = [...(liveEntry ? [liveEntry] : []), ...bundled];
  const fitting = allEntries.filter((e) => !e.target || e.target === target);
  const entries = fitting.length ? fitting : allEntries;
  const entry = entries.find((s) => s.id === sketchId) ?? entries[0];

  // The bench: the board's own hardware plus your parts. It outlives app switches (a new board
  // brings its own built-ins), and every add or remove is saved in this browser.
  const bench = useMemo(() => {
    const b = boardBench(device, clock, loadParts());
    b.onEdit = saveParts;
    return b;
  }, [device, clock]);

  const [run, setRun] = useState<SketchRun | null>(null);
  useEffect(() => {
    const r = new SketchRun(entry.sketch, device, clock, {
      onLog: (line) => setLogs((l) => [...l.slice(-299), line]),
      onError: (err) => setError(err instanceof Error ? (err.stack ?? err.message) : String(err)),
      // Controls appear as the app declares them; each picks up the hardware chosen last time.
      bindingFor: (control) => loadBinding(entry.id, control),
    }, bench);
    setRun(r);
    setLogs([]);
    setError(null);
    session.log = (level, text) => r.stopped || setLogs((l) => [...l.slice(-299), { t: r.millis(), text, level: level === 'info' ? 'log' : level }]);
    void r.start();
    return () => r.stop();
  }, [entry.sketch, device, clock, bench, restarts]);

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
            <div className="row">
              <button
                onClick={() =>
                  session.setLive({
                    name: 'My bench',
                    code: benchApp(target, bench.hardware()),
                    source: 'editor',
                    description: 'Every input on your bench, connected and shown live. Its code is below: change it and Run to make it your own.',
                  })
                }
                title="Write a Lua app with a control for every part on your bench, connected and shown live: a starting point to edit"
              >
                ✦ New app from my bench
              </button>
              <Copy
                label="Copy app prompt"
                title="Copy a prompt for Claude to write a new Lua app for this output and bench, with the right skills, ready to paste"
                text={() =>
                  appPrompt({
                    device,
                    parts: bench.hardware(),
                    controls: (run?.controls ?? []).map((c) => ({ label: c.label, kind: c.kind, source: c.source })),
                    app: { id: entry.id, name: entry.name.replace(/^▶ /, ''), description: entry.sketch.description, code: entry.code, bundled: entry.id !== 'resident:live' },
                    deviceId: session.deviceId,
                    online: session.status === 'online',
                  })
                }
              />
            </div>
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
              output={
                <DeviceInfo device={device}>
                  <div className="output-pick">
                    <select className="wide" value={outputKind} onChange={(e) => (setOutputKind(e.target.value as OutputKind), e.target.blur())} aria-label="Output">
                      <option value="display">Display</option>
                      <option value="strip">LED strip</option>
                      <option value="ring">LED ring</option>
                      <option value="matrix">LED matrix</option>
                    </select>
                    {outputKind === 'display' && (
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
                    )}
                    {outputKind === 'strip' && (
                      <select className="wide" value={stripCount} onChange={(e) => (setStripCount(Number(e.target.value)), e.target.blur())} aria-label="LEDs on the strip">
                        {STRIP_COUNTS.map((n) => (
                          <option key={n} value={n}>
                            {n} LEDs
                          </option>
                        ))}
                      </select>
                    )}
                    {outputKind === 'ring' && (
                      <select className="wide" value={ringCount} onChange={(e) => (setRingCount(Number(e.target.value)), e.target.blur())} aria-label="LEDs on the ring">
                        {RING_COUNTS.map((n) => (
                          <option key={n} value={n}>
                            {n} LEDs
                          </option>
                        ))}
                      </select>
                    )}
                    {outputKind === 'matrix' && (
                      <select className="wide" value={matrixSize} onChange={(e) => (setMatrixSize(e.target.value), e.target.blur())} aria-label="Matrix size">
                        {MATRIX_SIZES.map(([w, h]) => (
                          <option key={`${w}x${h}`} value={`${w}x${h}`}>
                            {w} × {h}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
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
