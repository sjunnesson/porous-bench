// Port of Resident's src/ResidentTimeCore.h: proleptic-Gregorian calendar maths and its strftime,
// so dates format exactly as on the device (C locale, Resident's own directive set).

export interface Tm {
  year: number;
  mon: number; // 1..12
  mday: number;
  hour: number;
  min: number;
  sec: number;
  wday: number; // Monday = 0
  yday: number; // 1..366
  gmtoff: number; // seconds east of UTC
  zone: string;
  hasZone: boolean;
}

const tdiv = (a: number, b: number) => Math.trunc(a / b); // C integer division

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Days since 1970-01-01. */
export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = tdiv(y >= 0 ? y : y - 399, 400);
  const yoe = y - era * 400;
  const doy = tdiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1;
  const doe = yoe * 365 + tdiv(yoe, 4) - tdiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): [number, number, number] {
  z += 719468;
  const era = tdiv(z >= 0 ? z : z - 146096, 146097);
  const doe = z - era * 146097;
  const yoe = tdiv(doe - tdiv(doe, 1460) + tdiv(doe, 36524) - tdiv(doe, 146096), 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + tdiv(yoe, 4) - tdiv(yoe, 100));
  const mp = tdiv(5 * doy + 2, 153);
  const d = doy - tdiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y += 1;
  return [y, m, d];
}

export function weekdayAndYearday(y: number, m: number, d: number): [number, number] {
  const days = daysFromCivil(y, m, d);
  return [(((days + 3) % 7) + 7) % 7, days - daysFromCivil(y, 1, 1) + 1];
}

export function breakDown(utcSeconds: number, gmtoff: number, zone: string): Tm {
  const local = utcSeconds + gmtoff;
  const days = floorDiv(local, 86400);
  const secs = local - days * 86400;
  const [year, mon, mday] = civilFromDays(days);
  const [wday, yday] = weekdayAndYearday(year, mon, mday);
  return {
    year,
    mon,
    mday,
    hour: tdiv(secs, 3600),
    min: tdiv(secs, 60) % 60,
    sec: secs % 60,
    wday,
    yday,
    gmtoff,
    zone,
    hasZone: true,
  };
}

/** Wall-clock fields read as if they were UTC; out-of-range fields carry like C's mktime. */
export function wallSeconds(t: { year: number; mon: number; mday: number; hour: number; min: number; sec: number }): number {
  let y = t.year;
  let mon0 = t.mon - 1;
  y += floorDiv(mon0, 12);
  mon0 -= floorDiv(mon0, 12) * 12;
  const days = daysFromCivil(y, mon0 + 1, 1) + t.mday - 1;
  return days * 86400 + t.hour * 3600 + t.min * 60 + t.sec;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const num = (v: number, width: number, pad: '0' | ' ') => {
  const s = String(Math.abs(v)).padStart(width - (v < 0 ? 1 : 0), pad);
  return v < 0 ? `-${s}` : s;
};

function weekNumber(t: Tm, firstDay: number): number {
  const wdayFromFirst = (((t.wday - firstDay) % 7) + 7) % 7;
  return tdiv(t.yday - 1 + 7 - wdayFromFirst, 7);
}

/** Resident's strftime. Output is capped at 255 bytes like the device's buffer. */
export function strftime(fmt: string, t: Tm): string {
  let o = '';
  const wday = ((t.wday % 7) + 7) % 7;
  const mon0 = (((t.mon - 1) % 12) + 12) % 12;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch !== '%') {
      o += ch;
      continue;
    }
    const c = fmt[++i];
    if (c === undefined) {
      o += '%';
      break;
    }
    switch (c) {
      case 'a': o += DAYS[wday].slice(0, 3); break;
      case 'A': o += DAYS[wday]; break;
      case 'b': o += MONTHS[mon0].slice(0, 3); break;
      case 'B': o += MONTHS[mon0]; break;
      case 'c': o += strftime('%a %b %e %H:%M:%S %Y', t); break;
      case 'd': o += num(t.mday, 2, '0'); break;
      case 'e': o += num(t.mday, 2, ' '); break;
      case 'H': o += num(t.hour, 2, '0'); break;
      case 'I': o += num(t.hour % 12 === 0 ? 12 : t.hour % 12, 2, '0'); break;
      case 'j': o += num(t.yday, 3, '0'); break;
      case 'm': o += num(t.mon, 2, '0'); break;
      case 'M': o += num(t.min, 2, '0'); break;
      case 'p': o += t.hour < 12 ? 'AM' : 'PM'; break;
      case 'S': o += num(t.sec, 2, '0'); break;
      case 'U': o += num(weekNumber(t, 6), 2, '0'); break;
      case 'w': o += num((wday + 1) % 7, 1, '0'); break;
      case 'W': o += num(weekNumber(t, 0), 2, '0'); break;
      case 'x': o += strftime('%m/%d/%y', t); break;
      case 'X': o += strftime('%H:%M:%S', t); break;
      case 'y': o += num((((t.year % 100) + 100) % 100), 2, '0'); break;
      case 'Y': o += num(t.year, 1, '0'); break;
      case 'Z': if (t.hasZone) o += t.zone; break;
      case 'z': {
        if (!t.hasZone) break;
        const a = Math.abs(t.gmtoff);
        o += (t.gmtoff < 0 ? '-' : '+') + num(tdiv(a, 3600), 2, '0') + num(tdiv(a, 60) % 60, 2, '0');
        break;
      }
      case '%': o += '%'; break;
      default: o += `%${c}`;
    }
  }
  return o.slice(0, 255);
}
