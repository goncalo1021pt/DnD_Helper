/**
 * The sheet you supplied, kept on this device.
 *
 * The official sheet is a megabyte and a half of Wizards' artwork — far too
 * big for localStorage, and not ours to put on the server. IndexedDB is the
 * right shelf for it: the file stays in this browser, so you pick it once and
 * every hero you print afterwards finds it already there.
 *
 * Every call fails soft. A browser in private mode, or one with storage
 * switched off, simply means the sheet is asked for again next time — never a
 * broken export.
 */

const DB_NAME = "questboard-sheet";
const STORE = "files";
const KEY = "backdrop";

export interface StoredSheet {
  bytes: Uint8Array;
  name: string;
  mime: string;
  /** Which sheet page each image covers; absent for a PDF. */
  page?: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** What we put on the shelf: plain data, so structured clone is happy. */
interface Record_ {
  parts: Array<{ bytes: ArrayBuffer; name: string; mime: string; page?: number }>;
}

export async function saveSheetFiles(files: StoredSheet[]): Promise<void> {
  try {
    const record: Record_ = {
      parts: files.map((f) => ({
        // Copy out of any larger buffer the view might be looking into.
        bytes: f.bytes.slice().buffer as ArrayBuffer,
        name: f.name,
        mime: f.mime,
        page: f.page,
      })),
    };
    await tx("readwrite", (s) => s.put(record, KEY));
  } catch {
    // Storage refused; the export still works, it just forgets the sheet.
  }
}

export async function loadSheetFiles(): Promise<StoredSheet[]> {
  try {
    const record = (await tx<Record_ | undefined>("readonly", (s) => s.get(KEY))) ?? undefined;
    if (!record?.parts?.length) return [];
    return record.parts.map((p) => ({
      bytes: new Uint8Array(p.bytes),
      name: p.name,
      mime: p.mime,
      page: p.page,
    }));
  } catch {
    return [];
  }
}

export async function clearSheetFiles(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    // Nothing to do — the caller clears its own state regardless.
  }
}
