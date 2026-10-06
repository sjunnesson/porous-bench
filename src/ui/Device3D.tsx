import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { SimClock } from '../sim/clock';
import type { Imu } from '../sim/inputs/imu';
import type { SketchRun } from '../sim/runner';
import { buildModel, type ModelButton } from './three/model';
import { buildPeripherals, type Grab, type Peripheral, wire } from './three/peripherals';

interface Props {
  run: SketchRun;
  clock: SimClock;
  /** Quarter turns clockwise: how the module is mounted. */
  mount: () => number;
  onCanvas?(c: HTMLCanvasElement | null): void;
}

const BASE = { pitch: -0.32, yaw: 0.42 };
// With the radar's character on the desk, look across the desk rather than down on it, so it's
// seen standing up.
const BASE_DIORAMA = { pitch: -0.85, yaw: 0.3 };
const PRESS_MM = 0.7;
const GAP = 16; // mm between the device and its parts, and between parts

type Pos = { x: number; y: number };

/** Where the user put things on the desk, per device and sketch. */
function loadDesk(key: string): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Pos>;
  } catch {
    return {};
  }
}
function saveDesk(key: string, desk: Record<string, Pos>) {
  try {
    localStorage.setItem(key, JSON.stringify(desk));
  } catch {
    /* not persisted */
  }
}

/** Nearest point on the outline of an axis-aligned rectangle (xy) to p. */
function nearestOnRect(p: THREE.Vector3, box: THREE.Box3): THREE.Vector3 {
  const x = Math.max(box.min.x, Math.min(box.max.x, p.x));
  const y = Math.max(box.min.y, Math.min(box.max.y, p.y));
  if (x !== p.x || y !== p.y) return new THREE.Vector3(x, y, p.z);
  // Inside the rectangle: go to the closest edge.
  const d = [p.x - box.min.x, box.max.x - p.x, p.y - box.min.y, box.max.y - p.y];
  const i = d.indexOf(Math.min(...d));
  return new THREE.Vector3(i === 0 ? box.min.x : i === 1 ? box.max.x : p.x, i === 2 ? box.min.y : i === 3 ? box.max.y : p.y, p.z);
}

/**
 * The device as a ghosted 3D wireframe with the live screen on it, plus the sketch's external
 * hardware on the desk beside it, wired back with dashed lines. Everything sits on one desk plane.
 *
 * Mouse: drag empty space to orbit (double-click to reset); press a button, knob, pot or the radar
 * to use it; drag the body of the device or of a part to slide it across the desk (⌥ Option-drag
 * moves anything; double-click it to put it back); shift-drag the device to tilt it when the sketch
 * has an IMU.
 */
export function Device3D({ run, clock, mount, onCanvas }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mount);
  mountRef.current = mount;
  // Swapping hardware rebuilds the scene; the orbit survives it.
  const benchVersion = useSyncExternalStore(run.bench.subscribe, run.bench.getVersion);
  const orbitRef = useRef({ yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 });

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    onCanvas?.(renderer.domElement);

    const { device } = run;
    const native = document.createElement('canvas');
    native.width = device.width;
    native.height = device.height;
    const nctx = native.getContext('2d')!;
    const image = new ImageData(device.width, device.height);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 1, 8000);
    const model = buildModel(device, native);

    // The device's body, to grab it by: everything but its buttons (those get pressed).
    const bodyBox = new THREE.Box3();
    model.group.updateMatrixWorld(true);
    for (const child of model.group.children) {
      if (!model.buttons.some((b) => b.mesh === child)) bodyBox.expandByObject(child);
    }
    const deviceHandle = new THREE.Mesh(
      new THREE.BoxGeometry(...bodyBox.getSize(new THREE.Vector3()).toArray()),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    bodyBox.getCenter(deviceHandle.position);
    model.group.add(deviceHandle);

    // pivot (orbit) → content (centred on the desk) → deskGroup (where the device sits on the desk)
    // → tilt (IMU) → mount (setRotation) → model
    const mountGroup = new THREE.Group();
    mountGroup.add(model.group);
    const tiltGroup = new THREE.Group();
    tiltGroup.add(mountGroup);
    const deskGroup = new THREE.Group();
    deskGroup.add(tiltGroup);
    const content = new THREE.Group();
    content.add(deskGroup);
    const pivot = new THREE.Group();
    pivot.add(content);
    scene.add(pivot);

    const hardware = run.bench.parts();
    const imu = hardware.find((i) => i.kind === 'imu') as Imu | undefined;
    // The device's n-th physical button presses the sketch's n-th button-like input (a button, or a
    // trigger whose hardware is a push button).
    const pressables = run.pressables();
    const inputFor = (b: ModelButton) => (b.input === undefined ? undefined : pressables[b.input]?.button);
    const onDevice = new Set(model.buttons.map(inputFor).filter((b) => b !== undefined));

    // External parts on the desk, plus wires back to the device.
    const parts: Peripheral[] = buildPeripherals(hardware, onDevice);
    const partKeys = parts.map((p, i) => {
      const key = `${p.input?.kind ?? 'part'}:${p.input?.label ?? i}`;
      return parts.slice(0, i).some((q) => `${q.input?.kind ?? 'part'}:${q.input?.label}` === key) ? `${key}:${i}` : key;
    });
    const desk = new THREE.Group();
    content.add(desk);
    for (const p of parts) desk.add(p.root);
    const wires = new THREE.Group();
    content.add(wires);
    const base = hardware.some((h) => h.kind === 'ld2410') ? BASE_DIORAMA : BASE;

    const deskKey = `screensim:desk:${device.id}:${run.sketch.name}`;
    const placed = loadDesk(deskKey);

    const orbit = orbitRef.current;
    let grab: Grab | null = null;
    let orbiting: { x: number; y: number } | null = null;
    let tilting: { x: number; y: number } | null = null;
    let moving: { key: string; obj: THREE.Object3D; start: THREE.Vector3; from: THREE.Vector3 } | null = null;
    let pressed: ModelButton | null = null;
    let laidOutFor = -1;
    let framed = false;
    const fitSize = new THREE.Vector3(model.radius * 2, model.radius * 2, 0);
    const devBox = new THREE.Box3(); // device footprint relative to deskGroup, as currently mounted
    let deskZ = 0; // the desk plane everything stands on and slides along
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = renderer.domElement;

    const fit = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Fit the desk's width and height (with room for the default tilt), not a bounding sphere,
      // so a wide row of parts still fills the stage.
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.max(fitSize.y / 2 / tan, fitSize.x / 2 / (tan * camera.aspect)) * 1.3 + fitSize.z;
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };

    /** Redraw every wire, from its part to the nearest edge of the device. */
    const updateWires = () => {
      wires.children.forEach((w) => (w as THREE.Line).geometry.dispose());
      wires.clear();
      content.updateMatrixWorld(true);
      const dev = devBox.clone().translate(deskGroup.position);
      for (const p of parts) {
        const from = content.worldToLocal(p.root.localToWorld(p.anchor.clone()));
        from.z = deskZ;
        wires.add(wire(from, nearestOnRect(from, dev)));
      }
    };

    /**
     * Place the device and parts: where the user put them, otherwise the device at the origin and
     * the parts flowing in columns to its right. Frames the camera the first time.
     */
    const layout = (quarterTurns: number) => {
      // Measure in desk coordinates: level the orbit pivot while measuring, then restore it.
      const savedPivot = pivot.rotation.clone();
      pivot.rotation.set(0, 0, 0);
      const savedRot = mountGroup.rotation.z;
      const savedTilt = tiltGroup.rotation.clone();
      mountGroup.rotation.z = (-quarterTurns * Math.PI) / 2;
      tiltGroup.rotation.set(0, 0, 0);
      deskGroup.position.set(0, 0, 0);
      const savedContent = content.position.clone();
      content.position.set(0, 0, 0);
      content.updateMatrixWorld(true);
      devBox.setFromObject(model.group);
      mountGroup.rotation.z = savedRot;
      tiltGroup.rotation.copy(savedTilt);
      content.position.copy(savedContent);
      deskZ = devBox.min.z;

      const dp = placed.device ?? { x: 0, y: 0 };
      deskGroup.position.set(dp.x, dp.y, 0);

      // Auto flow, relative to wherever the device is.
      const colTop = devBox.max.y + dp.y;
      const colLimit = devBox.min.y + dp.y - (devBox.max.y - devBox.min.y) * 0.6;
      let x = devBox.max.x + dp.x + GAP + 10;
      let y = colTop;
      let colWidth = 0;
      parts.forEach((p, i) => {
        const manual = placed[partKeys[i]];
        if (manual) {
          p.root.position.set(manual.x, manual.y, deskZ);
          return;
        }
        if (y - p.h < colLimit && y !== colTop) {
          x += colWidth + GAP;
          y = colTop;
          colWidth = 0;
        }
        p.root.position.set(x + p.w / 2, y - p.h / 2, deskZ);
        y -= p.h + GAP;
        colWidth = Math.max(colWidth, p.w);
      });
      updateWires();

      if (!framed) {
        // Centre everything once, so orbiting turns around the whole desk; later moves don't jump it.
        framed = true;
        content.position.set(0, 0, 0);
        content.updateMatrixWorld(true);
        const all = new THREE.Box3().setFromObject(content);
        content.position.copy(all.getCenter(new THREE.Vector3())).multiplyScalar(-1);
        all.getSize(fitSize);
        fit();
      }
      pivot.rotation.copy(savedPivot);
    };

    const ro = new ResizeObserver(fit);
    ro.observe(host);

    const setRay = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };

    /** Where the pointer ray meets the desk plane, in content coordinates. */
    const onDesk = (): THREE.Vector3 | null => {
      content.updateMatrixWorld(true);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(content.matrixWorld);
      const p = content.localToWorld(new THREE.Vector3(0, 0, deskZ));
      const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, p), new THREE.Vector3());
      return hit ? content.worldToLocal(hit) : null;
    };

    type Hit =
      | { kind: 'button'; button: ModelButton }
      | { kind: 'part'; part: Peripheral; object: THREE.Object3D }
      | { kind: 'move'; key: string; obj: THREE.Object3D };
    /** What's under the pointer. With `moveAnything`, whatever is hit resolves to moving its owner. */
    const pick = (e: { clientX: number; clientY: number }, moveAnything = false): Hit | null => {
      setRay(e);
      const targets: THREE.Object3D[] = [
        ...model.buttons.map((b) => b.mesh),
        ...parts.flatMap((p) => [...p.targets, ...p.handles]),
        deviceHandle,
      ];
      const [first] = ray.intersectObjects(targets, false);
      if (!first) return null;
      const o = first.object;
      const button = model.buttons.find((b) => b.mesh === o);
      if (button || o === deviceHandle) {
        if (moveAnything || !button) return { kind: 'move', key: 'device', obj: deskGroup };
        return { kind: 'button', button };
      }
      const i = parts.findIndex((p) => p.targets.includes(o) || p.handles.includes(o));
      if (i < 0) return null;
      if (moveAnything || parts[i].handles.includes(o)) return { kind: 'move', key: partKeys[i], obj: parts[i].root };
      return { kind: 'part', part: parts[i], object: o };
    };

    const startMove = (key: string, obj: THREE.Object3D): boolean => {
      const start = onDesk();
      if (!start) return false;
      moving = { key, obj, start, from: obj.position.clone() };
      el.style.cursor = 'grabbing';
      return true;
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      const hit = pick(e, e.altKey);
      if (hit?.kind === 'button') {
        const input = inputFor(hit.button);
        if (input) {
          pressed = hit.button;
          input.setDown(true);
          return;
        }
        // A button the sketch doesn't use is just part of the body.
        if (startMove('device', deskGroup)) return;
      }
      if (hit?.kind === 'part') {
        grab = hit.part.grab(hit.object, ray.ray);
        if (grab) {
          el.style.cursor = 'grabbing';
          return;
        }
        // Nothing to operate there (the buzzer's disc): move the part instead.
        const i = parts.indexOf(hit.part);
        if (startMove(partKeys[i], hit.part.root)) return;
      }
      if (hit?.kind === 'move') {
        if (e.shiftKey && imu && hit.key === 'device') tilting = { x: e.clientX, y: e.clientY };
        else startMove(hit.key, hit.obj);
        return;
      }
      orbiting = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (moving) {
        setRay(e);
        const p = onDesk();
        if (p) {
          moving.obj.position.x = moving.from.x + (p.x - moving.start.x);
          moving.obj.position.y = moving.from.y + (p.y - moving.start.y);
          updateWires();
        }
        return;
      }
      if (grab) {
        setRay(e);
        grab.move(ray.ray);
        return;
      }
      if (tilting && imu) {
        const t = imu.getTilt();
        imu.setTilt(t.x + (e.clientX - tilting.x) * 0.006, t.y + (e.clientY - tilting.y) * 0.006);
        tilting = { x: e.clientX, y: e.clientY };
        return;
      }
      if (orbiting) {
        orbit.tYaw += (e.clientX - orbiting.x) * 0.008;
        orbit.tPitch = Math.max(-1.3, Math.min(1.3, orbit.tPitch + (e.clientY - orbiting.y) * 0.008));
        orbiting = { x: e.clientX, y: e.clientY };
        return;
      }
      const hit = pick(e, e.altKey);
      if (hit?.kind === 'button') {
        const input = inputFor(hit.button);
        const mapped = hit.button.input === undefined ? undefined : pressables[hit.button.input]?.input;
        el.style.cursor = input ? 'pointer' : 'move';
        el.title = input
          ? `${hit.button.label}${input.key ? ` (${input.key.replace(/^Key/, '')})` : ''}`
          : mapped
            ? `${hit.button.label}: "${mapped.label}" is on other hardware right now`
            : `${hit.button.label} (not used by this sketch)`;
      } else if (hit?.kind === 'part') {
        el.style.cursor = 'pointer';
        el.title = hit.part.title(hit.object);
      } else if (hit?.kind === 'move') {
        el.style.cursor = 'move';
        el.title =
          hit.key === 'device'
            ? `Drag to slide the device across the desk${imu ? ' · shift-drag to tilt it' : ''} · double-click to put it back`
            : 'Drag to slide it across the desk · double-click to put it back';
      } else {
        el.style.cursor = 'grab';
        el.title = 'Drag to orbit · double-click to reset the view · ⌥ Option-drag moves anything';
      }
    };
    const onUp = () => {
      if (moving) {
        placed[moving.key] = { x: moving.obj.position.x, y: moving.obj.position.y };
        saveDesk(deskKey, placed);
        moving = null;
      }
      if (pressed) inputFor(pressed)?.setDown(false);
      grab?.up();
      pressed = null;
      grab = null;
      orbiting = null;
      tilting = null;
    };
    const onDbl = (e: MouseEvent) => {
      const hit = pick(e, true);
      if (hit?.kind === 'move' && placed[hit.key]) {
        // Put it back where the automatic layout wants it.
        delete placed[hit.key];
        saveDesk(deskKey, placed);
        laidOutFor = -1;
        return;
      }
      orbit.tYaw = 0;
      orbit.tPitch = 0;
    };
    const onWheel = (e: WheelEvent) => {
      const hit = pick(e);
      if (hit?.kind === 'part' && hit.part.wheel) {
        e.preventDefault();
        hit.part.wheel(hit.object, e.deltaY);
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    let first = true;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const quarter = ((mountRef.current() % 4) + 4) % 4;
      if (quarter !== laidOutFor) {
        laidOutFor = quarter;
        layout(quarter);
      }

      run.display.panel.render(clock.now(), image.data);
      nctx.putImageData(image, 0, 0);
      model.texture.needsUpdate = true;

      // Buttons on the device follow their inputs (mouse or keyboard).
      for (const b of model.buttons) {
        const down = !!inputFor(b)?.isPressed();
        b.mesh.position.copy(b.rest).addScaledVector(b.normal, down ? -PRESS_MM : 0);
        (b.mesh.material as THREE.MeshBasicMaterial).color.copy(b.color).multiplyScalar(down ? 1.25 : 1);
      }
      for (const p of parts) p.update();

      // The IMU tilts the device: right on the tilt pad lowers its right edge, down lowers the bottom.
      if (imu) {
        const t = imu.getTilt();
        const tx = Math.asin(Math.max(-1, Math.min(1, t.x))) * 0.75;
        const ty = Math.asin(Math.max(-1, Math.min(1, t.y))) * 0.75;
        tiltGroup.rotation.y += (tx - tiltGroup.rotation.y) * 0.25;
        tiltGroup.rotation.x += (ty - tiltGroup.rotation.x) * 0.25;
        const s = imu.isShaking() ? 1.8 : 0;
        const k = performance.now() / 1000;
        tiltGroup.position.set(Math.sin(k * 57) * s, Math.sin(k * 43 + 1) * s * 0.6, 0);
      }

      orbit.yaw += (orbit.tYaw - orbit.yaw) * 0.18;
      orbit.pitch += (orbit.tPitch - orbit.pitch) * 0.18;
      pivot.rotation.set(base.pitch + orbit.pitch, base.yaw + orbit.yaw, 0, 'YXZ');
      const target = (-quarter * Math.PI) / 2;
      let diff = target - mountGroup.rotation.z;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // turn the short way
      mountGroup.rotation.z += first ? diff : diff * 0.2;
      first = false;
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('wheel', onWheel);
      onUp();
      model.dispose();
      deviceHandle.geometry.dispose();
      desk.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.MeshBasicMaterial).map?.dispose();
        }
      });
      wires.traverse((o) => o instanceof THREE.Line && o.geometry.dispose());
      renderer.dispose();
      el.remove();
      onCanvas?.(null);
    };
  }, [run, clock, onCanvas, benchVersion]);

  return <div ref={hostRef} className="device-3d" />;
}
