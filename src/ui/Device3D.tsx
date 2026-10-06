import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SimClock } from '../sim/clock';
import type { Button } from '../sim/inputs/button';
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
const PRESS_MM = 0.7;
const GAP = 16; // mm between the device and its parts, and between parts

/**
 * The device as a ghosted 3D wireframe with the live screen on it, plus the sketch's external
 * hardware (encoder, buttons, pot, buzzer, radar) on the desk beside it. Drag to orbit, double-click
 * to reset, shift-drag the device to tilt it when the sketch has an IMU.
 */
export function Device3D({ run, clock, mount, onCanvas }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mount);
  mountRef.current = mount;

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

    // pivot (orbit) → content (centred on everything) → tilt (IMU) → mount (setRotation) → model
    const mountGroup = new THREE.Group();
    mountGroup.add(model.group);
    const tiltGroup = new THREE.Group();
    tiltGroup.add(mountGroup);
    const content = new THREE.Group();
    content.add(tiltGroup);
    const pivot = new THREE.Group();
    pivot.add(content);
    scene.add(pivot);

    const inputs = Object.values(run.inputs);
    const buttonInputs = inputs.filter((i) => i.kind === 'button') as Button[];
    const imu = inputs.find((i) => i.kind === 'imu') as Imu | undefined;
    const onDevice = new Set(model.buttons.map((b) => b.input).filter((i): i is number => i !== undefined));
    const inputFor = (b: ModelButton) => (b.input === undefined ? undefined : buttonInputs[b.input]);

    // External parts on the desk, plus wires back to the device.
    const parts: Peripheral[] = buildPeripherals(inputs, onDevice);
    const desk = new THREE.Group();
    content.add(desk);
    for (const p of parts) desk.add(p.root);
    const wires = new THREE.Group();
    content.add(wires);

    const orbit = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
    let grab: Grab | null = null;
    let orbiting: { x: number; y: number } | null = null;
    let tilting: { x: number; y: number } | null = null;
    let pressed: ModelButton | null = null;
    let laidOutFor = -1;
    const fitSize = new THREE.Vector3(model.radius * 2, model.radius * 2, 0);
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

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

    /** Put the parts in columns to the right of the device as it is mounted, then centre it all. */
    const layout = (quarterTurns: number) => {
      const saved = mountGroup.rotation.z;
      mountGroup.rotation.z = (-quarterTurns * Math.PI) / 2;
      const savedTilt = tiltGroup.rotation.clone();
      tiltGroup.rotation.set(0, 0, 0);
      content.position.set(0, 0, 0);
      content.updateMatrixWorld(true);
      const dev = new THREE.Box3().setFromObject(model.group);
      mountGroup.rotation.z = saved;
      tiltGroup.rotation.copy(savedTilt);

      const colTop = dev.max.y;
      const colLimit = dev.min.y - (dev.max.y - dev.min.y) * 0.6;
      let x = dev.max.x + GAP + 10;
      let y = colTop;
      let colWidth = 0;
      for (const p of parts) {
        if (y - p.h < colLimit && y !== colTop) {
          x += colWidth + GAP;
          y = colTop;
          colWidth = 0;
        }
        p.root.position.set(x + p.w / 2, y - p.h / 2, dev.min.z);
        y -= p.h + GAP;
        colWidth = Math.max(colWidth, p.w);
      }

      wires.clear();
      const deskZ = dev.min.z + 0.4;
      content.updateMatrixWorld(true);
      parts.forEach((p, i) => {
        const from = content.worldToLocal(p.root.localToWorld(p.anchor.clone()));
        const to = new THREE.Vector3(dev.max.x - 1, dev.max.y - (dev.max.y - dev.min.y) * (0.3 + (0.4 * (i + 0.5)) / parts.length), deskZ);
        from.z = deskZ;
        wires.add(wire(from, to));
      });

      // Centre everything, so orbiting turns around the whole desk.
      content.updateMatrixWorld(true);
      const all = new THREE.Box3().setFromObject(content);
      const centre = all.getCenter(new THREE.Vector3());
      content.position.copy(centre).multiplyScalar(-1);
      all.getSize(fitSize);
      fit();
    };

    const ro = new ResizeObserver(fit);
    ro.observe(host);

    const setRay = (e: { clientX: number; clientY: number }) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };

    type Hit = { kind: 'button'; button: ModelButton } | { kind: 'part'; part: Peripheral; object: THREE.Object3D };
    const pick = (e: { clientX: number; clientY: number }): Hit | null => {
      setRay(e);
      const targets: THREE.Object3D[] = [...model.buttons.map((b) => b.mesh), ...parts.flatMap((p) => p.targets)];
      const [first] = ray.intersectObjects(targets, false);
      if (!first) return null;
      const button = model.buttons.find((b) => b.mesh === first.object);
      if (button) return { kind: 'button', button };
      const part = parts.find((p) => p.targets.includes(first.object));
      return part ? { kind: 'part', part, object: first.object } : null;
    };
    const overDevice = (e: { clientX: number; clientY: number }) => {
      setRay(e);
      const box = new THREE.Box3().setFromObject(model.group);
      return ray.ray.intersectsBox(box);
    };

    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      const hit = pick(e);
      if (hit?.kind === 'button') {
        const input = inputFor(hit.button);
        if (input) {
          pressed = hit.button;
          input.setDown(true);
          return;
        }
      }
      if (hit?.kind === 'part') {
        grab = hit.part.grab(hit.object, ray.ray);
        if (grab) return;
      }
      if (e.shiftKey && imu && overDevice(e)) tilting = { x: e.clientX, y: e.clientY };
      else orbiting = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
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
      const hit = pick(e);
      if (hit?.kind === 'button') {
        const input = inputFor(hit.button);
        el.style.cursor = input ? 'pointer' : 'grab';
        el.title = input ? `${hit.button.label}${input.key ? ` (${input.key.replace(/^Key/, '')})` : ''}` : `${hit.button.label} (not used by this sketch)`;
      } else if (hit?.kind === 'part') {
        el.style.cursor = 'pointer';
        el.title = hit.part.title(hit.object);
      } else {
        el.style.cursor = 'grab';
        el.title = imu ? 'Drag to orbit · shift-drag the device to tilt it · double-click to reset' : 'Drag to orbit · double-click to reset';
      }
    };
    const onUp = () => {
      if (pressed) inputFor(pressed)?.setDown(false);
      grab?.up();
      pressed = null;
      grab = null;
      orbiting = null;
      tilting = null;
    };
    const onDbl = () => {
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
      pivot.rotation.set(BASE.pitch + orbit.pitch, BASE.yaw + orbit.yaw, 0, 'YXZ');
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
  }, [run, clock, onCanvas]);

  return <div ref={hostRef} className="device-3d" />;
}
