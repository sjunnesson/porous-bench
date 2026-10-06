import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/sim/clock';
import { Bench } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import type { Button } from '../src/sim/inputs/button';
import type { Imu } from '../src/sim/inputs/imu';
import type { Knob } from '../src/sim/inputs/knob';
import type { Pot } from '../src/sim/inputs/pot';

function setup() {
  const clock = new SimClock();
  clock.paused = true;
  const bench = new Bench(clock);
  return { clock, bench };
}

const kinds = (bench: Bench) => bench.parts().map((p) => p.kind);

describe('Dial', () => {
  it('steps with an encoder and clamps to its range', () => {
    const { bench } = setup();
    const d = new Dial({ label: 'Speed', min: 1, max: 10, start: 5 }, bench);
    const knob = d.parts()[0] as Knob;
    knob.turn(3);
    expect(d.value).toBe(8);
    expect(d.delta()).toBe(3);
    knob.turn(10);
    expect(d.value).toBe(10);
    expect(d.delta()).toBe(2); // only the steps it could actually move
  });

  it('takes over at the current value when switched to a pot, then follows it', () => {
    const { bench } = setup();
    const d = new Dial({ min: 0, max: 100, step: 10, start: 30 }, bench);
    d.bind('pot');
    const pot = d.parts()[0] as Pot;
    expect(pot.value).toBeCloseTo(0.3);
    expect(d.value).toBe(30);
    pot.set(1);
    expect(d.value).toBe(100);
    expect(d.delta()).toBe(7);
    expect(kinds(bench)).toEqual(['pot']); // the encoder left the desk
  });

  it('maps IMU tilt onto the range', () => {
    const { bench } = setup();
    const d = new Dial({ min: -6, max: 6, start: 0, via: 'imu-x' }, bench);
    const imu = d.parts()[0] as Imu;
    imu.setTilt(1, 0);
    expect(d.value).toBe(6);
    imu.setTilt(-0.5, 0);
    expect(d.value).toBe(-3);
  });

  it('uses two separate buttons for − / +', () => {
    const { bench } = setup();
    const d = new Dial({ start: 0, via: 'buttons' }, bench);
    const [minus, plus] = d.parts() as Button[];
    expect(minus).not.toBe(plus);
    plus.setDown(true);
    plus.setDown(false);
    expect(d.delta()).toBe(1);
    minus.setDown(true);
    minus.setDown(false);
    expect(d.delta()).toBe(-1);
    expect(d.value).toBe(0);
  });

  it('moves its hardware from the keyboard', () => {
    const { bench } = setup();
    const d = new Dial({ min: 0, max: 10, start: 5 }, bench);
    expect(d.handleKey('ArrowRight', true)).toBe(true);
    expect(d.value).toBe(6);
    expect((d.parts()[0] as Knob).getPosition()).toBe(1); // the encoder itself turned
  });
});

describe('Trigger', () => {
  it('reports button edges, even a tap shorter than the read interval', () => {
    const { bench } = setup();
    const t = new Trigger({ label: 'Next' }, bench);
    const b = t.buttonPart!;
    b.setDown(true);
    b.setDown(false);
    expect(t.wasPressed()).toBe(true);
    expect(t.wasReleased()).toBe(true);
    expect(t.wasPressed()).toBe(false);
  });

  it("can use an external button that never takes over the device's own", () => {
    const { bench } = setup();
    const t = new Trigger({ label: 'A', key: 'KeyA' }, bench);
    expect(t.buttonPart).toBeDefined(); // a plain push button may sit on the device
    t.bind('external-button');
    expect(t.buttonPart).toBeUndefined();
    const b = t.parts()[0] as Button;
    expect(b.kind).toBe('button');
    b.setDown(true);
    expect(t.wasPressed()).toBe(true);
    t.handleKey('KeyA', false); // the key still drives it
    expect(t.isPressed()).toBe(false);
    expect(t.wasReleased()).toBe(true);
  });

  it('fires on an IMU shake and from its key whatever the source', () => {
    const { clock, bench } = setup();
    const t = new Trigger({ label: 'Jump', key: 'Space', via: 'shake' }, bench);
    const imu = t.parts()[0] as Imu;
    imu.shake();
    expect(t.wasPressed()).toBe(true);
    expect(t.isPressed()).toBe(true);
    clock.advance(800);
    expect(t.isPressed()).toBe(false);
    expect(t.wasReleased()).toBe(true);
    t.handleKey('Space', true);
    expect(t.wasPressed()).toBe(true);
  });
});

describe('Bench', () => {
  it("shares an encoder between one control's rotation and another's push", () => {
    const { bench } = setup();
    const move = new Dial({ label: 'Move' }, bench);
    const select = new Trigger({ label: 'Select', via: 'encoder-push' }, bench);
    expect(kinds(bench)).toEqual(['knob']);
    const knob = move.parts()[0] as Knob;
    knob.button.setDown(true);
    expect(select.wasPressed()).toBe(true);
  });

  it('gives each dial its own pot, shares one IMU, and clears parts nobody uses', () => {
    const { bench } = setup();
    const a = new Dial({ via: 'pot' }, bench);
    const b = new Dial({ via: 'pot' }, bench);
    expect(kinds(bench)).toEqual(['pot', 'pot']);
    a.bind('imu-x');
    const shake = new Trigger({ via: 'shake' }, bench);
    expect(kinds(bench).sort()).toEqual(['imu', 'pot']);
    expect(shake.parts()[0]).toBe(a.parts()[0]);
    a.bind('encoder');
    expect(kinds(bench).sort()).toEqual(['imu', 'knob', 'pot']); // the trigger still uses the IMU
    shake.bind('button');
    b.detach();
    expect(kinds(bench).sort()).toEqual(['button', 'knob']);
  });
});
