import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/sim/clock';
import { Bench, DEFAULT_PARTS } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { Button } from '../src/sim/inputs/button';
import type { Climate } from '../src/sim/inputs/climate';
import type { Imu } from '../src/sim/inputs/imu';
import type { Knob } from '../src/sim/inputs/knob';
import type { LightSensor } from '../src/sim/inputs/light';
import type { Pir } from '../src/sim/inputs/pir';
import type { Pot } from '../src/sim/inputs/pot';
import type { Touch } from '../src/sim/inputs/touch';

/** A bench with the starter parts: an encoder, a slide pot and a button. */
function setup() {
  const clock = new SimClock();
  clock.paused = true;
  const bench = new Bench(clock);
  bench.load(DEFAULT_PARTS);
  return { clock, bench };
}

describe('Dial', () => {
  it('connects to the encoder on the bench, steps with it and clamps to its range', () => {
    const { bench } = setup();
    const d = new Dial({ label: 'Speed', min: 1, max: 10, start: 5 }, bench);
    expect(d.source).toBe('knob-1:rotate');
    const knob = d.parts()[0] as Knob;
    knob.turn(3);
    expect(d.value).toBe(8);
    expect(d.delta()).toBe(3);
    knob.turn(10);
    expect(d.value).toBe(10);
    expect(d.delta()).toBe(2); // only the steps it could actually move
  });

  it('follows a slide pot across its range once connected to it', () => {
    const { bench } = setup();
    const d = new Dial({ min: 0, max: 100, step: 10, start: 30 }, bench);
    d.bind('pot-1:position');
    const pot = bench.part('pot-1') as Pot;
    pot.set(1);
    expect(d.value).toBe(100);
    pot.set(0.24);
    expect(d.value).toBe(20); // snaps to the 10-step grid
  });

  it('maps IMU tilt, light level and temperature onto the range', () => {
    const { bench } = setup();
    const imu = bench.add('imu') as Imu;
    const light = bench.add('light') as LightSensor;
    const climate = bench.add('climate') as Climate;
    const tilt = new Dial({ min: -6, max: 6, start: 0, via: 'imu-x' }, bench);
    expect(tilt.parts()[0]).toBe(imu);
    imu.setTilt(1, 0);
    expect(tilt.value).toBe(6);
    const level = new Dial({ min: 0, max: 100, via: 'light' }, bench);
    light.set(0.5);
    expect(level.value).toBe(50);
    const temp = new Dial({ min: 0, max: 55, via: 'temperature' }, bench);
    expect(temp.parts()[0]).toBe(climate);
    climate.setTemperature(45);
    expect(temp.value).toBe(55);
  });

  it('moves its hardware from the keyboard, and steps itself when nothing is connected', () => {
    const { bench } = setup();
    const d = new Dial({ min: 0, max: 10, start: 5 }, bench);
    expect(d.handleKey('ArrowRight', true)).toBe(true);
    expect(d.value).toBe(6);
    expect((d.parts()[0] as Knob).getPosition()).toBe(1); // the encoder itself turned
    d.bind('none');
    d.handleKey('ArrowLeft', true);
    expect(d.value).toBe(5);
  });
});

describe('Trigger', () => {
  it('reports button edges, even a tap shorter than the read interval', () => {
    const { bench } = setup();
    const t = new Trigger({ label: 'Next' }, bench);
    const b = t.parts()[0] as Button;
    expect(b).toBe(bench.part('button-1'));
    b.setDown(true);
    b.setDown(false);
    expect(t.wasPressed()).toBe(true);
    expect(t.wasReleased()).toBe(true);
    expect(t.wasPressed()).toBe(false);
  });

  it('fires on an IMU shake and from its key whatever the source', () => {
    const { clock, bench } = setup();
    const imu = bench.add('imu') as Imu;
    const t = new Trigger({ label: 'Jump', key: 'Space', via: 'shake' }, bench);
    expect(t.parts()[0]).toBe(imu);
    imu.shake();
    expect(t.wasPressed()).toBe(true);
    expect(t.isPressed()).toBe(true);
    clock.advance(800);
    expect(t.isPressed()).toBe(false);
    expect(t.wasReleased()).toBe(true);
    t.handleKey('Space', true);
    expect(t.wasPressed()).toBe(true);
  });

  it('fires on PIR motion and a touch pad', () => {
    const { clock, bench } = setup();
    const pir = bench.add('pir') as Pir;
    const pad = bench.add('touch') as Touch;
    const motion = new Trigger({ via: 'motion' }, bench);
    const touched = new Trigger({ via: 'touch' }, bench);
    pir.wave();
    expect(motion.wasPressed()).toBe(true);
    clock.advance(pir.holdMs + 10);
    expect(motion.isPressed()).toBe(false);
    pad.setDown(true);
    pad.setDown(false);
    expect(touched.wasPressed()).toBe(true);
  });
});

describe('Bench', () => {
  it('lets one encoder turn one control while its push fires another', () => {
    const { bench } = setup();
    const move = new Dial({ label: 'Move' }, bench);
    const select = new Trigger({ label: 'Select', via: 'encoder-push' }, bench);
    expect(move.source).toBe('knob-1:rotate');
    expect(select.source).toBe('knob-1:push');
    (bench.part('knob-1') as Knob).button.setDown(true);
    expect(select.wasPressed()).toBe(true);
  });

  it('takes unused parts first, and the board button a control asks for', () => {
    const { bench, clock } = setup();
    const a = new Trigger({ label: 'A' }, bench);
    const b = new Trigger({ label: 'B' }, bench);
    expect(a.source).toBe('button-1:press');
    expect(b.source).toBe('knob-1:push'); // button-1 is taken; the encoder's push is free
    const board = new Bench(clock);
    board.addBuiltin('builtin-button-0', new Button({ label: 'BtnA' }, clock), 0);
    board.addBuiltin('builtin-button-1', new Button({ label: 'BtnB' }, clock), 1);
    expect(new Trigger({ builtin: 1 }, board).source).toBe('builtin-button-1:press');
    expect(new Trigger({ builtin: 0 }, board).source).toBe('builtin-button-0:press');
  });

  it('disconnects controls when their part is taken off, and only offers channels that fit', () => {
    const { bench } = setup();
    const d = new Dial({}, bench);
    bench.remove('knob-1');
    expect(d.source).toBe('none');
    expect(bench.options('dial').map((o) => `${o.connection.part}:${o.connection.channel}`)).toEqual(['pot-1:position']);
    expect(bench.options('trigger').map((o) => o.connection.part)).toEqual(['button-1']);
    expect(bench.specs().map((s) => s.id)).toEqual(['pot-1', 'button-1']);
  });
});
