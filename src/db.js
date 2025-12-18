const dbName = 'notesDb';
const dbVersion = 1;

const stores = {
    notes: 'notes'
};

/**
 * Open the IndexedDB database.
 * @returns {Promise<IDBDatabase>} Open DB instance.
 */
export function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);

        req.onupgradeneeded = () => {
            const db = req.result;

            if (!db.objectStoreNames.contains(stores.notes)) {
                const store = db.createObjectStore(stores.notes, { keyPath: 'noteId' });
                store.createIndex('updatedAtMs', 'updatedAtMs', { unique: false });
                store.createIndex('deletedAtMs', 'deletedAtMs', { unique: false });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Run a transaction and return the object store.
 * @param {IDBDatabase} db - DB instance.
 * @param {'readonly'|'readwrite'} mode - Transaction mode.
 * @returns {IDBObjectStore} Store object.
 */
export function getNotesStore(db, mode) {
    const tx = db.transaction(stores.notes, mode);
    return tx.objectStore(stores.notes);
}

/**
 * List all non-deleted notes ordered by updatedAtMs descending.
 * @param {IDBDatabase} db - DB instance.
 * @returns {Promise<Array<object>>} Notes array.
 */
export function listNotes(db) {
    return new Promise((resolve, reject) => {
        const store = getNotesStore(db, 'readonly');
        const req = store.getAll();

        req.onsuccess = () => {
            const notes = (req.result || []).filter((n) => !n.deletedAtMs);
            notes.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
            resolve(notes);
        };

        req.onerror = () => reject(req.error);
    });
}

/**
 * Get a note by id.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} noteId - Note id.
 * @returns {Promise<object|null>} Note object or null.
 */
export function getNote(db, noteId) {
    return new Promise((resolve, reject) => {
        const store = getNotesStore(db, 'readonly');
        const req = store.get(noteId);

        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Upsert a note.
 * @param {IDBDatabase} db - DB instance.
 * @param {object} note - Note object.
 * @returns {Promise<void>} Resolves when done.
 */
export function putNote(db, note) {
    return new Promise((resolve, reject) => {
        const store = getNotesStore(db, 'readwrite');
        const req = store.put(note);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Soft-delete a note (sets deletedAtMs).
 * @param {IDBDatabase} db - DB instance.
 * @param {string} noteId - Note id.
 * @param {number} deletedAtMs - Timestamp.
 * @returns {Promise<void>} Resolves when done.
 */
export async function softDeleteNote(db, noteId, deletedAtMs) {
    const note = await getNote(db, noteId);
    if (!note) return;
    note.deletedAtMs = deletedAtMs;
    note.updatedAtMs = deletedAtMs;
    await putNote(db, note);
}
