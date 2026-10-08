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
 * The right column: Output (what the app draws on, and the board driving it), Inputs (the parts on
 * the bench) and Connections (which part drives each of the app's controls).
 */
export function InputPanel({ run, output, onBind }: Props) {
  const bench = run.bench;
  useSyncExternalStore(bench.subscribe, bench.getVersion);
  return (
    <>
      <Panel id="hardware" title="Output">
        {output}
      </Panel>
      <Panel id="inputs" title="Inputs">
        {bench.parts().map((p) => (
          <PartRow key={bench.idOf(p) ?? p.label} bench={bench} part={p} />
        ))}
        <AddPart bench={bench} />
      </Panel>
      <Panel id="connections" title="Connections">
        <p className="hint">{run.controls.length === 0 ? 'This app has no controls to connect.' : "Which part drives each of the app's controls."}</p>
        <div className="control-list">
          {run.controls.map((c) => (
            <ControlRow key={c.name} control={c} bench={bench} onBind={onBind} />
          ))}
        </div>
      </Panel>
    </>
  );
}

/**
 * A part on the bench: a header with its name and a way to take it off (or "built-in" for the board's
 * own), then its widget. The header carries the name, so the widget's own title is hidden.
 */
function PartRow({ bench, part }: { bench: Bench; part: SimInput }) {
  const builtin = bench.isBuiltin(part);
  const id = bench.idOf(part);
  return (
    <div className="part-row">
      <div className="part-head">
        <span className="label">{part.label}</span>
        {builtin ? (
          <span className="part-tag" title="Built into the board">
            built-in
          </span>
        ) : (
          <button className="link" onClick={() => id && bench.remove(id)} title={`Take ${part.label} off the bench`} aria-label={`Remove ${part.label}`}>
            remove
          </button>
        )}
      </div>
      <Widget input={part} />
    </div>
  );
}

function AddPart({ bench }: { bench: Bench }) {
  return (
    <div className="add-part">
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

/**
 * One of the app's controls: its name (and for a dial the app's value) over the menu of what drives
 * it, which gets the full width. The part's own state is under Inputs, so it isn't repeated here.
 */
function ControlRow({ control, bench, onBind }: { control: Control; bench: Bench; onBind: Props['onBind'] }) {
  useInput(control);
  const [reading, setReading] = useState('');
  // Absolute channels (pot, tilt, light …) change without telling the control, so poll it.
  const tick = useCallback(() => {
    if (control.kind !== 'dial') return;
    const next = formatValue(control as Dial);
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
  const keyHint = keys.length ? `Keys: ${keys.map(keyLabel).join(' ')}` : undefined;
  return (
    <div className="control-row">
      <div className="control-head">
        <span className="label" title={keyHint}>
          {control.label}
        </span>
        <span className="control-value">{control.kind === 'dial' ? reading : ''}</span>
      </div>
      <select
        className="wide"
        value={control.source}
        title={keyHint}
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
        <option value="none">Keyboard only{keys.length ? ` (${keys.map(keyLabel).join(' ')})` : ''}</option>
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
    </div>
  );
}

function formatValue(d: Dial): string {
  const v = d.value;
  return Number.isInteger(d.step) ? String(Math.round(v)) : v.toFixed(Math.min(3, String(d.step).split('.')[1]?.length ?? 1));
}
