import type { SimClock } from '../clock';
import { EventLog, SimInput } from './input';
import { KeySet } from './keys';

export interface RfidOptions {
  label?: string;
}

export type TagType = 'mifare-classic' | 'ntag';

/** The tags that come with the reader: two cards and a key fob (MIFARE Classic 1K), and a sticker. */
export const TAGS: { id: string; label: string; type: TagType }[] = [
  { id: 'card-a', label: 'Card A', type: 'mifare-classic' },
  { id: 'card-b', label: 'Card B', type: 'mifare-classic' },
  { id: 'fob', label: 'Key fob', type: 'mifare-classic' },
  { id: 'sticker', label: 'NTAG215 sticker', type: 'ntag' },
];

/** The driver asks the reader for a tag this often. */
export const POLL_MS = 100;

/** A tag's UID: 4 bytes on a MIFARE Classic, 7 on an NTAG (NXP's 0x04 first). The same part and tag
 *  always get the same one, so a share link opens the same cards. */
function uidOf(part: string, tag: { id: string; type: TagType }): string {
  let h = 2166136261;
  for (const c of `${part}:${tag.id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const bytes: number[] = [];
  for (let i = 0; i < 7; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    bytes.push((h >>> 16) & 0xff);
  }
  const uid = tag.type === 'ntag' ? [0x04, ...bytes.slice(0, 6)] : bytes.slice(0, 4);
  if (uid[0] === 0x88) uid[0] = 0x89; // 0x88 marks a cascade, never a UID's first byte
  return uid.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * RFID / NFC reader (PN532 on I2C) and the tags beside it. The UI lays a tag on the antenna or takes
 * it off; the driver asks for a tag every 100 ms, so it notices either at its next poll. One tag at a
 * time: laying another down takes the first away. Each tag is a channel of its own, held while it's on
 * the reader, and `tag` presses with any of them; both carry the tag's UID.
 */
export class RfidReader extends SimInput {
  readonly kind = 'rfid';
  readonly keys: KeySet;
  readonly log = new EventLog();
  /** The tag on the antenna now (the UI's view), and what the driver has seen at its polls. */
  private onReader: string | null = null;
  private changes: { tag: string | null; at: number }[] = [];
  private seen: string | null = null;

  constructor(
    opts: RfidOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'RFID reader');
    this.keys = new KeySet({ pump: () => this.pump(), press: (id, down) => this.hold(id, down) }, TAGS, 'tag');
  }

  /** A tag's UID, as the reader reads it. */
  uid(tag: string): string {
    const t = TAGS.find((x) => x.id === tag);
    return t ? uidOf(this.name || this.label, t) : '';
  }

  // ---- UI side ----
  /** Lay a tag on the reader (null: take it off). */
  place(tag: string | null): void {
    if (tag !== null && !TAGS.some((t) => t.id === tag)) return;
    if (tag === this.onReader) return;
    this.onReader = tag;
    this.changes.push({ tag, at: this.clock.now() });
    this.changed();
  }
  get lying(): string | null {
    return this.onReader;
  }
  /** A key held for a trigger: its tag lies on the reader while it's down (`tag`: the first card). */
  private hold(id: string, down: boolean) {
    const tag = id === 'tag' ? TAGS[0].id : id;
    if (down) this.place(tag);
    else if (this.onReader === tag) this.place(null);
  }

  // ---- sketch side ----
  /** The tag the driver found at its last poll. */
  read(): { present: boolean; uid?: string; type?: TagType } {
    this.pump();
    const t = TAGS.find((x) => x.id === this.seen);
    return t ? { present: true, uid: this.uid(t.id), type: t.type } : { present: false };
  }

  /** Each poll since the last read: whatever lay on the reader then is what it found. */
  private pump() {
    const now = this.clock.now();
    while (this.changes.length) {
      const c = this.changes[0];
      const poll = Math.ceil(c.at / POLL_MS) * POLL_MS;
      if (poll > now) return;
      // Everything that happened before this poll: only the last of it is on the reader when it asks.
      let last = c;
      while (this.changes.length && Math.ceil(this.changes[0].at / POLL_MS) * POLL_MS === poll) last = this.changes.shift()!;
      this.found(last.tag, poll);
    }
  }

  private found(tag: string | null, t: number) {
    if (tag === this.seen) return;
    if (this.seen !== null) {
      const uid = this.uid(this.seen);
      this.keys.edge(this.seen, false, t, uid);
      this.log.push('tag', { present: false, uid });
    }
    this.seen = tag;
    if (tag !== null) {
      const uid = this.uid(tag);
      this.keys.edge(tag, true, t, uid);
      this.log.push('tag', { present: true, uid, type: TAGS.find((x) => x.id === tag)!.type });
    }
  }
}
