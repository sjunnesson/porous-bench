// The app was called screenSim; carry saved state (desk layouts, bindings, the Resident session)
// over to the new key prefix once. Storage may be unavailable (private mode), so failures are ignored.
const OLD = 'screensim:';
const NEW = 'bench:';

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
  } catch {
    /* nothing to carry over */
  }
}
