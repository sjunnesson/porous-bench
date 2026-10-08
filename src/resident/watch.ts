// Watch a folder on this computer for Lua apps: whenever a .lua file in it is saved, Bench runs it.
// The way to get an app from Claude Code (or any editor) onto Bench with no network in between: the
// agent writes a file, Bench reads it. Uses Chromium's File System Access API (Chrome, Edge, Opera);
// the folder is remembered, and after a reload one click picks it up again. With edit access, Bench
// also writes its device skill into the folder, so the agent working there reads the one this Bench
// was built with; someone who refuses edit access can watch the folder read-only instead.

import SKILL from '../../docs/resident/DEVICE-SKILL.md?raw';
import { session } from './session';

type Mode = 'read' | 'readwrite';
interface FileEntry {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
interface WritableFile {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
interface FolderHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileEntry | { kind: 'directory'; name: string }>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<WritableFile>;
  queryPermission?(o: { mode: Mode }): Promise<PermissionState>;
  requestPermission?(o: { mode: Mode }): Promise<PermissionState>;
}
type Picker = (o?: { id?: string; mode?: Mode }) => Promise<FolderHandle>;

const picker = (): Picker | undefined => (typeof window !== 'undefined' ? (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker : undefined);
const POLL_MS = 700;
const MAX_FILES = 200;
const SKILL_FILE = 'DEVICE-SKILL.md';

// The chosen folder survives reloads in IndexedDB (a handle can't go in localStorage), with the
// access it was watched with, so a read-only folder comes back read-only.
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bench', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function keep(handle: FolderHandle | null, mode: Mode = 'readwrite'): Promise<void> {
  try {
    const store = (await db()).transaction('handles', 'readwrite').objectStore('handles');
    if (handle) {
      store.put(handle, 'watch');
      store.put(mode, 'watch-mode');
    } else {
      store.delete('watch');
      store.delete('watch-mode');
    }
  } catch {
    /* not remembered */
  }
}
async function recall(): Promise<{ handle: FolderHandle; mode: Mode } | null> {
  try {
    const store = (await db()).transaction('handles').objectStore('handles');
    const get = <T>(key: string) =>
      new Promise<T | undefined>((resolve) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => resolve(undefined);
      });
    const [handle, mode] = await Promise.all([get<FolderHandle>('watch'), get<Mode>('watch-mode')]);
    return handle ? { handle, mode: mode ?? 'readwrite' } : null;
  } catch {
    return null;
  }
}

class FolderWatch {
  readonly supported = !!picker();
  /** The folder being watched. */
  folder: FolderHandle | null = null;
  /** A folder from last time, waiting for a click (the browser asks again after a reload). */
  saved: FolderHandle | null = null;
  /** The access the folder is (or was last) watched with: read-only can't hold the device skill. */
  mode: Mode = 'readwrite';
  /** The last file that was run from the folder. */
  last: string | null = null;
  /** This Bench's DEVICE-SKILL.md is in the folder (written when watching began). */
  skill = false;
  /** Edit access was refused (or the picker closed): offer to watch read-only instead. */
  refused = false;
  error: string | null = null;
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    if (!this.supported) return;
    void recall().then(async (r) => {
      if (!r || this.folder) return;
      this.mode = r.mode;
      if ((await r.handle.queryPermission?.({ mode: r.mode })) === 'granted') await this.start(r.handle, r.mode);
      else {
        this.saved = r.handle;
        this.notify();
      }
    });
  }

  /**
   * Ask for a folder and start watching it: with edit access, so Bench can put its device skill
   * there, or read-only. The browser reports a refused edit prompt like a closed picker.
   */
  async pick(mode: Mode = 'readwrite'): Promise<void> {
    const show = picker();
    if (!show) return;
    try {
      const h = await show({ id: 'bench-apps', mode });
      await keep(h, mode);
      await this.start(h, mode);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.fail(e);
      else if (mode === 'readwrite') {
        this.refused = true;
        this.notify();
      }
    }
  }
  /** Watch last time's folder again (needs the click, for the permission prompt). */
  async resume(mode: Mode = this.mode): Promise<void> {
    const h = this.saved;
    if (!h) return;
    try {
      if ((await h.requestPermission?.({ mode })) !== 'granted') {
        if (mode === 'readwrite') {
          this.refused = true;
          this.notify();
        }
        return;
      }
      await keep(h, mode);
      await this.start(h, mode);
    } catch (e) {
      this.fail(e);
    }
  }
  /** A folder watched read-only: ask for edit access now, and put the device skill there. */
  async allowEdit(): Promise<void> {
    const h = this.folder;
    if (!h) return;
    try {
      if ((await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted') return;
      this.mode = 'readwrite';
      this.skill = await writeSkill(h);
      await keep(h, 'readwrite');
      this.notify();
    } catch (e) {
      this.fail(e);
    }
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.folder = null;
    this.saved = null;
    this.mode = 'readwrite';
    this.last = null;
    this.skill = false;
    this.refused = false;
    void keep(null);
    this.notify();
  }

  private async start(h: FolderHandle, mode: Mode): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.folder = h;
    this.saved = null;
    this.mode = mode;
    this.refused = false;
    this.error = null;
    this.last = null;
    this.skill = mode === 'readwrite' && (await writeSkill(h));
    // Only what's saved from now on runs: the files already there are a baseline.
    this.seen = await this.scan(h);
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.notify();
  }

  private async scan(h: FolderHandle): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    for await (const entry of h.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.lua')) continue;
      found.set(entry.name, (await entry.getFile()).lastModified);
      if (found.size >= MAX_FILES) break;
    }
    return found;
  }

  private async poll(): Promise<void> {
    const h = this.folder;
    if (!h || this.busy) return;
    this.busy = true;
    try {
      let newest: { name: string; file: File } | null = null;
      for await (const entry of h.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.lua')) continue;
        const file = await entry.getFile();
        if (this.seen.get(entry.name) === file.lastModified) continue;
        this.seen.set(entry.name, file.lastModified);
        if (!newest || file.lastModified > newest.file.lastModified) newest = { name: entry.name, file };
      }
      if (newest && this.folder === h) {
        const code = await newest.file.text();
        // An editor may save in two steps; an empty file is the first one.
        if (code.trim()) {
          this.last = newest.name;
          session.setLive({ name: newest.name.replace(/\.lua$/, ''), code, source: 'file' });
          this.notify();
        }
      }
    } catch (e) {
      this.fail(e);
      this.stop();
    } finally {
      this.busy = false;
    }
  }

  private fail(e: unknown) {
    this.error = `Couldn't read the folder: ${e instanceof Error ? e.message : String(e)}`;
    this.notify();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

/** Put this Bench's device skill in the folder, unless an identical copy is there. */
async function writeSkill(h: FolderHandle): Promise<boolean> {
  try {
    const file = await h.getFileHandle(SKILL_FILE, { create: true });
    if ((await (await file.getFile()).text()) === SKILL) return true;
    const out = await file.createWritable();
    await out.write(SKILL);
    await out.close();
    return true;
  } catch {
    return false;
  }
}

export const folderWatch = new FolderWatch();
