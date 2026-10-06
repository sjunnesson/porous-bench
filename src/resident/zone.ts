// The sandbox's local zone. The device gets it from the host hello (`tz`); the simulator defaults
// to the browser's zone so clocks read right out of the box, and follows a host hello if one arrives.

import { wallSeconds } from './timecore';

export class Zone {
  readonly name: string;
  private fmt: Intl.DateTimeFormat;
  private abbr: Intl.DateTimeFormat;

  constructor(name?: string) {
    this.name = name ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    this.fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: this.name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      era: 'short',
    });
    this.abbr = new Intl.DateTimeFormat('en-GB', { timeZone: this.name, timeZoneName: 'short' });
  }

  static valid(name: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
      return true;
    } catch {
      return false;
    }
  }

  /** Offset east of UTC (s) and abbreviation in effect at an instant. */
  at(utcSeconds: number): { gmtoff: number; abbr: string } {
    const d = new Date(utcSeconds * 1000);
    const p = Object.fromEntries(this.fmt.formatToParts(d).map((x) => [x.type, x.value]));
    let year = Number(p.year);
    if (p.era === 'BC') year = 1 - year;
    const wall = wallSeconds({ year, mon: Number(p.month), mday: Number(p.day), hour: Number(p.hour), min: Number(p.minute), sec: Number(p.second) });
    const gmtoff = wall - utcSeconds;
    const name = this.abbr.formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? 'UTC';
    return { gmtoff, abbr: name === 'GMT' && gmtoff === 0 && this.name === 'UTC' ? 'UTC' : name };
  }

  /** A local wall time → the instant. Skipped hours resolve forward, repeated ones to the first. */
  resolve(wall: number): { utc: number; gmtoff: number; abbr: string } {
    let utc = wall - this.at(wall).gmtoff;
    for (let i = 0; i < 2; i++) utc = wall - this.at(utc).gmtoff;
    const earlier = wall - this.at(utc - 3600).gmtoff;
    if (earlier < utc && wall - this.at(earlier).gmtoff === earlier) utc = earlier;
    const z = this.at(utc);
    return { utc, gmtoff: z.gmtoff, abbr: z.abbr };
  }
}
