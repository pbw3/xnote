import { formatTime, snippet } from './util.js';

/**
 * Get a DOM element by id.
 * @param {string} id - Element id.
 * @returns {HTMLElement} Element.
 */
export function el(id) {
    return /** @type {HTMLElement} */ (document.getElementById(id));
}

/**
 * Render the notes list.
 * @param {Array<object>} notes - Notes to render.
 * @param {string|null} activeNoteId - Active note id.
 * @param {(noteId:string)=>void} onSelect - Selection callback.
 * @returns {void}
 */
export function renderList(notes, activeNoteId, onSelect) {
    const list = el('notesList');
    const emptyState = el('emptyState');

    list.innerHTML = '';

    if (!notes.length) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    for (const n of notes) {
        const item = document.createElement('div');
        item.className = 'listItem' + (n.noteId === activeNoteId ? ' listItem--active' : '');
        item.tabIndex = 0;

        const title = document.createElement('p');
        title.className = 'listItem__title';
        title.textContent = n.title?.trim() ? n.title.trim() : '(Untitled)';

        const snip = document.createElement('p');
        snip.className = 'listItem__snippet';
        snip.textContent = snippet(n.body || '');

        item.appendChild(title);
        item.appendChild(snip);

        item.addEventListener('click', () => onSelect(n.noteId));
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') onSelect(n.noteId);
        });

        list.appendChild(item);
    }
}

/**
 * Show the detail view for a note.
 * @param {object} note - Note object.
 * @returns {void}
 */
export function showDetail(note) {
    el('welcomeView').hidden = true;
    el('editorView').hidden = true;
    el('detailView').hidden = false;

    el('detailTitle').textContent = note.title?.trim() ? note.title.trim() : '(Untitled)';
    el('detailUpdated').textContent = `Updated: ${formatTime(note.updatedAtMs)}`;
    el('detailBody').textContent = note.body || '';
}

/**
 * Show the editor view for a note.
 * @param {object} note - Note object.
 * @returns {void}
 */
export function showEditor(note) {
    el('welcomeView').hidden = true;
    el('detailView').hidden = true;
    el('editorView').hidden = false;

  /** @type {HTMLInputElement} */ (el('titleInput')).value = note.title || '';
  /** @type {HTMLTextAreaElement} */ (el('bodyInput')).value = note.body || '';
    el('titleInput').focus();
}

/**
 * Show the initial welcome view.
 * @returns {void}
 */
export function showWelcome() {
    el('detailView').hidden = true;
    el('editorView').hidden = true;
    el('welcomeView').hidden = false;
}

/**
 * Read editor inputs.
 * @returns {{title:string, body:string}} Editor values.
 */
export function readEditor() {
    const title = /** @type {HTMLInputElement} */ (el('titleInput')).value;
    const body = /** @type {HTMLTextAreaElement} */ (el('bodyInput')).value;
    return { title, body };
}
