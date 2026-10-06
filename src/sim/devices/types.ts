// A DeviceProfile describes one display product as data. The simulator derives everything from it:
// resolution, pixel format, how fast frames can travel over the bus, and how the panel looks.
// The hardware fields (controller, RAM offsets, wiring) aren't simulated byte-for-byte; they're
// recorded so porting a sketch to the real board has the facts in one place.

export type Tech = 'lcd' | 'oled' | 'epaper';

/** A face of the body. Coordinates on a face are (u, v) in mm from its centre:
 *  front/back: u = x (right), v = y (up) · left/right: u = depth (towards the viewer), v = y
 *  top/bottom: u = x, v = depth. Everything is in the panel's native orientation. */
export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export type EnclosurePart =
  /** Clickable: `input` is the n-th button the sketch declares (Resident apps: 0 = A, 1 = B). */
  | { kind: 'button'; face: Face; u: number; v: number; w: number; h: number; input?: number; color?: string; label?: string }
  | { kind: 'port'; face: Face; u: number; v: number; w: number; h: number; label?: string }
  | { kind: 'header'; face: Face; u: number; v: number; pins: number; along: 'u' | 'v'; label?: string }
  | { kind: 'hole'; face: Face; u: number; v: number; r: number }
  | { kind: 'led'; face: Face; u: number; v: number; r: number; color: string; label?: string };

/** The physical part around the glass, drawn as a ghosted wireframe in the 3D view (mm). */
export interface Enclosure {
  /** 'case' = a moulded device (rounded, bevelled); 'pcb' = a bare board with the display module on top. */
  style: 'case' | 'pcb';
  body: { w: number; h: number; d: number; r: number };
  /** pcb style: the display module (glass + frame) sitting on the board's front. */
  module?: { w: number; h: number; d: number; r: number; x: number; y: number };
  /** Centre of the active area relative to the body centre. */
  screen: { x: number; y: number };
  parts?: EnclosurePart[];
}

export interface DeviceProfile {
  id: string;
  name: string;
  tech: Tech;
  /** Visible pixels in the panel's native orientation. */
  width: number;
  height: number;

  controller: string;
  bus: { kind: 'spi' | 'i2c'; hz: number; i2cAddress?: number };
  /** Where the visible area sits inside controller RAM (what drivers call colstart/rowstart). */
  ram?: { width: number; height: number; offsetX: number; offsetY: number };
  /** setRotation() the board's firmware applies (e.g. M5StickC Plus2 runs landscape). Used for Resident apps. */
  firmwareRotation?: number;
  /** Function → GPIO on boards with a built-in display. */
  wiring?: Record<string, number>;
  /** Things a driver must get right on real hardware. */
  porting?: string[];
  url?: string;

  enclosure?: Enclosure;

  look: {
    activeWidthMm: number;
    activeHeightMm: number;
    cornerRadiusPx?: number;
    /** OLED: lit pixel. E-paper: paper. */
    light?: string;
    /** OLED: unlit pixel. E-paper: ink. */
    dark?: string;
    /** Two-colour OLED glass: the first N rows use accentColor. */
    accentRows?: number;
    accentColor?: string;
  };

  epaper?: {
    fullRefreshMs: number;
    partialRefreshMs: number;
    /** show('auto') does a full refresh after this many partial ones. */
    fullRefreshEvery: number;
  };
}
