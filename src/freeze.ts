// Bench starts on the app it last ran, so an app that freezes the page would freeze it again on
// every reload. (Lua stops a runaway loop, but one call that never returns, like a pathological
// string.find, can't be stopped from the page's own thread.) So the running app is noted here while
// the page is in front, and a page put away normally (reloaded, closed, switched away from) clears
// the note. Still there on load: the page froze, and Bench starts on its own app instead.
const KEY = 'bench:running';
let current: string | null = null;

function write() {
  try {
    if (current && document.visibilityState === 'visible') localStorage.setItem(KEY, current);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: no guard */
  }
}

/** The app running now (null: none). */
export function noteRunning(id: string | null): void {
  current = id;
  write();
}

/**
 * Call once before the first render. If the page froze while the app it would start on was running,
 * points it at `fallback` instead and returns the frozen app's id.
 */
export function recoverFromFreeze(fallback: string): string | null {
  addEventListener('visibilitychange', write);
  addEventListener('pageshow', write);
  addEventListener('pagehide', () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  });
  try {
    const id = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!id || id === fallback || localStorage.getItem('bench:sketch') !== JSON.stringify(id)) return null;
    localStorage.setItem('bench:sketch', JSON.stringify(fallback));
    return id;
  } catch {
    return null;
  }
}
