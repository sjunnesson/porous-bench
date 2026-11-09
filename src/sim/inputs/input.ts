import type { SimClock } from '../clock';
import type { Bench } from '../controls/bench';

export interface InputContext {
  clock: SimClock;
  /** Where abstract controls find (and share) their hardware. */
  bench: Bench;
}

/** Declared by a sketch (`inputs: { fire: button() }`); the runner creates one instance per run. */
export interface InputSpec<T extends SimInput = SimInput> {
  create(ctx: InputContext): T;
}

export type InputKind =
  | 'button'
  | 'knob'
  | 'pot'
  | 'ld2410'
  | 'imu'
  | 'buzzer'
  | 'light'
  | 'pir'
  | 'climate'
  | 'touch'
  | 'joystick'
  | 'switch'
  | 'mic'
  | 'ir'
  | 'keypad'
  | 'rfid'
  | 'tof'
  | 'co2'
  | 'pulse'
  | 'thermal'
  | 'haptic'
  | 'leds'
  | 'dial'
  | 'trigger';

/** Something a part's driver reports as it happens: a key pressed, a card arriving, a clap. */
export interface PartEvent {
  /** Numbered from 1, so a reader that comes by now and then takes every one it hasn't seen, in order. */
  seq: number;
  name: string;
  data: Record<string, unknown>;
}

/** A part's driver events, the newest `keep` of them. */
export class EventLog {
  private list: PartEvent[] = [];
  seq = 0;

  constructor(private keep = 32) {}

  push(name: string, data: Record<string, unknown>): void {
    this.list.push({ seq: ++this.seq, name, data });
    if (this.list.length > this.keep) this.list.shift();
  }
  /** The events after `seq`, oldest first. */
  since(seq: number): PartEvent[] {
    return this.list.filter((e) => e.seq > seq);
  }
}

/** Shared by the sketch (reads it) and the UI widget (drives it). */
export abstract class SimInput {
  abstract readonly kind: InputKind;
  name = '';
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(public label: string) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  protected changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
