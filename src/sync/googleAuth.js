const gisSrc = 'https://accounts.google.com/gsi/client';

let tokenClient = null;
let gisLoaded = false;

/**
 * Load the Google Identity Services script.
 * @returns {Promise<void>} Resolves when loaded.
 */
export function loadGoogleIdentityScript() {
    if (gisLoaded) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${gisSrc}"]`);
        if (existing) {
            gisLoaded = true;
            resolve();
            return;
        }

        const s = document.createElement('script');
        s.src = gisSrc;
        s.async = true;
        s.defer = true;
        s.onload = () => {
            gisLoaded = true;
            resolve();
        };
        s.onerror = () => reject(new Error('Failed to load Google Identity script.'));
        document.head.appendChild(s);
    });
}

/**
 * Initialize the OAuth token client.
 * @param {{clientId:string, scope:string}} cfg - OAuth configuration.
 * @returns {Promise<void>} Resolves when ready.
 */
export async function initTokenClient(cfg) {
    await loadGoogleIdentityScript();

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: cfg.scope,
        callback: () => { }
    });
}

/**
 * Request an access token.
 * @param {{interactive:boolean}} opts - Token request options.
 * @returns {Promise<string>} Access token.
 */
export function getAccessToken(opts) {
    if (!tokenClient) throw new Error('Token client not initialized.');

    return new Promise((resolve, reject) => {
        tokenClient.callback = (resp) => {
            if (resp?.error) {
                reject(new Error(resp.error));
                return;
            }
            if (!resp?.access_token) {
                reject(new Error('No access token received.'));
                return;
            }
            resolve(resp.access_token);
        };

        tokenClient.requestAccessToken({
            prompt: opts.interactive ? 'consent' : ''
        });
    });
}
