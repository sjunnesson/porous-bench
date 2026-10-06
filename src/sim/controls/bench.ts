// The bench: every physical part on the desk for one run. Sketches that declare concrete hardware
// (button(), knob(), ld2410() …) put those parts here directly. Abstract controls (dial(),
// trigger()) *claim* parts for the source the user picked, and the bench decides when a part can
// be shared: one IMU and one radar per board, an encoder's rotation and its push can serve two
// different controls, while a pot or a push button belongs to one control. A part that nobody
// claims any more leaves the desk.

import type { SimClock } from '../clock';
import type { SimInput } from '../inputs/input';

export type Role = 'rotate' | 'push' | 'pot' | 'button' | 'minus' | 'plus' | 'imu' | 'radar';

interface Entry {
  part: SimInput;
  declared: boolean;
  /** owner → the role it uses this part for */
  claims: Map<object, Role>;
}

/** Roles a part can be claimed for again while someone else holds it. */
const SHARED: Partial<Record<Role, true>> = { imu: true, radar: true };

export class Bench {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(readonly clock: SimClock) {}

  /** A part the sketch declared itself (concrete hardware). */
  addDeclared(part: SimInput): void {
    this.entries.push({ part, declared: true, claims: new Map() });
    this.changed();
  }

  /**
   * Get a part of `kind` for `owner` to use in `role`: an existing one when the role allows
   * sharing (or the part has that role free, like an encoder's push), otherwise a new one.
   */
  claim<T extends SimInput>(owner: object, role: Role, kind: SimInput['kind'], create: () => T): T {
    const usable = (e: Entry) => {
      if (e.part.kind !== kind) return false;
      if (SHARED[role]) return true;
      if (e.declared) return false; // the sketch reads declared parts itself
      // Only an encoder serves two controls at once: one turns it, another pushes it.
      if (e.claims.size > 0 && e.part.kind !== 'knob') return false;
      return ![...e.claims.values()].includes(role);
    };
    // Prefer a part that already serves another role (encoder push on the dial's own encoder).
    let entry = this.entries.find((e) => usable(e) && e.claims.size > 0) ?? this.entries.find(usable);
    if (!entry) {
      entry = { part: create(), declared: false, claims: new Map() };
      this.entries.push(entry);
    }
    entry.claims.set(owner, role);
    this.changed();
    return entry.part as T;
  }

  /** Drop every claim `owner` holds; unclaimed, undeclared parts leave the desk. */
  release(owner: object): void {
    for (const e of this.entries) e.claims.delete(owner);
    this.entries = this.entries.filter((e) => e.declared || e.claims.size > 0);
    this.changed();
  }

  /** Every part on the desk, in the order they arrived. */
  parts(): SimInput[] {
    return this.entries.map((e) => e.part);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
