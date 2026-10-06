import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { SimClock } from '../sim/clock';
import type { SimInput } from '../sim/inputs/input';

/** useState that survives reloads. Storage may be unavailable (private mode), so failures are ignored. */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `screensim:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* not persisted */
    }
  }, [storageKey, value]);
  return [value, setValue];
}

/** Re-render when an input changes. */
export function useInput(input: SimInput): number {
  return useSyncExternalStore(input.subscribe, input.getVersion);
}

/** Re-render when the clock is paused/resumed or its speed changes. */
export function useClockState(clock: SimClock): { paused: boolean; speed: number } {
  const subscribe = useCallback((fn: () => void) => clock.onChange(fn), [clock]);
  const paused = useSyncExternalStore(subscribe, () => clock.paused);
  const speed = useSyncExternalStore(subscribe, () => clock.speed);
  return { paused, speed };
}

/** Calls `fn` on every animation frame while mounted. */
export function useAnimationFrame(fn: () => void): void {
  useEffect(() => {
    let id = 0;
    const tick = () => {
      fn();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [fn]);
}
