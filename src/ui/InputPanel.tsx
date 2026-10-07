import { type ReactNode, useCallback, useState, useSyncExternalStore } from 'react';
import { type Bench, CHANNELS, type PartKind, PART_KINDS } from '../sim/controls/bench';
import type { Control, Dial, Trigger } from '../sim/controls/controls';
import type { Button } from '../sim/inputs/button';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Climate } from '../sim/inputs/climate';
import type { Imu } from '../sim/inputs/imu';
import type { SimInput } from '../sim/inputs/input';
import type { Knob } from '../sim/inputs/knob';
import type { LD2410 } from '../sim/inputs/ld2410';
import type { LightSensor } from '../sim/inputs/light';
import type { Pir } from '../sim/inputs/pir';
import type { Pot } from '../sim/inputs/pot';
import type { Touch } from '../sim/inputs/touch';
import type { SketchRun } from '../sim/runner';
import { useAnimationFrame, useInput } from './hooks';
import { Panel } from './Panel';
import { ButtonWidget } from './widgets/ButtonWidget';
import { BuzzerWidget } from './widgets/BuzzerWidget';
import { ClimateWidget } from './widgets/ClimateWidget';
import { ImuWidget } from './widgets/ImuWidget';
import { keyLabel } from './widgets/keys';
import { KnobWidget } from './widgets/KnobWidget';
import { LightWidget } from './widgets/LightWidget';
import { PirWidget } from './widgets/PirWidget';
import { PotWidget } from './widgets/PotWidget';
import { RadarWidget } from './widgets/RadarWidget';
import { TouchWidget } from './widgets/TouchWidget';

interface Props {
  run: SketchRun;
  /** The output block: what the app draws on (picker and specs). */
  output: ReactNode;
  /** Remember what the user connected a control to. */
  onBind(control: Control, source: string): void;
}

/**
 * The right column: Hardware (the output and the parts you put on the bench) and Connections
 * (which part drives each of the app's controls).
 */
export function InputPanel({ run, output, onBind }: Props) {
  const bench = run.bench;
  useSyncExternalStore(bench.subscribe, bench.getVersion);
  return (
    <>
      <Panel id="hardware" title="Hardware">
        <h3>Output</h3>
        {output}
        <h3>Inputs</h3>
        {bench.parts().map((p) => (
          <PartRow key={bench.idOf(p) ?? p.label} bench={bench} part={p} />
        ))}
        <AddPart bench={bench} />
      </Panel>
      <Panel id="connections" title="Connections">
        {run.controls.length === 0 && <p className="dim">This app has no controls to connect.</p>}
        {run.controls.map((c) => (
          <ControlRow key={c.name} control={c} bench={bench} onBind={onBind} />
        ))}
      </Panel>
    </>
  );
}

/** A part on the bench: its widget, and a way to take it off (unless it's built into the board). */
function PartRow({ bench, part }: { bench: Bench; part: SimInput }) {
  const builtin = bench.isBuiltin(part);
  const id = bench.idOf(part);
  return (
    <div className="part-row">
      <Widget input={part} />
      {builtin ? (
        <span className="part-tag dim" title="Built into the board">
          built-in
        </span>
      ) : (
        <button className="part-remove link" onClick={() => id && bench.remove(id)} title={`Take ${part.label} off the bench`} aria-label={`Remove ${part.label}`}>
          remove
        </button>
      )}
    </div>
  );
}

function AddPart({ bench }: { bench: Bench }) {
  return (
    <div className="control-via add-part">
      <select
        className="wide"
        value=""
        onChange={(e) => {
          if (e.target.value) bench.add(e.target.value as PartKind);
          e.target.blur();
        }}
        aria-label="Add an input"
      >
        <option value="">+ Add an input…</option>
        {PART_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Widget({ input }: { input: SimInput }) {
  switch (input.kind) {
    case 'button':
      return <ButtonWidget input={input as Button} />;
    case 'knob':
      return <KnobWidget input={input as Knob} />;
    case 'pot':
      return <PotWidget input={input as Pot} />;
    case 'ld2410':
      return <RadarWidget input={input as LD2410} />;
    case 'imu':
      return <ImuWidget input={input as Imu} />;
    case 'buzzer':
      return <BuzzerWidget input={input as Buzzer} />;
    case 'light':
      return <LightWidget input={input as LightSensor} />;
    case 'pir':
      return <PirWidget input={input as Pir} />;
    case 'climate':
      return <ClimateWidget input={input as Climate} />;
    case 'touch':
      return <TouchWidget input={input as Touch} />;
    default:
      return null;
  }
}

/** One of the app's controls: its live value and the part channel that drives it. */
function ControlRow({ control, bench, onBind }: { control: Control; bench: Bench; onBind: Props['onBind'] }) {
  useInput(control);
  const [reading, setReading] = useState('');
  // Absolute channels (pot, tilt, light …) change without telling the control, so poll it.
  const tick = useCallback(() => {
    const next = control.kind === 'dial' ? formatValue(control as Dial) : (control as Trigger).isPressed() ? 'on' : 'off';
    setReading((prev) => (prev === next ? prev : next));
  }, [control]);
  useAnimationFrame(tick);

  const options = bench.options(control.kind);
  // Kinds that could drive it but aren't on the bench: offer to add one and connect it.
  const fits = (k: PartKind) => CHANNELS[k].some((c) => (control.kind === 'trigger' ? c.kind === 'momentary' : c.kind !== 'momentary'));
  const addable = PART_KINDS.filter((k) => fits(k.kind) && !bench.first(k.kind));
  const keys =
    control.kind === 'dial'
      ? [(control as Dial).keys.down, (control as Dial).keys.up]
      : (control as Trigger).key
        ? [(control as Trigger).key!]
        : [];
  return (
    <div className="control-row">
      <div className="control-head">
        <span className="widget-title">{control.label}</span>
        {control.kind === 'dial' ? (
          <span className="control-value">{reading}</span>
        ) : (
          <span className={`led ${reading === 'on' ? 'on' : ''}`} aria-label={reading} />
        )}
      </div>
      <div className="control-via">
        <span className="dim">from</span>
        <select
          value={control.source}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('add:')) {
              const kind = v.slice(4) as PartKind;
              const part = bench.add(kind);
              const ch = CHANNELS[kind].find((c) => (control.kind === 'trigger' ? c.kind === 'momentary' : c.kind !== 'momentary'));
              if (ch) onBind(control, `${bench.idOf(part)}:${ch.id}`);
            } else onBind(control, v);
            e.target.blur();
          }}
          aria-label={`What drives ${control.label}`}
        >
          {options.map((o) => (
            <option key={`${o.connection.part}:${o.connection.channel}`} value={`${o.connection.part}:${o.connection.channel}`}>
              {o.part.label} · {o.channel.label}
            </option>
          ))}
          <option value="none">Keyboard only</option>
          {addable.length > 0 && (
            <optgroup label="Add to the bench">
              {addable.map((k) => (
                <option key={k.kind} value={`add:${k.kind}`}>
                  + {k.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {keys.map((k) => (
          <kbd key={k}>{keyLabel(k)}</kbd>
        ))}
      </div>
    </div>
  );
}

function formatValue(d: Dial): string {
  const v = d.value;
  return Number.isInteger(d.step) ? String(Math.round(v)) : v.toFixed(Math.min(3, String(d.step).split('.')[1]?.length ?? 1));
}
