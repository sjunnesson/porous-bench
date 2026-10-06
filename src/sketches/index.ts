import type { Sketch, InputSpecs } from '../sim/sketch';

export interface RegisteredSketch {
  id: string;
  sketch: Sketch<InputSpecs>;
}

// Every other .ts file in this folder is a sketch (default export from defineSketch).
const modules = import.meta.glob<{ default: Sketch<InputSpecs> }>(['./*.ts', '!./index.ts'], { eager: true });

export const sketches: RegisteredSketch[] = Object.entries(modules)
  .map(([path, m]) => ({ id: path.replace(/^\.\/|\.ts$/g, ''), sketch: m.default }))
  .sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));

function order(id: string) {
  const i = ['hello', 'patterns', 'characters', 'radar', 'knob-menu'].indexOf(id);
  return i < 0 ? 99 : i;
}

export const SKETCHES_UPDATED = 'bench:sketches-updated';

// Editing a sketch file hot-swaps it: the app restarts that sketch without a page reload.
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (mod) window.dispatchEvent(new CustomEvent(SKETCHES_UPDATED, { detail: mod.sketches }));
  });
}
