// Keys: the named momentary inputs of a part that has several (a remote's buttons, a keypad's
// pads, the cards an RFID reader knows), each with a button's edges, plus `any`, which presses with
// every one of them and carries the code of each press (the key's name, or a card's UID). A trigger
// connects to one key or to `any`; `trigger:code()` says which key was behind a press.

/** What a key's readers need of the part: bring its model up to now (an IR frame lands a few ms
 *  after the key goes down), and the part's own handling of a press from the UI or the keyboard. */
export interface KeyOwner {
  pump(): void;
  press(id: string, down: boolean): void;
}

/** Presses remembered per key: enough for every press between two reads. */
const CODES = 32;

export class Key {
  private down = 0;
  private counts = { presses: 0, releases: 0 };
  private flags = { pressed: false, released: false };
  /** Each press's code and time, by press number (1 = the first). */
  private log = new Map<number, { code: string | null; at: number }>();

  constructor(
    private owner: KeyOwner,
    readonly id: string,
    readonly label: string,
  ) {}

  // ---- model side ----
  /**
   * An edge at time `t`. A key that's already down can be pressed again (`any`, while another key
   * is held): each press counts, and it reads as down until every press has been let go.
   */
  edge(down: boolean, t: number, code: string | null): void {
    if (down) {
      this.counts.presses++;
      this.log.set(this.counts.presses, { code, at: t });
      this.log.delete(this.counts.presses - CODES);
      this.down++;
      this.flags.pressed = true;
    } else {
      if (this.down === 0) return;
      this.counts.releases++;
      this.down--;
      this.flags.released = true;
    }
  }

  // ---- UI side ----
  setDown(down: boolean): void {
    this.owner.press(this.id, down);
  }

  // ---- reader side (a Button's API) ----
  get presses(): number {
    this.owner.pump();
    return this.counts.presses;
  }
  get releases(): number {
    this.owner.pump();
    return this.counts.releases;
  }
  isPressed(): boolean {
    this.owner.pump();
    return this.down > 0;
  }
  wasPressed(): boolean {
    this.owner.pump();
    const r = this.flags.pressed;
    this.flags.pressed = false;
    return r;
  }
  wasReleased(): boolean {
    this.owner.pump();
    const r = this.flags.released;
    this.flags.released = false;
    return r;
  }
  /** When the n-th press (default: the latest) went down, in sim ms: `any` rolls from key to key. */
  pressedAt(press = this.counts.presses): number {
    return this.log.get(press)?.at ?? 0;
  }
  /** The code of the n-th press (1 = the first), while it's among the last few. */
  codeOf(press: number): string | null {
    return this.log.get(press)?.code ?? null;
  }
  /** The code of the latest press. */
  get code(): string | null {
    return this.codeOf(this.counts.presses);
  }
}

/** A part's keys and its `any` channel. */
export class KeySet {
  readonly keys: Key[];
  readonly any: Key;

  constructor(owner: KeyOwner, list: { id: string; label: string }[], any = 'any') {
    this.keys = list.map((k) => new Key(owner, k.id, k.label));
    this.any = new Key(owner, any, 'any');
  }

  get(id: string): Key | undefined {
    return id === this.any.id ? this.any : this.keys.find((k) => k.id === id);
  }
  /** A key went down or up when the model says it did: its edge, and `any`'s with the code (a part
   *  with one key, a mic's clap, has nothing to tell apart: no code). */
  edge(id: string, down: boolean, t: number, code: string | null = this.keys.length > 1 ? id : null): void {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return;
    k.edge(down, t, code);
    this.any.edge(down, t, code);
  }
}
