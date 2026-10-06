import type { Button } from '../sim/inputs/button';
import type { Buzzer } from '../sim/inputs/buzzer';
import type { Imu } from '../sim/inputs/imu';
import type { SimInput } from '../sim/inputs/input';
import type { Knob } from '../sim/inputs/knob';
import type { LD2410 } from '../sim/inputs/ld2410';
import type { Pot } from '../sim/inputs/pot';
import { ButtonWidget } from './widgets/ButtonWidget';
import { BuzzerWidget } from './widgets/BuzzerWidget';
import { ImuWidget } from './widgets/ImuWidget';
import { KnobWidget } from './widgets/KnobWidget';
import { PotWidget } from './widgets/PotWidget';
import { RadarWidget } from './widgets/RadarWidget';

export function InputPanel({ inputs }: { inputs: Record<string, SimInput> }) {
  const list = Object.values(inputs);
  return (
    <div className="panel">
      <h2>Hardware</h2>
      {list.length === 0 && <p className="dim">This sketch declares no inputs.</p>}
      {list.map((input) => {
        switch (input.kind) {
          case 'button':
            return <ButtonWidget key={input.name} input={input as Button} />;
          case 'knob':
            return <KnobWidget key={input.name} input={input as Knob} />;
          case 'pot':
            return <PotWidget key={input.name} input={input as Pot} />;
          case 'ld2410':
            return <RadarWidget key={input.name} input={input as LD2410} />;
          case 'imu':
            return <ImuWidget key={input.name} input={input as Imu} />;
          case 'buzzer':
            return <BuzzerWidget key={input.name} input={input as Buzzer} />;
        }
      })}
    </div>
  );
}
