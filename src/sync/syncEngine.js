import {
    createJsonFileMultipart,
    updateJsonFileMultipart,
    deleteFile,
    downloadFile,
    getStartPageToken,
    listChanges,
    findNoteFileByNoteId,
    listAllNoteFiles
} from './driveApi.js';

import {
    listOps,
    deleteOp,
    getNote,
    putNote,
    getDriveMap,
    putDriveMap,
    deleteDriveMap,
    getMeta,
    setMeta
} from '../db.js';

/**
 * Build a note file name.
 * @param {string} noteId - Note id.
 * @returns {string} Drive file name.
 */
function noteFileName(noteId) {
    return `note-${noteId}.json`;
}

/**
 * Apply last-write-wins merge (local source of truth for edits, but remote can win if newer).
 * @param {object|null} local - Local note.
 * @param {object} remote - Remote note.
 * @returns {{winner:'local'|'remote', merged:object}} Winner and merged note.
 */
function mergeLastWriteWins(local, remote) {
    if (!local) return { winner: 'remote', merged: remote };
    const l = Number(local.updatedAtMs || 0);
    const r = Number(remote.updatedAtMs || 0);
    if (r > l) return { winner: 'remote', merged: { ...local, ...remote } };
    return { winner: 'local', merged: local };
}

/**
 * Ensure we have a changes cursor stored. If missing, do a bootstrap pull of all note files first,
 * then set the cursor so future syncs are incremental.
 * @param {IDBDatabase} db - DB.
 * @param {{accessToken:string, apiKey:string}} auth - Auth params.
 * @returns {Promise<string>} Cursor token.
 */
async function ensureCursor(db, auth) {
    let cursor = await getMeta(db, 'drive.changeCursor');
    if (cursor) return cursor;

    // Bootstrap: pull everything currently in appDataFolder so new devices see existing notes.
    const files = await listAllNoteFiles(auth);

    for (const f of files) {
        const props = f.appProperties || {};
        if (props.kind !== 'note' || !props.noteId) continue;

        const raw = await downloadFile({ ...auth, fileId: f.id });
        let remoteNote;
        try {
            remoteNote = JSON.parse(raw);
        } catch {
            continue;
        }

        const local = await getNote(db, remoteNote.noteId);
        const { winner, merged } = mergeLastWriteWins(local, remoteNote);

        if (winner === 'remote') {
            await putNote(db, merged);
        }

        // Ensure mapping exists for future updates/deletes.
        const mapping = await getDriveMap(db, remoteNote.noteId);
        if (!mapping?.driveFileId) {
            await putDriveMap(db, { noteId: remoteNote.noteId, driveFileId: f.id });
        }
    }

    // Now start incremental tracking from current state.
    cursor = await getStartPageToken(auth);
    await setMeta(db, 'drive.changeCursor', cursor);
    return cursor;
}


/**
 * Sync notes: push outbox, then pull Drive changes.
 * @param {IDBDatabase} db - DB instance.
 * @param {{accessToken:string, apiKey:string}} auth - Access token + API key.
 * @returns {Promise<{pushed:number,pulled:number}>} Sync stats.
 */
export async function syncNow(db, auth) {
    const pushed = await pushOutbox(db, auth);
    const pulled = await pullChanges(db, auth);
    await setMeta(db, 'drive.lastSyncAtMs', Date.now());
    return { pushed, pulled };
}

/**
 * Push queued operations to Drive.
 * @param {IDBDatabase} db - DB instance.
 * @param {{accessToken:string, apiKey:string}} auth - Auth params.
 * @returns {Promise<number>} Count pushed.
 */
async function pushOutbox(db, auth) {
    const ops = await listOps(db);
    let pushed = 0;

    for (const op of ops) {
        if (op.type === 'upsert') {
            const note = await getNote(db, op.noteId);
            if (!note) {
                await deleteOp(db, op.opId);
                continue;
            }

            // If note is deleted, treat as delete.
            if (note.deletedAtMs) {
                await pushDelete(db, auth, note.noteId);
                await deleteOp(db, op.opId);
                pushed++;
                continue;
            }

            await pushUpsert(db, auth, note);
            await deleteOp(db, op.opId);
            pushed++;
            continue;
        }

        if (op.type === 'delete') {
            await pushDelete(db, auth, op.noteId);
            await deleteOp(db, op.opId);
            pushed++;
        }
    }

    return pushed;
}

/**
 * Push upsert of a single note.
 * @param {IDBDatabase} db - DB.
 * @param {{accessToken:string, apiKey:string}} auth - Auth params.
 * @param {object} note - Note object.
 * @returns {Promise<void>} Resolves when done.
 */
async function pushUpsert(db, auth, note) {
    const contentType = 'application/json';

    // Prefer stored mapping; fall back to lookup by appProperties.
    let mapping = await getDriveMap(db, note.noteId);
    let fileId = mapping?.driveFileId || null;

    if (!fileId) {
        const found = await findNoteFileByNoteId({ ...auth, noteId: note.noteId });
        if (found?.id) fileId = found.id;
    }

    const appProperties = { noteId: note.noteId, kind: 'note' };

    if (!fileId) {
        const created = await createJsonFileMultipart({
            ...auth,
            name: noteFileName(note.noteId),
            contentType,
            json: note,
            appProperties
        });

        await putDriveMap(db, { noteId: note.noteId, driveFileId: created.id, md5: created.md5Checksum });
        return;
    }

    const updated = await updateJsonFileMultipart({
        ...auth,
        fileId,
        contentType,
        json: note,
        appProperties
    });

    await putDriveMap(db, { noteId: note.noteId, driveFileId: updated.id, md5: updated.md5Checksum });
}

/**
 * Push delete of a single note.
 * @param {IDBDatabase} db - DB.
 * @param {{accessToken:string, apiKey:string}} auth - Auth params.
 * @param {string} noteId - Note id.
 * @returns {Promise<void>} Resolves when done.
 */
async function pushDelete(db, auth, noteId) {
    const mapping = await getDriveMap(db, noteId);
    const fileId = mapping?.driveFileId || (await findNoteFileByNoteId({ ...auth, noteId }))?.id || null;

    if (fileId) {
        // Delete remote file. (If already gone, Drive may return 404; treat as ok.)
        try {
            await deleteFile({ ...auth, fileId });
        } catch (e) {
            // If it fails for some other reason, rethrow.
            const msg = String(e?.message || '');
            if (!msg.includes('File not found') && !msg.includes('404')) throw e;
        }
    }

    await deleteDriveMap(db, noteId);
}

/**
 * Pull Drive changes and merge into local DB.
 * @param {IDBDatabase} db - DB.
 * @param {{accessToken:string, apiKey:string}} auth - Auth params.
 * @returns {Promise<number>} Count of local notes changed by pull.
 */
async function pullChanges(db, auth) {
    let cursor = await ensureCursor(db, auth);
    let pulled = 0;

    while (true) {
        const data = await listChanges({ ...auth, pageToken: cursor });
        const changes = data.changes || [];

        for (const ch of changes) {
            if (!ch?.fileId) continue;

            // Removed/trashed
            if (ch.removed || ch.file?.trashed) {
                // If we can map fileId->noteId, we could tombstone it.
                // For simplicity (solo app), we just leave local unless we already mapped it.
                // (You can add reverse mapping later if you want.)
                continue;
            }

            const props = ch.file?.appProperties || {};
            if (props.kind !== 'note' || !props.noteId) continue;

            const raw = await downloadFile({ ...auth, fileId: ch.fileId });
            let remoteNote;
            try {
                remoteNote = JSON.parse(raw);
            } catch {
                continue;
            }

            const local = await getNote(db, remoteNote.noteId);
            const { winner, merged } = mergeLastWriteWins(local, remoteNote);

            // If remote wins, write it locally.
            if (winner === 'remote') {
                await putNote(db, merged);
                pulled++;
            }

            // Ensure mapping exists (helps future deletes/updates).
            const mapping = await getDriveMap(db, remoteNote.noteId);
            if (!mapping?.driveFileId) {
                await putDriveMap(db, { noteId: remoteNote.noteId, driveFileId: ch.fileId });
            }
        }

        if (data.nextPageToken) {
            cursor = data.nextPageToken;
            continue;
        }

        // When no next page, store newStartPageToken (if provided) for future deltas.
        if (data.newStartPageToken) {
            await setMeta(db, 'drive.changeCursor', data.newStartPageToken);
        } else {
            await setMeta(db, 'drive.changeCursor', cursor);
        }

        break;
    }

    return pulled;
}
