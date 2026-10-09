// The app was called screenSim; carry saved state (desk layouts, bindings, the Resident session)
// over to the new key prefix once, and drop what Bench no longer reads. Storage may be unavailable
// (private mode), so failures are ignored.
const OLD = 'screensim:';
const NEW = 'bench:';

/** Keys Bench once wrote and no longer reads: desks kept per device and app (now per device), and
 *  the sidebar panels before they were Output, Inputs and Connections. */
const STALE = /^bench:(desk:[^:]+:.+|panel:(hardware|parts|controls|display))$/;

export function migrateStorage(): void {
  try {
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(OLD)) old.push(k);
    }
    for (const k of old) {
      const to = NEW + k.slice(OLD.length);
      if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k)!);
      localStorage.removeItem(k);
    }
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && STALE.test(k)) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    /* nothing to carry over */
  }
}
