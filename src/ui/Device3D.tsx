import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SimClock } from '../sim/clock';
import type { Button } from '../sim/inputs/button';
import type { SketchRun } from '../sim/runner';
import { buildModel, type ModelButton } from './three/model';

interface Props {
  run: SketchRun;
  clock: SimClock;
  /** Quarter turns clockwise: how the module is mounted. */
  mount: () => number;
  onCanvas?(c: HTMLCanvasElement | null): void;
}

const BASE = { pitch: -0.32, yaw: 0.42 };
const PRESS_MM = 0.7;

/** The device as a ghosted 3D wireframe with the live screen on it. Drag to orbit, double-click to reset. */
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
    const camera = new THREE.PerspectiveCamera(26, 1, 1, 5000);
    const model = buildModel(device, native);
    const mountGroup = new THREE.Group();
    mountGroup.add(model.group);
    const pivot = new THREE.Group();
    pivot.add(mountGroup);
    scene.add(pivot);

    // The n-th button the sketch declares, for clickable caps.
    const buttonInputs = Object.values(run.inputs).filter((i) => i.kind === 'button') as Button[];
    const inputFor = (b: ModelButton) => (b.input === undefined ? undefined : buttonInputs[b.input]);

    const orbit = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
    let dragging: { x: number; y: number } | null = null;
    let pressed: ModelButton | null = null;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      const fov = (camera.fov * Math.PI) / 180;
      const fit = Math.min(1, camera.aspect);
      camera.position.set(0, 0, (model.radius / Math.sin(fov / 2) / fit) * 1.15);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const hit = (e: PointerEvent): ModelButton | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(model.buttons.map((b) => b.mesh), false);
      return hits.length ? (model.buttons.find((b) => b.mesh === hits[0].object) ?? null) : null;
    };

    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      const b = hit(e);
      const input = b && inputFor(b);
      if (b && input) {
        pressed = b;
        input.setDown(true);
      } else dragging = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        orbit.tYaw += (e.clientX - dragging.x) * 0.008;
        orbit.tPitch = Math.max(-1.3, Math.min(1.3, orbit.tPitch + (e.clientY - dragging.y) * 0.008));
        dragging = { x: e.clientX, y: e.clientY };
        return;
      }
      const b = hit(e);
      const input = b && inputFor(b);
      el.style.cursor = input ? 'pointer' : 'grab';
      el.title = b ? (input ? `${b.label}${input.key ? ` (${input.key.replace(/^Key/, '')})` : ''}` : `${b.label} (not used by this sketch)`) : '';
    };
    const onUp = () => {
      if (pressed) inputFor(pressed)?.setDown(false);
      pressed = null;
      dragging = null;
    };
    const onDbl = () => {
      orbit.tYaw = 0;
      orbit.tPitch = 0;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);

    let raf = 0;
    let first = true;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      run.display.panel.render(clock.now(), image.data);
      nctx.putImageData(image, 0, 0);
      model.texture.needsUpdate = true;

      // Buttons follow their inputs (mouse or keyboard).
      for (const b of model.buttons) {
        const down = !!inputFor(b)?.isPressed();
        b.mesh.position.copy(b.rest).addScaledVector(b.normal, down ? -PRESS_MM : 0);
        (b.mesh.material as THREE.MeshBasicMaterial).color.copy(b.color).multiplyScalar(down ? 1.25 : 1);
      }

      orbit.yaw += (orbit.tYaw - orbit.yaw) * 0.18;
      orbit.pitch += (orbit.tPitch - orbit.pitch) * 0.18;
      pivot.rotation.set(BASE.pitch + orbit.pitch, BASE.yaw + orbit.yaw, 0, 'YXZ');
      const target = (-mountRef.current() * Math.PI) / 2;
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
      onUp();
      model.dispose();
      renderer.dispose();
      el.remove();
      onCanvas?.(null);
    };
  }, [run, clock, onCanvas]);

  return <div ref={hostRef} className="device-3d" />;
}
