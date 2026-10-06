import { type ReactNode, useCallback, useState, useSyncExternalStore } from 'react';
import { type Control, DIAL_SOURCES, type Dial, TRIGGER_SOURCES, type Trigger } from '../sim/controls/controls';
import type { Button } from '../sim/inputs/button';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Imu } from '../sim/inputs/imu';
import type { SimInput } from '../sim/inputs/input';
import type { Knob } from '../sim/inputs/knob';
import type { LD2410 } from '../sim/inputs/ld2410';
import type { Pot } from '../sim/inputs/pot';
import type { SketchRun } from '../sim/runner';
import { useAnimationFrame, useInput } from './hooks';
import { Panel } from './Panel';
import { ButtonWidget } from './widgets/ButtonWidget';
import { BuzzerWidget } from './widgets/BuzzerWidget';
import { ImuWidget } from './widgets/ImuWidget';
import { keyLabel } from './widgets/keys';
import { KnobWidget } from './widgets/KnobWidget';
import { PotWidget } from './widgets/PotWidget';
import { RadarWidget } from './widgets/RadarWidget';

interface Props {
  run: SketchRun;
  /** The display block (picker and specs), in its own section after Controls. */
  display?: ReactNode;
  /** Remember the hardware the user picked for a control. */
  onBind(control: Control, source: string): void;
}

export function InputPanel({ run, display, onBind }: Props) {
  useSyncExternalStore(run.bench.subscribe, run.bench.getVersion);
  const parts = run.bench.parts();
  return (
    <>
      {run.controls.length > 0 && (
        <Panel id="controls" title="Controls">
          {run.controls.map((c) => (
            <ControlRow key={c.name} control={c} onBind={onBind} builtIn={hasBuiltInButton(run, c)} />
          ))}
        </Panel>
      )}
      {display && (
        <Panel id="display" title="Display">
          {display}
        </Panel>
      )}
      <Panel id="parts" title="Parts">
        {parts.length === 0 && <p className="dim">This app uses no inputs.</p>}
        {parts.map((input, i) => (
          <Widget key={`${input.kind}-${i}-${input.label}`} input={input} />
        ))}
      </Panel>
    </>
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
    default:
      return null;
  }
}

/** Whether the device has a physical button of its own for this control (its n-th button-like input). */
function hasBuiltInButton(run: SketchRun, control: Control): boolean {
  if (control.kind !== 'trigger') return false;
  const n = run.pressables().findIndex((p) => p.input === control);
  return n >= 0 && !!run.device.enclosure?.parts?.some((p) => p.kind === 'button' && p.input === n);
}

/** One abstract control: its live value and the hardware driving it. */
function ControlRow({ control, onBind, builtIn }: { control: Control; onBind: Props['onBind']; builtIn: boolean }) {
  useInput(control);
  const [reading, setReading] = useState('');
  // Absolute sources (pot, tilt, distance) change without telling the control, so poll it.
  const tick = useCallback(() => {
    const next = control.kind === 'dial' ? formatValue(control as Dial) : (control as Trigger).isPressed() ? 'on' : 'off';
    setReading((prev) => (prev === next ? prev : next));
  }, [control]);
  useAnimationFrame(tick);

  const sources = control.kind === 'dial' ? DIAL_SOURCES : TRIGGER_SOURCES;
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
        <span className="dim">via</span>
        <select
          value={control.source}
          onChange={(e) => {
            onBind(control, e.target.value);
            e.target.blur();
          }}
          aria-label={`Hardware for ${control.label}`}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === 'button' && builtIn ? 'Built-in button' : s.label}
            </option>
          ))}
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
