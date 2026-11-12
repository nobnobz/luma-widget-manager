import type { DraftBaseline, SyncProfileDraft } from './documents';
import { isProfileSlot } from './profiles';
import { derive, digest, json, MAX_PLAIN, open, parse, seal, utf8, uuid, type Bytes } from './wire';

export interface LocalDraft { profile: string; base: DraftBaseline; draft: SyncProfileDraft }
interface Entry { revision: string; cipher: Bytes }

const database = 'luma-sync-local-drafts';
const table = 'drafts';
const pending = new Map<string, Promise<unknown>>();

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(table);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('draft_storage_blocked')); };
  });
}

/** Only ciphertext and a random revision are stored. The key is never persisted. */
export class DraftVault {
  private revision: string | undefined;
  private sequence = 0;

  private constructor(private readonly slot: string, private readonly key: CryptoKey) {}

  static async unlock(origin: string, space: string, master: Bytes) {
    const scope = utf8.encode(`luma-sync-local-draft-v1:${origin}:${space}`);
    const [slot, key] = await Promise.all([digest(scope), derive(master, utf8.encode(space), scope)]);
    return new DraftVault(slot, key);
  }

  private aad(revision: string) { return utf8.encode(`luma-sync-local-draft-v1:${this.slot}:${revision}`); }

  private async access(mode: IDBTransactionMode, apply: (store: IDBObjectStore, current?: Entry) => void) {
    const db = await connect();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(table, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('draft_storage_aborted'));
        const store = transaction.objectStore(table), read = store.get(this.slot);
        read.onsuccess = () => {
          try { apply(store, read.result); }
          catch (error) { reject(error); transaction.abort(); }
        };
      });
    } finally { db.close(); }
  }

  async read(): Promise<LocalDraft | null> {
    await pending.get(this.slot)?.catch(() => undefined);
    let entry: Entry | undefined;
    await this.access('readonly', (_store, current) => { entry = current; });
    this.revision = entry?.revision;
    if (!entry) return null;
    if (!uuid(entry.revision) || !(entry.cipher instanceof Uint8Array) || entry.cipher.length > MAX_PLAIN + 28) throw new Error('invalid_local_draft');
    const plain = await open(entry.cipher, this.key, this.aad(entry.revision));
    try {
      const record = parse(plain) as LocalDraft & { version: number };
      if (record?.version !== 1 || !isProfileSlot(record.profile) || !record.base?.draft || !record.draft) throw new Error('invalid_local_draft');
      return record;
    } finally { plain.fill(0); }
  }

  private queue<T>(action: () => Promise<T>) {
    const task = Promise.resolve(pending.get(this.slot)).catch(() => undefined).then(action);
    pending.set(this.slot, task);
    void task.finally(() => { if (pending.get(this.slot) === task) pending.delete(this.slot); }).catch(() => undefined);
    return task;
  }

  write(value: LocalDraft) {
    const sequence = ++this.sequence;
    return this.queue(async () => {
      if (sequence !== this.sequence) return;
      const revision = crypto.randomUUID();
      const plain = json({ version: 1, ...value });
      try {
        if (plain.length > MAX_PLAIN) throw new Error('local_draft_too_large');
        const cipher = await seal(plain, this.key, this.aad(revision));
        if (sequence !== this.sequence) return;
        await this.replace({ revision, cipher });
      } finally { plain.fill(0); }
    });
  }

  clear() {
    ++this.sequence;
    return this.queue(async () => {
      if (this.revision !== undefined) await this.replace();
    });
  }

  private async replace(next?: Entry) {
    await this.access('readwrite', (store, current) => {
      // An older tab must not overwrite or delete a newer tab's draft.
      if (current && current.revision !== this.revision) {
        if (next) throw new Error('local_draft_changed');
        return;
      }
      if (next) store.put(next, this.slot);
      else store.delete(this.slot);
    });
    this.revision = next?.revision;
  }
}
