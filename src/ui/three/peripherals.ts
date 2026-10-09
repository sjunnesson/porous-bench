// The sketch's external hardware as parts on the desk next to the device, drawn in the same ghosted
// linework: a rotary encoder, tactile buttons, a slide pot, a piezo buzzer, an LD2410 radar with
// its detection fan, an LDR light sensor, a PIR, a DHT22 and a touch pad. Each one is live: it shows its input's state and you can work it with the mouse.
// Units are mm; the desk is the xy plane and +z points up out of it, towards the viewer.

import * as THREE from 'three';
import type { Button } from '../../sim/inputs/button';
import type { Buzzer } from '../../sim/inputs/buzzer';
import { type Climate, TEMP_RANGE } from '../../sim/inputs/climate';
import type { SimInput } from '../../sim/inputs/input';
import type { Knob } from '../../sim/inputs/knob';
import { FOV_DEG, type LD2410, MAX_RANGE_M } from '../../sim/inputs/ld2410';
import type { LightSensor } from '../../sim/inputs/light';
import type { Pir } from '../../sim/inputs/pir';
import type { Pot } from '../../sim/inputs/pot';
import type { Touch } from '../../sim/inputs/touch';

const BLUE = 0x1b4b7a;
const NOW = 0x8c3b1e;
const MUTED = 0x5a666d;
const LINE = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.72, depthWrite: false });
const LINE_DIM = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.28, depthWrite: false });

/** An ongoing drag that started on a part. */
export interface Grab {
  move(ray: THREE.Ray): void;
  up(): void;
}

export interface Peripheral {
  root: THREE.Group;
  /** Footprint on the desk, for layout. */
  w: number;
  h: number;
  /** Where the wire leaves the part, in root-local coordinates. */
  anchor: THREE.Vector3;
  /** Raycast targets that operate the part (press, turn, slide…). */
  targets: THREE.Object3D[];
  /** The part's body: press and drag these to move the part around the desk. */
  handles: THREE.Object3D[];
  /** The bench input this part stands for (set by buildPeripherals). */
  input?: SimInput;
  /** The body's outline on the desk, centred on the root, when wires end at it (a board's). */
  body?: { w: number; h: number };
  grab(hit: THREE.Object3D, ray: THREE.Ray): Grab | null;
  wheel?(hit: THREE.Object3D, dy: number): void;
  title(hit: THREE.Object3D): string;
  update(): void;
}

// ---- geometry helpers ------------------------------------------------------------------------

function edges(geo: THREE.BufferGeometry, material = LINE, threshold = 20): THREE.LineSegments {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, threshold), material);
  geo.dispose();
  return e;
}

/** A w×h×d block sitting on the desk (bottom at z = z0). */
function block(w: number, h: number, d: number, z0 = 0, material = LINE): THREE.LineSegments {
  const b = edges(new THREE.BoxGeometry(w, h, d), material);
  b.position.z = z0 + d / 2;
  return b;
}

/** A cylinder standing on the desk. `knurl` keeps every facet edge, like a grippy knob. */
function cylinder(r: number, d: number, z0: number, knurl = false, material = LINE): THREE.LineSegments {
  const geo = new THREE.CylinderGeometry(r, r, d, knurl ? 18 : 32, 1);
  geo.rotateX(Math.PI / 2);
  const c = edges(geo, material, knurl ? 1 : 20);
  c.position.z = z0 + d / 2;
  return c;
}

/** Invisible-but-pickable mesh, and a solid fill used for caps that light up. */
function fillMesh(geo: THREE.BufferGeometry, color = BLUE, opacity = 0.08): THREE.Mesh {
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
}

function disc(r: number, z: number): THREE.Mesh {
  const m = fillMesh(new THREE.CircleGeometry(r, 32));
  m.position.z = z;
  return m;
}

/** A small mono uppercase label lying on the desk, in IBM Plex Mono (redrawn once the font loads). */
export function label(text: string, heightMm = 2.6, color = '#5a666d'): THREE.Mesh {
  const px = 64;
  const font = `500 ${px}px "IBM Plex Mono", ui-monospace, monospace`;
  const spacing = px * 0.18;
  const upper = text.toUpperCase();
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(upper).width + spacing * upper.length) + 8;
  c.height = Math.ceil(px * 1.3);
  const draw = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    let x = 4;
    for (const ch of upper) {
      ctx.fillText(ch, x, c.height / 2);
      x += ctx.measureText(ch).width + spacing;
    }
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font)) {
    void document.fonts.load(font).then(() => {
      draw();
      tex.needsUpdate = true;
    });
  }
  const w = (heightMm * c.width) / c.height;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, heightMm), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.userData.width = w;
  return mesh;
}

/** Intersect a ray with the plane z = zLocal of `obj`, returning the hit in obj-local coordinates. */
function onPlane(obj: THREE.Object3D, ray: THREE.Ray, zLocal: number): THREE.Vector3 | null {
  obj.updateMatrixWorld();
  const n = new THREE.Vector3(0, 0, 1).transformDirection(obj.matrixWorld);
  const p = obj.localToWorld(new THREE.Vector3(0, 0, zLocal));
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  return hit ? obj.worldToLocal(hit) : null;
}

/** A handle added to `root`. */
function handleOf(root: THREE.Group, w: number, h: number, d: number, z0 = 0, y = 0): THREE.Mesh {
  const m = handle(w, h, d, z0, 0, y);
  root.add(m);
  return m;
}

/** An invisible box over a part's body, to grab it by. Transparent, since the raycaster skips invisible meshes. */
function handle(w: number, h: number, d: number, z0 = 0, x = 0, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  m.position.set(x, y, z0 + d / 2);
  return m;
}

function place<T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T {
  obj.position.set(x, y, z);
  return obj;
}

/** Move a part sideways on the desk, keeping the height it was built at. */
function xy<T extends THREE.Object3D>(obj: T, x: number, y: number): T {
  obj.position.x = x;
  obj.position.y = y;
  return obj;
}

function setFill(m: THREE.Mesh, color: number, opacity: number) {
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.color.setHex(color);
  mat.opacity = opacity;
}

function withLabel(root: THREE.Group, text: string, y: number) {
  const l = label(text);
  l.position.set(0, y, 0.05);
  root.add(l);
}

// ---- parts -------------------------------------------------------------------------------------

/** 12 mm tactile switch on a small breakout. */
function tactile(input: Button): Peripheral {
  const root = new THREE.Group();
  root.add(block(18, 18, 1.6));
  root.add(block(12, 12, 3.5, 1.6));
  const capZ = 5.1;
  const cap = new THREE.Group();
  cap.add(cylinder(3.6, 2.2, 0));
  const fill = disc(3.6, 2.25);
  cap.add(fill);
  cap.position.z = capZ;
  root.add(cap);
  withLabel(root, input.label, -12.5);
  const body = handle(18, 18, 5, 0);
  root.add(body);
  return {
    root,
    w: 22,
    h: 26,
    anchor: new THREE.Vector3(-9, 0, 0.8),
    targets: [fill],
    handles: [body],
    grab: () => {
      input.setDown(true);
      return { move: () => {}, up: () => input.setDown(false) };
    },
    title: () => `${input.label}${input.key ? ` (${input.key.replace(/^Key/, '')})` : ''}`,
    update() {
      const down = input.isPressed();
      cap.position.z = down ? capZ - 0.9 : capZ;
      setFill(fill, down ? NOW : BLUE, down ? 0.85 : 0.08);
    },
  };
}

/** KY-040-style rotary encoder: board, encoder can, knurled knob with a push centre. */
function encoder(input: Knob): Peripheral {
  const root = new THREE.Group();
  root.add(block(26, 19, 1.6));
  root.add(block(12.5, 13.5, 6.5, 1.6));
  const knob = new THREE.Group();
  knob.position.z = 8.1;
  const R = 7.5;
  knob.add(cylinder(R, 9, 0, true, LINE_DIM));
  const ring = disc(R, 9.02);
  setFill(ring, BLUE, 0.04);
  knob.add(ring);
  // Pointer notch, so turning is visible.
  const notch = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3.6), new THREE.MeshBasicMaterial({ color: BLUE }));
  notch.position.set(0, R - 2.3, 9.05);
  knob.add(notch);
  const push = disc(3, 9.08);
  knob.add(push);
  const pushRim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 3, 3).getPoints(24)), LINE);
  knob.add(place(pushRim, 0, 0, 9.1));
  root.add(knob);
  withLabel(root, input.label, -13.5);
  const step = (Math.PI * 2) / input.detents;
  return {
    root,
    w: 30,
    h: 30,
    anchor: new THREE.Vector3(-13, 0, 0.8),
    targets: [push, ring],
    handles: [handleOf(root, 26, 19, 8)],
    grab(hit, ray) {
      if (hit === push) {
        input.button.setDown(true);
        return { move: () => {}, up: () => input.button.setDown(false) };
      }
      const angle = (r: THREE.Ray) => {
        const p = onPlane(root, r, knob.position.z + 9);
        return p ? Math.atan2(p.y, p.x) : null;
      };
      let last = angle(ray);
      let acc = 0;
      return {
        move(r) {
          const a = angle(r);
          if (a === null || last === null) return;
          let d = a - last;
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          last = a;
          acc -= d; // clockwise is positive
          const clicks = Math.trunc(acc / step);
          if (clicks) {
            acc -= clicks * step;
            input.turn(clicks);
          }
        },
        up() {},
      };
    },
    wheel: (_hit, dy) => input.turn(dy > 0 ? -1 : 1),
    title: (hit) => (hit === push ? `${input.label}: push (${input.keys.press})` : `${input.label}: drag around or scroll to turn · ${input.getPosition()}`),
    update() {
      knob.rotation.z = -input.getPosition() * step;
      const down = input.isPressed();
      knob.position.z = down ? 7.4 : 8.1;
      setFill(push, down ? NOW : BLUE, down ? 0.85 : 0.1);
    },
  };
}

/** Slide potentiometer: long body, a slot, and a cap you drag along it. */
function slidePot(input: Pot): Peripheral {
  const root = new THREE.Group();
  const L = 58;
  const travel = 44;
  root.add(block(L + 6, 12, 1.6));
  root.add(block(L, 9, 7, 1.6));
  root.add(block(travel + 4, 1.4, 0.2, 8.6, LINE_DIM));
  const cap = new THREE.Group();
  cap.add(block(7, 10, 7, 0));
  const fill = fillMesh(new THREE.PlaneGeometry(7, 10));
  fill.position.z = 7.02;
  cap.add(fill);
  cap.position.z = 8.6;
  root.add(cap);
  const track = fillMesh(new THREE.PlaneGeometry(travel + 10, 14), BLUE, 0);
  track.position.z = 15.7;
  root.add(track);
  withLabel(root, input.label, -10);
  const setFrom = (ray: THREE.Ray) => {
    const p = onPlane(root, ray, 15.6);
    if (p) input.set(p.x / travel + 0.5);
  };
  return {
    root,
    w: L + 6,
    h: 22,
    anchor: new THREE.Vector3(-(L + 6) / 2, 0, 0.8),
    targets: [fill, track],
    handles: [handleOf(root, L + 6, 12, 8.6)],
    grab(_hit, ray) {
      setFrom(ray);
      return { move: setFrom, up() {} };
    },
    title: () => `${input.label}: drag · analogRead ≈ ${Math.round(input.value * 4095)}`,
    update() {
      cap.position.x = (input.value - 0.5) * travel;
    },
  };
}

/** Piezo disc on a carrier; pulses while it sounds. */
function piezo(input: Buzzer): Peripheral {
  const root = new THREE.Group();
  root.add(block(16, 16, 1.6));
  root.add(cylinder(6, 3.4, 1.6));
  const top = disc(6, 5.05);
  root.add(top);
  const hole = disc(1, 5.08);
  setFill(hole, BLUE, 0.6);
  root.add(hole);
  const wave = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 1, 1).getPoints(40)), new THREE.LineBasicMaterial({ color: NOW, transparent: true, opacity: 0 }));
  wave.position.z = 5.1;
  root.add(wave);
  withLabel(root, input.label, -11.5);
  let t = 0;
  return {
    root,
    w: 20,
    h: 26,
    anchor: new THREE.Vector3(-8, 0, 0.8),
    targets: [top],
    handles: [handleOf(root, 16, 16, 5)],
    grab: () => null,
    title: () => (input.isSounding() ? `${input.label}: ${input.freq} Hz` : `${input.label}: silent`),
    update() {
      const on = input.isSounding();
      setFill(top, on ? NOW : BLUE, on ? 0.5 : 0.06);
      t = on ? (t + 0.06) % 1 : 0;
      wave.scale.setScalar(6 + t * 8);
      (wave.material as THREE.LineBasicMaterial).opacity = on ? 0.6 * (1 - t) : 0;
    },
  };
}

/** HLK-LD2410 module with its 120° detection fan on the desk and the target walking in it. */
function radar(input: LD2410): Peripheral {
  const root = new THREE.Group();
  const scale = 13; // mm on the desk per metre in the room
  const R = MAX_RANGE_M * scale;
  const half = ((FOV_DEG / 2) * Math.PI) / 180;
  // Fan: gate arcs every 0.75 m and the two edges.
  const fan = new THREE.Group();
  for (let g = 1; g <= 8; g++) {
    const r = g * 0.75 * scale;
    const pts = new THREE.EllipseCurve(0, 0, r, r, Math.PI / 2 - half, Math.PI / 2 + half).getPoints(40);
    fan.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), g % 4 === 0 ? LINE : LINE_DIM));
  }
  for (const s of [-1, 1])
    fan.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(half) * s * R, Math.cos(half) * R, 0)]), LINE_DIM));
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.absarc(0, 0, R, Math.PI / 2 + half, Math.PI / 2 - half, true);
  shape.lineTo(0, 0);
  const area = fillMesh(new THREE.ShapeGeometry(shape, 32), BLUE, 0.04);
  fan.add(area);
  for (const m of [2, 4, 6]) {
    const l = label(`${m} m`, 2.2);
    l.position.set(3 + l.userData.width / 2, m * scale - 1.6, 0.05);
    fan.add(l);
  }
  root.add(fan);

  // The module itself, antenna side facing into the fan.
  const module = new THREE.Group();
  module.add(block(22, 7, 1, 0));
  // Its two antenna patches (transmit and receive).
  for (const x of [-5.5, -1.3]) module.add(place(block(3.2, 3.2, 0.1, 0, LINE_DIM), x, 0, 1.05));
  const out = disc(0.9, 1.1);
  out.position.x = 7.5;
  module.add(out);
  module.position.y = -4;
  root.add(module);

  const critter = character();
  critter.group.scale.setScalar(1.27); // diorama scale: a bit larger than true size so it reads
  root.add(critter.group);

  // Pick targets: the fan, an invisible floor around it (so the character can always be fetched
  // back, even from outside the fan) and the character itself.
  const floorW = 2 * R * 1.15;
  const floorH = R * 1.25;
  const floor = fillMesh(new THREE.PlaneGeometry(floorW, floorH), BLUE, 0);
  floor.position.set(0, floorH / 2 - 6, -0.02);
  root.add(floor);
  const limits = { x: floorW / 2 / scale - 0.2, y: (floorH - 6) / scale - 0.2 };

  withLabel(root, input.label, -10.5);
  let held: { ray: THREE.Ray; offset: THREE.Vector2 } | null = null;
  /** Send it walking to where the ray meets the floor. */
  const walkTo = (ray: THREE.Ray) => {
    const p = onPlane(root, ray, 0);
    if (!p) return;
    const x = Math.max(-limits.x, Math.min(limits.x, p.x / scale));
    const y = Math.max(0.15, Math.min(limits.y, p.y / scale));
    input.walkTo(x, y);
  };

  // Where it's walking to: a small cross on the floor.
  const goalMark = new THREE.Group();
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6), new THREE.MeshBasicMaterial({ color: NOW, transparent: true, opacity: 0.7 }));
    bar.rotation.z = a;
    goalMark.add(bar);
  }
  goalMark.position.z = 0.1;
  goalMark.visible = false;
  root.add(goalMark);
  return {
    root,
    w: floorW,
    h: R + 18,
    anchor: new THREE.Vector3(-11, -4, 0.5),
    targets: [critter.hit, area, floor],
    handles: [handleOf(root, 24, 9, 1.4, 0, -4)],
    grab(hit, ray) {
      if (hit === critter.hit) {
        // Pick it up by the head: it rises and hangs from your hand, follows the pointer and is
        // put down where you let go. The pointer is tracked at carrying height, so the head stays
        // under it, and relative to where you grabbed, so nothing jumps.
        critter.setHeld(true);
        const t = input.target();
        input.movePerson(t.x, t.y); // stop wandering: it's in your hand now
        // Where on the head you grabbed, relative to its centre line.
        const start = onPlane(root, ray, critter.headZ() * critter.group.scale.z);
        const offset = start ? new THREE.Vector2(start.x - t.x * scale, start.y - t.y * scale) : new THREE.Vector2();
        held = { ray: ray.clone(), offset };
        return {
          move: (r) => held?.ray.copy(r),
          up: () => {
            held = null;
            critter.setHeld(false);
          },
        };
      }
      // A click on the floor sends it walking there; hold and drag and it follows the cursor.
      walkTo(ray);
      return { move: walkTo, up() {} };
    },
    title: (hit) => (hit === critter.hit ? 'Pick me up by the head and put me somewhere' : `${input.label}: click to send the character walking here · ${input.mode}`),
    update() {
      if (held) {
        // The head is the pivot it hangs from: put it where the cursor ray crosses the head's
        // current height, so it stays in your hand while it lifts and while you carry it.
        const p = onPlane(root, held.ray, critter.headZ() * critter.group.scale.z);
        if (p) {
          const x = Math.max(-limits.x, Math.min(limits.x, (p.x - held.offset.x) / scale));
          const y = Math.max(0.15, Math.min(limits.y, (p.y - held.offset.y) / scale));
          input.movePerson(x, y);
        }
      }
      const t = input.target();
      const st = input.latest().report.state;
      const goal = input.walkGoal();
      goalMark.visible = !!goal;
      if (goal) goalMark.position.set(goal.x * scale, goal.y * scale, 0.1);
      critter.update(t.x * scale, t.y * scale, t.present, st & 1 ? NOW : st & 2 ? BLUE : MUTED);
      setFill(out, st ? NOW : BLUE, st ? 0.9 : 0.15);
    },
  };
}

/** A flat polyline lying at height z, from [x, y] pairs. */
function polyline(pts: [number, number][], z: number, material = LINE, closed = false): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, z)));
  return closed ? new THREE.LineLoop(geo, material) : new THREE.Line(geo, material);
}

/** A circle outline lying at height z. */
function ring(r: number, z: number, material = LINE): THREE.LineLoop {
  const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, r, r).getPoints(40)), material);
  l.position.z = z;
  return l;
}

/** A vertical drag over a part: the pointer's travel along the part's y axis, in mm, since the press. */
function dragY(root: THREE.Group, ray: THREE.Ray, z: number, onDelta: (dy: number) => void): Grab {
  const start = onPlane(root, ray, z);
  return {
    move(r) {
      const p = onPlane(root, r, z);
      if (start && p) onDelta(p.y - start.y);
    },
    up() {},
  };
}

/** Wheel deltas arrive in pixels (mouse) or small steps (trackpad): turn them into whole clicks. */
function wheelClicks(perClick = 40) {
  let acc = 0;
  return (dy: number) => {
    acc -= dy / perClick; // scrolling up is "more"
    const n = Math.trunc(acc);
    acc -= n;
    return n;
  };
}

const WARM = 0xe0a03a;

/** LDR module: a light-dependent resistor on a small board with its comparator pot and LEDs. */
function ldr(input: LightSensor): Peripheral {
  const root = new THREE.Group();
  root.add(block(20, 14, 1.6));
  // Trim pot and the two status LEDs, on the wire side.
  root.add(place(block(5, 5, 2.4, 0, LINE_DIM), -4.5, 2.5, 1.6 + 1.2));
  root.add(place(cylinder(1.6, 0.6, 0, false, LINE_DIM), -4.5, 2.5, 4 + 0.3));
  for (const y of [-3, -5]) root.add(place(block(1.6, 0.9, 0.5, 0, LINE_DIM), -6.5, y, 1.6 + 0.25));
  // The LDR: a 5 mm disc on its legs, with the squiggly CdS track on its face.
  const R = 2.6;
  const ldrX = 5;
  const sensor = new THREE.Group();
  sensor.position.set(ldrX, 0, 3.2);
  sensor.add(cylinder(R, 1.8, 0));
  const top = disc(R, 1.85);
  sensor.add(top);
  const track: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const x = -1.6 + (i * 3.2) / 6;
    const side = i % 2 ? 1 : -1;
    track.push([x, side * 1.7], [x, -side * 1.7]);
  }
  sensor.add(polyline(track, 1.9));
  for (const x of [-1.2, 1.2]) root.add(place(block(0.5, 0.5, 1.6, 0, LINE_DIM), ldrX + x, 0, 1.6 + 0.8)); // its legs
  root.add(sensor);
  // Rays around the LDR: the light falling on it.
  const rayMat = new THREE.LineBasicMaterial({ color: WARM, transparent: true, opacity: 0, depthWrite: false });
  const rays = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    rays.add(polyline([[Math.cos(a) * (R + 1), Math.sin(a) * (R + 1)], [Math.cos(a) * (R + 3), Math.sin(a) * (R + 3)]], 0, rayMat));
  }
  rays.position.set(ldrX, 0, 5.1);
  root.add(rays);
  // A generous pick target over the sensor end, so dragging and scrolling are easy to start.
  const pad = fillMesh(new THREE.PlaneGeometry(10, 14), BLUE, 0);
  pad.position.set(ldrX, 0, 5.2);
  root.add(pad);
  withLabel(root, input.label, -10.5);
  const wheel = wheelClicks();
  const glow = new THREE.Color();
  return {
    root,
    w: 24,
    h: 24,
    anchor: new THREE.Vector3(-10, 0, 0.8),
    targets: [top, pad],
    handles: [handleOf(root, 20, 14, 5)],
    grab(_hit, ray) {
      const start = input.level;
      return dragY(root, ray, 5.2, (dy) => input.set(start + dy / 25)); // ~25 mm from dark to sunlight
    },
    wheel: (_hit, dy) => {
      const n = wheel(dy);
      if (n) input.set(input.level + n * 0.025);
    },
    title: () => `${input.label}: drag up/down or scroll · ${input.lux()} lx`,
    update() {
      const l = input.level;
      // Dim blue in the dark, a warm glow in sunlight.
      const mat = top.material as THREE.MeshBasicMaterial;
      mat.color.copy(glow.setHex(BLUE).lerp(new THREE.Color(WARM), Math.min(1, l * 1.4)));
      mat.opacity = 0.06 + l * 0.8;
      rayMat.opacity = Math.max(0, l - 0.3) * 1.2;
      rays.scale.setScalar(0.8 + l * 0.5);
    },
  };
}

/** HC-SR501 PIR: a board with a faceted Fresnel dome. Press and hold the dome to move in front of it. */
function pirSensor(input: Pir): Peripheral {
  const root = new THREE.Group();
  root.add(block(32, 24, 1.6));
  // Square lens collar, then the dome.
  root.add(block(23, 23, 2.2, 1.6));
  const R = 11;
  const domeZ = 3.8;
  const domeGeo = () => new THREE.SphereGeometry(R, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  const dome = edges(domeGeo(), LINE_DIM, 10); // every facet edge: the Fresnel lens
  dome.position.z = domeZ;
  root.add(dome);
  for (const r of [R * 0.45, R * 0.8]) {
    // A couple of the lens rings, around the dome at their heights.
    const l = ring(r, domeZ + Math.sqrt(R * R - r * r) + 0.05, LINE);
    root.add(l);
  }
  const shell = fillMesh(domeGeo(), BLUE, 0.06);
  shell.position.z = domeZ;
  root.add(shell);
  // The three pins (VCC, OUT, GND) on the wire side.
  for (const y of [-2.54, 0, 2.54]) root.add(place(block(1, 1, 2, 0, LINE_DIM), -14.5, y, 1.6 + 1));
  withLabel(root, input.label, -15.5);
  let held = false;
  return {
    root,
    w: 36,
    h: 34,
    anchor: new THREE.Vector3(-16, 0, 0.8),
    targets: [shell],
    handles: [handleOf(root, 32, 24, 3.8)],
    grab() {
      held = true;
      input.setMoving(true);
      return {
        move: () => {},
        up: () => {
          held = false;
          input.setMoving(false);
        },
      };
    },
    title: () => `${input.label}: wave at it (press and hold) · ${input.motion() ? 'MOTION' : 'still'}`,
    update() {
      const on = input.motion();
      setFill(shell, on ? NOW : BLUE, on ? (held ? 0.45 : 0.3) : 0.06);
    },
  };
}

/**
 * DHT22: the white box with its vent grille, lying on its back, pins towards the wire. Drag or
 * scroll over the grille for temperature, over the plain band by the pins for humidity.
 */
function dht(input: Climate): Peripheral {
  const root = new THREE.Group();
  const L = 20; // body, along x; the mounting tab adds 5 mm
  const W = 15;
  const D = 7.7;
  root.add(place(block(L, W, D), -2.5, 0, D / 2));
  // Mounting tab with its hole, at the far end.
  root.add(place(block(5, 9, 1.4), L / 2, 0, 0.7));
  root.add(place(ring(1.4, 0), L / 2 + 0.3, 0, 1.45));
  // Pins out of the near end.
  for (const y of [-3.81, -1.27, 1.27, 3.81]) root.add(polyline([[-L / 2 - 2.5, y], [-L / 2 - 6, y]], 0.6));
  // The grille: rows of slots on the top face.
  const gx0 = -L / 2 - 2.5 + 7; // the plain band by the pins is 7 mm
  const gx1 = L / 2 - 2.5 - 1.5;
  const slots = 6;
  for (let i = 0; i < slots; i++) {
    const x = gx0 + 0.6 + ((i + 0.5) * (gx1 - gx0 - 1.2)) / slots;
    for (const y of [-3.6, 3.6]) root.add(place(block(1.1, 5, 0.1, 0, LINE_DIM), x, y, D + 0.05));
  }
  // Fills: the grille tints cold blue → warm rust with temperature, the band darkens with humidity.
  const grille = fillMesh(new THREE.PlaneGeometry(gx1 - gx0, W - 1.5));
  grille.position.set((gx0 + gx1) / 2, 0, D + 0.05);
  root.add(grille);
  const band = fillMesh(new THREE.PlaneGeometry(7 - 1, W - 1.5));
  band.position.set(-L / 2 - 2.5 + 3.5, 0, D + 0.05);
  root.add(band);
  root.add(place(polyline([[gx0, -W / 2], [gx0, W / 2]], 0, LINE_DIM), 0, 0, D + 0.02));
  withLabel(root, input.label, -W / 2 - 3);
  const wheelT = wheelClicks();
  const wheelH = wheelClicks();
  const halfStep = (c: number) => Math.round(c * 2) / 2;
  const readout = () => `${input.temperature.toFixed(1)} °C · ${Math.round(input.humidity)} %`;
  const tint = new THREE.Color();
  return {
    root,
    w: 32,
    h: 24,
    anchor: new THREE.Vector3(-L / 2 - 6, 0, 0.6),
    targets: [grille, band],
    handles: [handleOf(root, L + 5, W, D)],
    grab(hit, ray) {
      if (hit === band) {
        const start = input.humidity;
        return dragY(root, ray, D, (dy) => input.setHumidity(Math.round(start + dy * 2.5)));
      }
      const start = input.temperature;
      return dragY(root, ray, D, (dy) => input.setTemperature(halfStep(start + dy * 1.5)));
    },
    wheel(hit, dy) {
      if (hit === band) {
        const n = wheelH(dy);
        if (n) input.setHumidity(Math.round(input.humidity) + n);
      } else {
        const n = wheelT(dy);
        if (n) input.setTemperature(halfStep(input.temperature) + n * 0.5);
      }
    },
    title: (hit) => `${input.label}: ${readout()} · drag or scroll for ${hit === band ? 'humidity' : 'temperature'}`,
    update() {
      const f = (input.temperature - TEMP_RANGE[0]) / (TEMP_RANGE[1] - TEMP_RANGE[0]);
      const mat = grille.material as THREE.MeshBasicMaterial;
      mat.color.copy(tint.setHex(BLUE).lerp(new THREE.Color(NOW), f));
      mat.opacity = 0.06 + Math.abs(f - 0.5) * 0.5;
      setFill(band, BLUE, 0.03 + (input.humidity / 100) * 0.3);
    },
  };
}

/** A capacitive touch pad: a round copper pad on a small board. Press and hold to touch it. */
function touchPad(input: Touch): Peripheral {
  const root = new THREE.Group();
  root.add(block(20, 20, 1.6));
  const R = 7;
  root.add(ring(R, 1.65));
  root.add(ring(R + 1.2, 1.65, LINE_DIM)); // the keep-out around the copper
  const pad = disc(R, 1.7);
  root.add(pad);
  // Trace to the pin on the wire side.
  root.add(polyline([[-R - 1.2, 0], [-8.5, 0]], 1.65, LINE_DIM));
  root.add(place(block(1, 1, 2, 0, LINE_DIM), -9, 0, 1.6 + 1));
  withLabel(root, input.label, -13.5);
  return {
    root,
    w: 24,
    h: 28,
    anchor: new THREE.Vector3(-10, 0, 0.8),
    targets: [pad],
    handles: [handleOf(root, 20, 20, 1.6)],
    grab: () => {
      input.setDown(true);
      return { move: () => {}, up: () => input.setDown(false) };
    },
    title: () => `${input.label}: press and hold · touchRead ≈ ${input.touchRead()}`,
    update() {
      const down = input.isPressed();
      setFill(pad, down ? NOW : BLUE, down ? 0.85 : 0.1);
    },
  };
}

/**
 * The radar's target: a small round-headed character with an antenna. Walks (legs and arms swing,
 * body bobs) when it moves, turns to face where it's going, breathes, blinks and looks around when
 * it stands still. The antenna bulb and the ring at its feet show what the radar makes of it.
 */
function character() {
  const group = new THREE.Group();
  const PAPER = 0xf4f7f9;
  const INK = 0x11181c;
  const fill = (color = PAPER) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96 });
  // Cartoon outline: a slightly larger back-face shell in blue around each solid piece.
  const outlined = (geo: THREE.BufferGeometry, scale = 1.12, material = fill()) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, material));
    const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: BLUE, side: THREE.BackSide }));
    shell.scale.setScalar(scale);
    g.add(shell);
    return g;
  };
  const upright = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2); // capsule axis → +z

  const HEAD_Z = 11.9; // torso 4.3 + head 7.6: where you hold it
  const LIFT = 9; // how high it's carried
  const carry = new THREE.Group(); // lifted while held
  group.add(carry);
  const hang = new THREE.Group(); // pivot at the head: held, the body swings beneath it
  hang.position.z = HEAD_Z;
  carry.add(hang);
  const body = new THREE.Group(); // everything that turns to face the walking direction
  body.position.z = -HEAD_Z;
  hang.add(body);

  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.35, 0, 4.2);
    const leg = outlined(upright(new THREE.CapsuleGeometry(0.85, 2.2, 4, 10)), 1.18);
    leg.position.z = -2;
    pivot.add(leg);
    body.add(pivot);
    return pivot;
  });

  const torso = new THREE.Group();
  torso.position.z = 4.3;
  body.add(torso);
  const belly = outlined(upright(new THREE.CapsuleGeometry(2.4, 2.2, 6, 14)), 1.08);
  belly.position.z = 2.2;
  torso.add(belly);

  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.6, 0, 3.6);
    const arm = outlined(upright(new THREE.CapsuleGeometry(0.6, 1.8, 4, 8)), 1.2);
    arm.position.z = -1.4;
    arm.rotation.y = side * 0.25;
    pivot.add(arm);
    torso.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.z = 7.6;
  torso.add(head);
  head.add(outlined(new THREE.SphereGeometry(3.4, 20, 14), 1.07));
  // Eyes on the front (+y is "forward"), and two little cheeks.
  const eyes = [-1, 1].map((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshBasicMaterial({ color: INK }));
    eye.position.set(side * 1.25, 3.05, 0.5);
    head.add(eye);
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), new THREE.MeshBasicMaterial({ color: NOW, transparent: true, opacity: 0.35 }));
    cheek.position.set(side * 2.1, 2.75, -0.55);
    cheek.lookAt(cheek.position.clone().multiplyScalar(2));
    head.add(cheek);
    return eye;
  });
  const antenna = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 3.2), new THREE.Vector3(0.4, -0.3, 5.6)]),
    new THREE.LineBasicMaterial({ color: BLUE }),
  );
  head.add(antenna);
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: NOW });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 8), bulbMaterial);
  bulb.position.set(0.4, -0.3, 5.9);
  head.add(bulb);

  // Ring at its feet: the radar's verdict.
  const ringMaterial = new THREE.LineBasicMaterial({ color: NOW, transparent: true, opacity: 0.8 });
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 4.2, 4.2).getPoints(40)), ringMaterial);
  ring.position.z = 0.05;
  group.add(ring);

  // Generous invisible hit volume so it's easy to grab.
  // The handle: its head (a little larger than the head, so it's easy to catch). Transparent rather
  // than visible: false, which the raycaster would skip.
  const hit = new THREE.Mesh(new THREE.SphereGeometry(4.4, 12, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  head.add(hit);

  let held = false;
  let liftZ = 0;
  let liftV = 0;
  let squash = 0;
  // Held, the body is a lightly damped pendulum under the head: angles about x and y, their rates,
  // and a slow twist on the "rope". The hand's acceleration drives it.
  const swing = { x: 0, vx: 0, y: 0, vy: 0, twist: 0, vTwist: 0 };
  const handV = new THREE.Vector2();
  // Every so often a dangling character has a little wriggle: legs kick, arms flail.
  let kickUntil = 0;
  let nextKick = 0;
  const last = new THREE.Vector2(NaN, NaN);
  let speed = 0;
  let heading = 0;
  let phase = 0;
  let lastT = performance.now();
  let nextBlink = lastT + 2000;
  let blinkUntil = 0;
  let lookAt = 0;

  return {
    group,
    hit,
    /** Where its head is right now, above the floor, in the character's own units (lift included). */
    headZ: () => HEAD_Z + carry.position.z,
    setHeld(h: boolean) {
      held = h;
      if (h) {
        liftV = 40; // a little hop as it's picked up
        // …and the jolt sets it swinging.
        swing.vx += (Math.random() - 0.5) * 3;
        swing.vy += (Math.random() - 0.5) * 3;
        swing.vTwist += (Math.random() - 0.5) * 2;
        nextKick = performance.now() + 600 + Math.random() * 800;
      }
    },
    update(x: number, y: number, present: boolean, verdict: number) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      group.visible = present;
      if (Number.isNaN(last.x)) last.set(x, y);
      const dx = x - last.x;
      const dy = y - last.y;
      const v = Math.hypot(dx, dy) / Math.max(dt, 1e-3);
      speed += (v - speed) * Math.min(1, dt * 8);
      if (Math.hypot(dx, dy) > 0.05 && liftZ < 0.6) heading = Math.atan2(-dx, dy); // face the way it's walking
      last.set(x, y);
      group.position.set(x, y, 0);

      // Turn the short way towards the heading.
      let turn = heading - body.rotation.z;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      body.rotation.z += turn * Math.min(1, dt * 10);

      // Lift: a damped spring towards carrying height (or the floor), bouncing when dropped.
      const target = held ? LIFT : 0;
      liftV += ((target - liftZ) * 90 - liftV * (held ? 14 : 7)) * dt;
      liftZ += liftV * dt;
      if (!held && liftZ < 0) {
        if (liftV < -25) squash = Math.min(1, -liftV / 80); // landed with a thump
        liftZ = 0;
        liftV = -liftV * 0.35; // small bounce
      }
      squash = Math.max(0, squash - dt * 5);
      carry.position.z = liftZ;
      const airborne = liftZ > 0.6;

      // Swinging below the hand. The body (below the pivot) lags when the hand speeds up and swings
      // through when it stops: about x, a positive angle moves it towards +y; about y, towards −x.
      const vNow = new THREE.Vector2(dx, dy).divideScalar(Math.max(dt, 1e-3));
      const prevV = handV.clone();
      handV.lerp(vNow, Math.min(1, dt * 18)); // pointer moves come in steps; smooth before differentiating
      const ax = (handV.x - prevV.x) / Math.max(dt, 1e-3);
      const ay = (handV.y - prevV.y) / Math.max(dt, 1e-3);
      const kicking = airborne && now < kickUntil;
      if (airborne) {
        if (now > nextKick) {
          kickUntil = now + 500 + Math.random() * 500;
          nextKick = kickUntil + 1200 + Math.random() * 2200;
        }
        const W2 = 52; // ω² — a swing about every 0.9 s
        const DAMP = 1.5; // light: it sways a few times before settling
        const DRIVE = 0.07;
        const fidget = Math.sin(now / 430) * 0.6 + (kicking ? Math.sin(now / 70) * 4 : 0); // never quite still
        swing.vx += (-W2 * Math.sin(swing.x) - DAMP * swing.vx - ay * DRIVE + fidget) * dt;
        swing.vy += (-W2 * Math.sin(swing.y) - DAMP * swing.vy + ax * DRIVE + (kicking ? Math.cos(now / 90) * 3 : 0)) * dt;
        swing.vTwist += (-9 * swing.twist - 0.9 * swing.vTwist + (kicking ? Math.sin(now / 160) * 6 : 0)) * dt;
        swing.x = Math.max(-1.15, Math.min(1.15, swing.x + swing.vx * dt));
        swing.y = Math.max(-1.15, Math.min(1.15, swing.y + swing.vy * dt));
        swing.twist += swing.vTwist * dt;
      } else {
        // On its feet: straighten up.
        const k = Math.min(1, dt * 10);
        swing.x -= swing.x * k;
        swing.y -= swing.y * k;
        swing.twist -= swing.twist * k;
        swing.vx = swing.vy = swing.vTwist = 0;
      }
      hang.rotation.set(swing.x, swing.y, swing.twist);
      carry.scale.set(1 + squash * 0.12, 1 + squash * 0.12, 1 - squash * 0.22);

      const walking = !airborne && speed > 3; // mm/s on the desk
      phase += dt * (walking ? Math.min(14, 4 + speed * 0.25) : 0);
      const stride = walking ? Math.sin(phase) * 0.7 : 0;
      // Dangling: limbs hang loose, trail the swing and overshoot it (follow-through), drift out of
      // step with each other, and kick and flail during a wriggle.
      const dangle = airborne ? Math.min(1, liftZ / 6) : 0;
      const k = now / 1000;
      const kick = kicking ? 1 : 0;
      const trailX = -swing.vx * 0.16;
      const trailY = -swing.vy * 0.16;
      legs[0].rotation.x = stride + dangle * (Math.sin(k * 5.1) * 0.45 + trailX + kick * Math.sin(k * 15) * 0.75);
      legs[1].rotation.x = -stride + dangle * (Math.sin(k * 4.3 + 1.7) * 0.45 + trailX - kick * Math.sin(k * 15) * 0.75);
      legs[0].rotation.y = dangle * (-0.16 + trailY + Math.sin(k * 3.3) * 0.12); // splayed a little
      legs[1].rotation.y = dangle * (0.16 + trailY + Math.sin(k * 3.7 + 2) * 0.12);
      arms[0].rotation.x = -stride * 0.8 + dangle * (Math.sin(k * 3.7 + 0.6) * 0.45 + trailX * 1.3 + kick * Math.sin(k * 13 + 1) * 0.6);
      arms[1].rotation.x = stride * 0.8 + dangle * (Math.sin(k * 4.1 + 2.4) * 0.45 + trailX * 1.3 - kick * Math.sin(k * 13 + 1) * 0.6);
      // Arms out, like a held kitten, flapping wider during a wriggle.
      arms[0].rotation.y = -dangle * (0.65 + Math.sin(k * 2.3) * 0.2 + kick * (0.35 + Math.sin(k * 17) * 0.3) - trailY);
      arms[1].rotation.y = dangle * (0.65 + Math.sin(k * 2.9 + 1) * 0.2 + kick * (0.35 + Math.sin(k * 17 + 1.5) * 0.3) + trailY);
      torso.position.z = 4.3 + (walking ? Math.abs(Math.sin(phase)) * 0.7 : airborne ? 0 : Math.sin(now / 600) * 0.12);
      torso.scale.z = walking ? 1 : 1 + Math.sin(now / 600) * 0.025; // breathing

      // Idle: glance around now and then. Always: blink.
      if (!walking && Math.random() < dt * 0.3) lookAt = (Math.random() - 0.5) * 1.2;
      if (walking) lookAt = 0;
      head.rotation.z += (lookAt - head.rotation.z) * Math.min(1, dt * 4);
      // Held, it peers down at the floor; walking, it bobs.
      head.rotation.x = walking ? Math.sin(phase * 2) * 0.05 : -dangle * 0.22;
      if (now > nextBlink) {
        blinkUntil = now + 130;
        nextBlink = now + 2000 + Math.random() * 3000;
      }
      for (const e of eyes) e.scale.z = now < blinkUntil ? 0.15 : 1;
      bulb.position.z = 5.9 + Math.sin(now / 250) * (walking ? 0.25 : 0.08);

      bulbMaterial.color.setHex(verdict);
      ringMaterial.color.setHex(verdict);
      ringMaterial.opacity = verdict === MUTED ? 0.35 : 0.8;
      ring.scale.setScalar((walking ? 1 + Math.abs(Math.sin(phase)) * 0.08 : 1) * (1 - Math.min(0.35, liftZ * 0.03)));
    },
  };
}

// ---- the microcontroller ---------------------------------------------------------------------

/**
 * Dev boards that drive a bare module or an LED chain, as they lie on the desk (mm, approximated
 * from the makers' drawings): long side along x, USB at the left end, the module's antenna at the
 * right. `pins` per header row; `rowY`: the rows' distance from the centre line.
 */
const MCU: Record<string, { name: string; w: number; h: number; pins: number; rowY: number; module?: { w: number; h: number }; can: { w: number; h: number; x: number }; usb: { w: number; h: number; n: number } }> = {
  'esp32-s3-devkitc-1-n16r8': { name: 'ESP32-S3-DevKitC-1', w: 62.7, h: 25.4, pins: 22, rowY: 11.4, module: { w: 25.5, h: 18 }, can: { w: 17.6, h: 15.8, x: -2.6 }, usb: { w: 7.4, h: 9, n: 2 } },
  'esp32-devkitc': { name: 'ESP32-DevKitC', w: 54.4, h: 27.9, pins: 19, rowY: 12.7, module: { w: 25.5, h: 18 }, can: { w: 17.6, h: 15.8, x: -2.6 }, usb: { w: 5.8, h: 7.8, n: 1 } },
  'seeed-xiao-esp32s3': { name: 'XIAO ESP32S3', w: 21, h: 17.8, pins: 7, rowY: 7.6, can: { w: 12.5, h: 11, x: 2.4 }, usb: { w: 7.4, h: 9, n: 1 } },
};

/**
 * The microcontroller board between the parts and a bare module or LED chain: its PCB, the module's
 * shield can and antenna, the USB port and the pins along both long edges. Null for a board Bench
 * has no outline for (one with its own display is the device itself).
 */
export function microcontroller(boardId: string): Peripheral | null {
  const m = MCU[boardId];
  if (!m) return null;
  const root = new THREE.Group();
  const pcb = 1.6;
  root.add(block(m.w, m.h, pcb));
  // The module: its own PCB with the antenna past the shield can, overhanging the board's end.
  let canX = m.can.x;
  if (m.module) {
    const mx = m.w / 2 - m.module.w / 2 + 2;
    root.add(xy(block(m.module.w, m.module.h, 0.8, pcb), mx, 0));
    canX = mx + m.can.x;
  }
  root.add(xy(block(m.can.w, m.can.h, 2.4, pcb + (m.module ? 0.8 : 0)), canX, 0));
  // USB at the left end, sticking out a little.
  for (let i = 0; i < m.usb.n; i++) {
    const y = m.usb.n === 1 ? 0 : (i - (m.usb.n - 1) / 2) * (m.usb.h + 2.6);
    root.add(xy(block(m.usb.w, m.usb.h, 3.2, pcb), -m.w / 2 + m.usb.w / 2 - 1, y));
  }
  // A pad per pin along both long edges, 2.54 mm apart.
  const span = (m.pins - 1) * 2.54;
  for (const side of [-1, 1])
    for (let i = 0; i < m.pins; i++) root.add(xy(block(1.2, 1.2, 0.2, pcb, LINE_DIM), -span / 2 + i * 2.54, side * m.rowY));
  withLabel(root, m.name, -m.h / 2 - 4);
  const body = handle(m.w, m.h, 4, 0);
  root.add(body);
  return {
    root,
    w: m.w + 6,
    h: m.h + 10,
    body: { w: m.w, h: m.h },
    anchor: new THREE.Vector3(m.w / 2, 0, 0.8),
    targets: [],
    handles: [body],
    grab: () => null,
    title: () => m.name,
    update() {},
  };
}

/**
 * A part on the desk for every piece of hardware on the bench, except buttons the device itself
 * provides (`onDevice`) and the IMU, which is shown by tilting the device.
 */
export function buildPeripherals(hardware: SimInput[], onDevice: Set<SimInput>): Peripheral[] {
  const parts: Peripheral[] = [];
  const add = (p: Peripheral, input: SimInput) => parts.push({ ...p, input });
  for (const input of hardware) {
    switch (input.kind) {
      case 'button':
        if (!onDevice.has(input)) add(tactile(input as Button), input);
        break;
      case 'knob':
        add(encoder(input as Knob), input);
        break;
      case 'pot':
        add(slidePot(input as Pot), input);
        break;
      case 'buzzer':
        add(piezo(input as Buzzer), input);
        break;
      case 'ld2410':
        add(radar(input as LD2410), input);
        break;
      case 'light':
        add(ldr(input as LightSensor), input);
        break;
      case 'pir':
        add(pirSensor(input as Pir), input);
        break;
      case 'climate':
        add(dht(input as Climate), input);
        break;
      case 'touch':
        add(touchPad(input as Touch), input);
        break;
    }
  }
  return parts;
}

/** A wire's path on the desk; `bow` bends it sideways, out of the way of parts in between. */
export function wirePath(from: THREE.Vector3, to: THREE.Vector3, bow?: THREE.Vector3): THREE.CubicBezierCurve3 {
  const mid = from.clone().lerp(to, 0.5);
  return new THREE.CubicBezierCurve3(
    from,
    new THREE.Vector3(mid.x, from.y, from.z).add(bow ?? new THREE.Vector3()),
    new THREE.Vector3(mid.x, to.y, to.z).add(bow ?? new THREE.Vector3()),
    to,
  );
}

/** A dashed wire lying on the desk from a part back to the device (or its board). */
export function wire(from: THREE.Vector3, to: THREE.Vector3, bow?: THREE.Vector3): THREE.Line {
  const c = wirePath(from, to, bow);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(c.getPoints(40)),
    new THREE.LineDashedMaterial({ color: BLUE, dashSize: 1.6, gapSize: 1.4, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  line.computeLineDistances();
  return line;
}
