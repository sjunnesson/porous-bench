// The sketch's external hardware as parts on the desk next to the device, drawn in the same ghosted
// linework: a rotary encoder, tactile buttons, a slide pot, a piezo buzzer and an LD2410 radar with
// its detection fan. Each one is live: it shows its input's state and you can work it with the mouse.
// Units are mm; the desk is the xy plane and +z points up out of it, towards the viewer.

import * as THREE from 'three';
import type { Button } from '../../sim/inputs/button';
import type { Buzzer } from '../../sim/inputs/buzzer';
import type { SimInput } from '../../sim/inputs/input';
import type { Knob } from '../../sim/inputs/knob';
import { FOV_DEG, type LD2410, MAX_RANGE_M } from '../../sim/inputs/ld2410';
import type { Pot } from '../../sim/inputs/pot';

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
  /** Raycast targets. */
  targets: THREE.Object3D[];
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

function place<T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T {
  obj.position.set(x, y, z);
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
  for (const [x, y] of [[-6.5, 6.5], [6.5, 6.5], [-6.5, -6.5], [6.5, -6.5]]) root.add(place(cylinder(0.7, 0.2, 0, false, LINE_DIM), x, y, 1.7));
  withLabel(root, input.label, -12.5);
  return {
    root,
    w: 22,
    h: 26,
    anchor: new THREE.Vector3(-9, 0, 0.8),
    targets: [fill],
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
  for (let i = 0; i < 5; i++) root.add(place(block(0.64, 0.64, 6, 0, LINE_DIM), 11.5, -5.08 + i * 2.54, 1.6 + 3));
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
  module.add(block(35, 7, 1, 0));
  for (let i = 0; i < 4; i++) module.add(place(block(3.2, 3.2, 0.1, 0, LINE_DIM), -9 + i * 6, 0, 1.05));
  const out = disc(0.9, 1.1);
  out.position.x = 14;
  module.add(out);
  module.position.y = -4;
  root.add(module);

  // The person: a little standing figure.
  const person = new THREE.Group();
  const body = cylinder(2.2, 13, 0, false);
  const head = edges(new THREE.SphereGeometry(2.4, 12, 8));
  head.position.z = 16;
  const bodyFill = fillMesh(new THREE.CircleGeometry(2.2, 24), NOW, 0.6);
  bodyFill.position.z = 13.05;
  person.add(body, head, bodyFill);
  root.add(person);

  withLabel(root, input.label, -10.5);
  const move = (ray: THREE.Ray) => {
    const p = onPlane(root, ray, 0);
    if (p) input.movePerson(p.x / scale, Math.max(0.15, p.y / scale));
  };
  return {
    root,
    w: 2 * Math.sin(half) * R + 6,
    h: R + 18,
    anchor: new THREE.Vector3(-17.5, -4, 0.5),
    targets: [area],
    grab(_hit, ray) {
      move(ray);
      return { move, up() {} };
    },
    title: () => `${input.label}: drag the person · ${input.mode}`,
    update() {
      const t = input.target();
      const st = input.latest().report.state;
      person.position.set(t.x * scale, t.y * scale, 0);
      person.visible = t.present;
      const color = st & 1 ? NOW : st & 2 ? BLUE : MUTED;
      setFill(bodyFill, color, 0.75);
      body.material = st ? LINE : LINE_DIM;
      setFill(out, st ? NOW : BLUE, st ? 0.9 : 0.15);
    },
  };
}

/**
 * Parts for every input the device itself doesn't provide. Buttons the enclosure already has
 * (by index) stay on the device; the IMU is shown by tilting the device rather than as a part.
 */
export function buildPeripherals(inputs: SimInput[], onDeviceButtons: Set<number>): Peripheral[] {
  const parts: Peripheral[] = [];
  let buttonIndex = 0;
  for (const input of inputs) {
    switch (input.kind) {
      case 'button':
        if (!onDeviceButtons.has(buttonIndex)) parts.push(tactile(input as Button));
        buttonIndex++;
        break;
      case 'knob':
        parts.push(encoder(input as Knob));
        break;
      case 'pot':
        parts.push(slidePot(input as Pot));
        break;
      case 'buzzer':
        parts.push(piezo(input as Buzzer));
        break;
      case 'ld2410':
        parts.push(radar(input as LD2410));
        break;
    }
  }
  return parts;
}

/** A dashed wire lying on the desk from a part back to the device. */
export function wire(from: THREE.Vector3, to: THREE.Vector3): THREE.Line {
  const mid = from.clone().lerp(to, 0.5);
  const c = new THREE.CubicBezierCurve3(
    from,
    new THREE.Vector3(mid.x, from.y, from.z),
    new THREE.Vector3(mid.x, to.y, to.z),
    to,
  );
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(c.getPoints(40)),
    new THREE.LineDashedMaterial({ color: BLUE, dashSize: 1.6, gapSize: 1.4, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  line.computeLineDistances();
  return line;
}
