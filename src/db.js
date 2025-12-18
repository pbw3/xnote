const dbName = 'notesDb';
const dbVersion = 2;

const stores = {
    notes: 'notes',
    outbox: 'outbox',
    driveMap: 'driveMap',
    syncMeta: 'syncMeta'
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

            if (!db.objectStoreNames.contains(stores.outbox)) {
                const store = db.createObjectStore(stores.outbox, { keyPath: 'opId' });
                store.createIndex('queuedAtMs', 'queuedAtMs', { unique: false });
            }

            if (!db.objectStoreNames.contains(stores.driveMap)) {
                db.createObjectStore(stores.driveMap, { keyPath: 'noteId' });
            }

            if (!db.objectStoreNames.contains(stores.syncMeta)) {
                db.createObjectStore(stores.syncMeta, { keyPath: 'key' });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Run a transaction and return the object store.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} storeName - Store name.
 * @param {'readonly'|'readwrite'} mode - Transaction mode.
 * @returns {IDBObjectStore} Store object.
 */
function getStore(db, storeName, mode) {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
}

/**
 * List all non-deleted notes ordered by updatedAtMs descending.
 * @param {IDBDatabase} db - DB instance.
 * @returns {Promise<Array<object>>} Notes array.
 */
export function listNotes(db) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.notes, 'readonly');
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
        const store = getStore(db, stores.notes, 'readonly');
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
        const store = getStore(db, stores.notes, 'readwrite');
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

/**
 * Add an outbox operation.
 * @param {IDBDatabase} db - DB instance.
 * @param {{opId:string,type:'upsert'|'delete',noteId:string,queuedAtMs:number}} op - Operation.
 * @returns {Promise<void>} Resolves when done.
 */
export function enqueueOp(db, op) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.outbox, 'readwrite');
        const req = store.put(op);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * List outbox operations in queued order.
 * @param {IDBDatabase} db - DB instance.
 * @returns {Promise<Array<object>>} Outbox ops.
 */
export function listOps(db) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.outbox, 'readonly');
        const idx = store.index('queuedAtMs');
        const req = idx.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Remove an outbox op.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} opId - Operation id.
 * @returns {Promise<void>} Resolves when done.
 */
export function deleteOp(db, opId) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.outbox, 'readwrite');
        const req = store.delete(opId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get Drive mapping for a note.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} noteId - Note id.
 * @returns {Promise<{noteId:string,driveFileId:string,md5?:string}|null>} Mapping or null.
 */
export function getDriveMap(db, noteId) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.driveMap, 'readonly');
        const req = store.get(noteId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Set Drive mapping for a note.
 * @param {IDBDatabase} db - DB instance.
 * @param {{noteId:string,driveFileId:string,md5?:string}} mapping - Mapping.
 * @returns {Promise<void>} Resolves when done.
 */
export function putDriveMap(db, mapping) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.driveMap, 'readwrite');
        const req = store.put(mapping);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Delete Drive mapping for a note.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} noteId - Note id.
 * @returns {Promise<void>} Resolves when done.
 */
export function deleteDriveMap(db, noteId) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.driveMap, 'readwrite');
        const req = store.delete(noteId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Read a sync meta value.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} key - Meta key.
 * @returns {Promise<any>} Value or null.
 */
export function getMeta(db, key) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.syncMeta, 'readonly');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Write a sync meta value.
 * @param {IDBDatabase} db - DB instance.
 * @param {string} key - Meta key.
 * @param {any} value - Meta value.
 * @returns {Promise<void>} Resolves when done.
 */
export function setMeta(db, key, value) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, stores.syncMeta, 'readwrite');
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
