/**
 * Create a random UUID (uses crypto.randomUUID when available).
 * @returns {string} UUID string.
 */
export function createId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();

    // Fallback: RFC4122-ish (good enough for local IDs)
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Format a timestamp in a friendly local string.
 * @param {number} ms - Epoch milliseconds.
 * @returns {string} Formatted date/time.
 */
export function formatTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Create a short snippet for list display.
 * @param {string} text - Input text.
 * @param {number} maxLen - Maximum length.
 * @returns {string} Snippet.
 */
export function snippet(text, maxLen = 90) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen - 1)}…`;
}
