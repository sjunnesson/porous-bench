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

  /**
   * A local wall time → the instant, as ezTime resolves it on the board: a repeated hour is its first
   * time round, and an hour the clocks skipped is read as summer time (the later, larger offset, and
   * its name), so wall time minus the offset given is always the instant given.
   */
  resolve(wall: number): { utc: number; gmtoff: number; abbr: string } {
    // The offsets either side of any change near this wall time; the ones it really has are those
    // that give back an instant with that offset.
    const before = this.at(wall - 86400).gmtoff;
    const after = this.at(wall + 86400).gmtoff;
    const fits = [before, after].filter((off) => this.at(wall - off).gmtoff === off);
    if (fits.length) {
      const off = Math.max(...fits); // both, in a repeated hour: the larger offset is the earlier instant
      return { utc: wall - off, gmtoff: off, abbr: this.at(wall - off).abbr };
    }
    const off = Math.max(before, after);
    // The name from just after the change (wall less the earlier offset lands there).
    return { utc: wall - off, gmtoff: off, abbr: this.at(wall - Math.min(before, after)).abbr };
  }
}
