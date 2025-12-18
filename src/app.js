import { openDb, listNotes, getNote, putNote, softDeleteNote, enqueueOp } from './db.js';
import { createId } from './util.js';
import { el, renderList, showDetail, showEditor, showWelcome, readEditor } from './ui.js';

import { initTokenClient, getAccessToken } from './sync/googleAuth.js';
import { syncNow } from './sync/syncEngine.js';

// ✅ Fill these in from Google Cloud Console:
const googleConfig = {
    clientId: '1063047704198-gblidf0oc4c0s14dluki9qbsm3jsf0s8.apps.googleusercontent.com',
    apiKey: 'AIzaSyB-4bb8-o9FbS3MaJh1yt644FL-Y5uTTxI',
    scope: 'https://www.googleapis.com/auth/drive.appdata'
};

let db;
let notesCache = [];
let activeNoteId = null;
let editingNoteId = null;

/**
 * Initialize the app.
 * @returns {Promise<void>} Resolves when ready.
 */
async function initApp() {
    db = await openDb();

    registerServiceWorker();
    wireEvents();

    await initTokenClient({ clientId: googleConfig.clientId, scope: googleConfig.scope });

    await refreshList();
    showWelcome();
    setSyncBadge('Local');
}

/**
 * Register the service worker.
 * @returns {void}
 */
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-fatal: app still works without SW.
    });
}

/**
 * Wire UI event handlers.
 * @returns {void}
 */
function wireEvents() {
    el('newBtn').addEventListener('click', onNew);
    el('editBtn').addEventListener('click', onEdit);
    el('deleteBtn').addEventListener('click', onDelete);

    el('saveBtn').addEventListener('click', onSave);
    el('cancelBtn').addEventListener('click', onCancel);

    el('searchInput').addEventListener('input', onSearch);

    el('syncBtn').addEventListener('click', onSync);
}

/**
 * Set sync badge label.
 * @param {string} text - Badge text.
 * @returns {void}
 */
function setSyncBadge(text) {
    el('syncBadge').textContent = text;
}

/**
 * Refresh notes list from DB and re-render.
 * @returns {Promise<void>} Resolves when done.
 */
async function refreshList() {
    notesCache = await listNotes(db);
    renderCurrentList();
}

/**
 * Render list with current filter and active selection.
 * @returns {void}
 */
function renderCurrentList() {
    const q = /** @type {HTMLInputElement} */ (el('searchInput')).value.trim().toLowerCase();
    const filtered = q
        ? notesCache.filter((n) =>
            (n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q)
        )
        : notesCache;

    renderList(filtered, activeNoteId, selectNote);
}

/**
 * Select a note and show details.
 * @param {string} noteId - Note id.
 * @returns {Promise<void>} Resolves when done.
 */
async function selectNote(noteId) {
    activeNoteId = noteId;
    editingNoteId = null;

    const note = await getNote(db, noteId);
    if (!note || note.deletedAtMs) {
        activeNoteId = null;
        showWelcome();
        await refreshList();
        return;
    }

    showDetail(note);
    renderCurrentList();
}

/**
 * Add an outbox operation for a note.
 * @param {'upsert'|'delete'} type - Operation type.
 * @param {string} noteId - Note id.
 * @returns {Promise<void>} Resolves when done.
 */
async function queueOp(type, noteId) {
    const op = {
        opId: createId(),
        type,
        noteId,
        queuedAtMs: Date.now()
    };
    await enqueueOp(db, op);
}

/**
 * Create a new note and open editor.
 * @returns {Promise<void>} Resolves when done.
 */
async function onNew() {
    const now = Date.now();
    const noteId = createId();

    const note = {
        noteId,
        title: '',
        body: '',
        updatedAtMs: now,
        deletedAtMs: null
    };

    await putNote(db, note);
    await queueOp('upsert', noteId);

    await refreshList();

    activeNoteId = noteId;
    editingNoteId = noteId;
    showEditor(note);
    renderCurrentList();
}

/**
 * Edit the active note.
 * @returns {Promise<void>} Resolves when done.
 */
async function onEdit() {
    if (!activeNoteId) return;
    const note = await getNote(db, activeNoteId);
    if (!note || note.deletedAtMs) return;

    editingNoteId = activeNoteId;
    showEditor(note);
}

/**
 * Save the editor note.
 * @returns {Promise<void>} Resolves when done.
 */
async function onSave() {
    if (!editingNoteId) return;

    const note = await getNote(db, editingNoteId);
    if (!note || note.deletedAtMs) {
        editingNoteId = null;
        showWelcome();
        await refreshList();
        return;
    }

    const { title, body } = readEditor();
    note.title = title;
    note.body = body;
    note.updatedAtMs = Date.now();

    await putNote(db, note);
    await queueOp('upsert', note.noteId);

    editingNoteId = null;

    activeNoteId = note.noteId;
    await refreshList();
    showDetail(note);
    renderCurrentList();
    setSyncBadge('Pending');
}

/**
 * Cancel edit and return to detail/welcome.
 * @returns {Promise<void>} Resolves when done.
 */
async function onCancel() {
    if (!editingNoteId) return;

    const noteId = editingNoteId;
    editingNoteId = null;

    const note = await getNote(db, noteId);
    if (!note || note.deletedAtMs) {
        activeNoteId = null;
        showWelcome();
        await refreshList();
        renderCurrentList();
        return;
    }

    activeNoteId = note.noteId;
    showDetail(note);
    renderCurrentList();
}

/**
 * Delete the active note (soft delete + outbox delete).
 * @returns {Promise<void>} Resolves when done.
 */
async function onDelete() {
    if (!activeNoteId) return;

    const ok = confirm('Delete this note?');
    if (!ok) return;

    const noteId = activeNoteId;
    activeNoteId = null;
    editingNoteId = null;

    await softDeleteNote(db, noteId, Date.now());
    await queueOp('delete', noteId);

    await refreshList();
    showWelcome();
    renderCurrentList();
    setSyncBadge('Pending');
}

/**
 * Handle search input.
 * @returns {void}
 */
function onSearch() {
    renderCurrentList();
}

/**
 * Sync handler: tries silent token first, then prompts if needed.
 * @returns {Promise<void>} Resolves when done.
 */
async function onSync() {
    setSyncBadge('Syncing…');

    try {
        let accessToken = null;

        // Try non-interactive first.
        try {
            accessToken = await getAccessToken({ interactive: false });
        } catch {
            // Then interactive consent.
            accessToken = await getAccessToken({ interactive: true });
        }

        const stats = await syncNow(db, { accessToken, apiKey: googleConfig.apiKey });
        await refreshList();

        setSyncBadge(`Synced (${stats.pushed}/${stats.pulled})`);
    } catch (e) {
        console.error(e);
        setSyncBadge('Sync error');
        alert(`Sync failed: ${e?.message || e}`);
    }
}

initApp();
