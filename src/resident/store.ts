// The `store` module's backing: an app-scoped KV slot of scalars with Resident's 2048-byte budget.
// Persisted in localStorage when available (it survives reloads like NVS survives reboots).

export type Scalar = string | number | boolean;

const BUDGET = 2048;
const KEY = 'screensim:resident-store';

interface Slot {
  ns: string;
  data: Record<string, Scalar>;
}

export class AppStore {
  private slot: Slot;
  private warned = new Set<string>();

  constructor(
    ns: string,
    private persist = true,
    private onFull?: (key: string) => void,
  ) {
    const saved = this.read();
    // Same namespace keeps the slot; a different one clears it.
    this.slot = saved && saved.ns === ns ? saved : { ns, data: {} };
    if (!saved || saved.ns !== ns) this.write();
  }

  get(key: string): Scalar | undefined {
    return this.slot.data[key];
  }

  set(key: string, value: Scalar | null | undefined): boolean {
    const next = { ...this.slot.data };
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
    if (size({ ns: this.slot.ns, data: next }) > BUDGET) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.onFull?.(key);
      }
      return false;
    }
    this.slot.data = next;
    this.write();
    return true;
  }

  keys(): string[] {
    return Object.keys(this.slot.data);
  }

  clear(): void {
    this.slot.data = {};
    this.write();
  }

  remaining(): number {
    return Math.max(0, BUDGET - size(this.slot));
  }

  private read(): Slot | null {
    if (!this.persist) return null;
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Slot) : null;
    } catch {
      return null;
    }
  }

  private write() {
    if (!this.persist) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.slot));
    } catch {
      /* storage unavailable: the slot lives for this session only */
    }
  }
}

const size = (s: Slot) => new TextEncoder().encode(JSON.stringify(s)).length;
