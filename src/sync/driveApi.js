const driveBase = 'https://www.googleapis.com/drive/v3';
const uploadBase = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Make an authorized Drive API request.
 * @param {{accessToken:string, apiKey:string, path:string, method?:string, query?:Record<string,string>, body?:any, headers?:Record<string,string>}} req - Request.
 * @returns {Promise<any>} Parsed JSON (or null for 204).
 */
export async function driveRequest(req) {
    const url = new URL(`${driveBase}${req.path}`);
    url.searchParams.set('key', req.apiKey);

    if (req.query) {
        for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
        method: req.method || 'GET',
        headers: {
            Authorization: `Bearer ${req.accessToken}`,
            ...(req.headers || {})
        },
        body: req.body ?? undefined
    });

    if (res.status === 204) return null;

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
        const msg = data?.error?.message || `Drive request failed (${res.status}).`;
        throw new Error(msg);
    }

    return data;
}

/**
 * Create or update a small JSON file in appDataFolder using multipart upload.
 * Uses Drive "files.create" with uploadType=multipart. :contentReference[oaicite:2]{index=2}
 * @param {{accessToken:string, apiKey:string, name:string, contentType:string, json:any, appProperties?:Record<string,string>}} req - Upload request.
 * @returns {Promise<{id:string, md5Checksum?:string}>} File id and md5.
 */
export async function createJsonFileMultipart(req) {
    const boundary = '----notesBoundary' + Math.random().toString(16).slice(2);

    const metadata = {
        name: req.name,
        parents: ['appDataFolder'],
        mimeType: req.contentType,
        appProperties: req.appProperties || {}
    };

    const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${req.contentType}\r\n\r\n` +
        `${JSON.stringify(req.json)}\r\n` +
        `--${boundary}--`;

    const url = new URL(`${uploadBase}/files`);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set('fields', 'id,md5Checksum');
    url.searchParams.set('key', req.apiKey);

    const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${req.accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
        const msg = data?.error?.message || `Upload failed (${res.status}).`;
        throw new Error(msg);
    }

    return data;
}

/**
 * Update an existing JSON file by fileId (metadata + content) via multipart PATCH.
 * @param {{accessToken:string, apiKey:string, fileId:string, contentType:string, json:any, appProperties?:Record<string,string>}} req - Update request.
 * @returns {Promise<{id:string, md5Checksum?:string}>} File id and md5.
 */
export async function updateJsonFileMultipart(req) {
    const boundary = '----notesBoundary' + Math.random().toString(16).slice(2);

    const metadata = {
        mimeType: req.contentType,
        appProperties: req.appProperties || {}
    };

    const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${req.contentType}\r\n\r\n` +
        `${JSON.stringify(req.json)}\r\n` +
        `--${boundary}--`;

    const url = new URL(`${uploadBase}/files/${encodeURIComponent(req.fileId)}`);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set('fields', 'id,md5Checksum');
    url.searchParams.set('key', req.apiKey);

    const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${req.accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
        const msg = data?.error?.message || `Update failed (${res.status}).`;
        throw new Error(msg);
    }

    return data;
}

/**
 * Download a file's contents (media).
 * @param {{accessToken:string, apiKey:string, fileId:string}} req - Download request.
 * @returns {Promise<string>} File content string.
 */
export async function downloadFile(req) {
    const url = new URL(`${driveBase}/files/${encodeURIComponent(req.fileId)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('key', req.apiKey);

    const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${req.accessToken}` }
    });

    if (!res.ok) {
        const text = await res.text();
        let msg = `Download failed (${res.status}).`;
        try {
            const data = JSON.parse(text);
            msg = data?.error?.message || msg;
        } catch { }
        throw new Error(msg);
    }

    return await res.text();
}

/**
 * Delete a file by id.
 * @param {{accessToken:string, apiKey:string, fileId:string}} req - Delete request.
 * @returns {Promise<void>} Resolves when done.
 */
export async function deleteFile(req) {
    await driveRequest({
        accessToken: req.accessToken,
        apiKey: req.apiKey,
        path: `/files/${encodeURIComponent(req.fileId)}`,
        method: 'DELETE'
    });
}

/**
 * Get a start page token for changes (incremental sync). :contentReference[oaicite:3]{index=3}
 * @param {{accessToken:string, apiKey:string}} req - Request.
 * @returns {Promise<string>} startPageToken.
 */
export async function getStartPageToken(req) {
    const data = await driveRequest({
        accessToken: req.accessToken,
        apiKey: req.apiKey,
        path: '/changes/startPageToken',
        query: { spaces: 'appDataFolder' }
    });

    return data.startPageToken;
}

/**
 * List changes since a page token (incremental). :contentReference[oaicite:4]{index=4}
 * @param {{accessToken:string, apiKey:string, pageToken:string}} req - Request.
 * @returns {Promise<{changes:Array<any>, newStartPageToken?:string, nextPageToken?:string}>} Changes.
 */
export async function listChanges(req) {
    return await driveRequest({
        accessToken: req.accessToken,
        apiKey: req.apiKey,
        path: '/changes',
        query: {
            spaces: 'appDataFolder',
            pageToken: req.pageToken,
            includeRemoved: 'true',
            fields: 'changes(fileId,removed,file(name,appProperties,trashed,modifiedTime)),newStartPageToken,nextPageToken'
        }
    });
}

/**
 * Find a note file in appDataFolder by noteId using appProperties.
 * @param {{accessToken:string, apiKey:string, noteId:string}} req - Request.
 * @returns {Promise<{id:string}|null>} File or null.
 */
export async function findNoteFileByNoteId(req) {
    const q = [
        "trashed = false",
        "appProperties has { key='noteId' and value='" + req.noteId.replace(/'/g, "\\'") + "' }"
    ].join(' and ');

    const data = await driveRequest({
        accessToken: req.accessToken,
        apiKey: req.apiKey,
        path: '/files',
        query: {
            spaces: 'appDataFolder',
            q,
            pageSize: '1',
            fields: 'files(id)'
        }
    });

    return data.files?.[0] || null;
}

/**
 * List all note files in appDataFolder (bootstrap sync).
 * @param {{accessToken:string, apiKey:string}} req - Request.
 * @returns {Promise<Array<{id:string, appProperties?:Record<string,string>, modifiedTime?:string}>>} Files.
 */
export async function listAllNoteFiles(req) {
    const q = [
        "trashed = false",
        "appProperties has { key='kind' and value='note' }"
    ].join(' and ');

    const files = [];
    let pageToken = null;

    while (true) {
        const data = await driveRequest({
            accessToken: req.accessToken,
            apiKey: req.apiKey,
            path: '/files',
            query: {
                spaces: 'appDataFolder',
                q,
                pageSize: '1000',
                fields: 'nextPageToken,files(id,appProperties,modifiedTime)',
                ...(pageToken ? { pageToken } : {})
            }
        });

        if (data?.files?.length) files.push(...data.files);

        if (!data?.nextPageToken) break;
        pageToken = data.nextPageToken;
    }

    return files;
}
