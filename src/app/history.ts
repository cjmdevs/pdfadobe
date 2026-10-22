// Undo/redo for page operations: whole-file snapshots per tab. Simple and exact (every
// state is a real PDF that was on screen). Memory is capped; the oldest steps go first.

export const HISTORY_CAP_BYTES = 400 * 1024 * 1024;

interface Revision {
  bytes: Uint8Array;
  label: string;
}

export class EditHistory {
  private revs: Revision[];
  private index = 0;
  /** Index of the revision that matches the file on disk; -1 once that one is dropped. */
  private savedIndex = 0;
  /** Set when old steps were dropped to stay under the cap (shown once to the user). */
  trimmed = false;

  constructor(
    initial: Uint8Array,
    private readonly capBytes = HISTORY_CAP_BYTES,
    /** A new, never-saved document (Combine result, extracted pages) starts dirty. */
    saved = true,
  ) {
    this.revs = [{ bytes: initial, label: "Open" }];
    if (!saved) this.savedIndex = -1;
  }

  get current(): Uint8Array {
    return this.at(this.index).bytes;
  }

  get dirty(): boolean {
    return this.index !== this.savedIndex;
  }

  get undoLabel(): string | null {
    return this.index > 0 ? this.at(this.index).label : null;
  }

  get redoLabel(): string | null {
    return this.index < this.revs.length - 1 ? this.at(this.index + 1).label : null;
  }

  get totalBytes(): number {
    return this.revs.reduce((n, r) => n + r.bytes.byteLength, 0);
  }

  /** Records a new state after `label`; discards anything that could have been redone. */
  push(bytes: Uint8Array, label: string): void {
    this.revs = this.revs.slice(0, this.index + 1);
    if (this.savedIndex > this.index) this.savedIndex = -1;
    this.revs.push({ bytes, label });
    this.index++;
    while (this.totalBytes > this.capBytes && this.index > 0) {
      this.revs.shift();
      this.index--;
      this.savedIndex--;
      this.trimmed = true;
    }
    if (this.savedIndex < 0) this.savedIndex = -1;
  }

  undo(): Uint8Array | null {
    if (this.index === 0) return null;
    this.index--;
    return this.current;
  }

  redo(): Uint8Array | null {
    if (this.index >= this.revs.length - 1) return null;
    this.index++;
    return this.current;
  }

  markSaved(): void {
    this.savedIndex = this.index;
  }

  private at(i: number): Revision {
    const r = this.revs[i];
    if (!r) throw new RangeError("history index out of range");
    return r;
  }
}
