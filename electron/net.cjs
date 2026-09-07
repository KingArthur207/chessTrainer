// Outbound HTTP for the renderer, restricted to an allowlist. Keeping network
// access in the main process means the sandboxed renderer never talks to the
// internet directly, and one place enforces "one request at a time".
const ALLOWED_PREFIXES = ['https://lichess.org/'];
const USER_AGENT = 'ChessTrainer/0.1 (personal desktop training app)';

let inFlight = Promise.resolve();

/**
 * @param {import('electron').IpcMain} ipcMain
 */
function registerNetIpc(ipcMain) {
  ipcMain.handle('net:fetch-text', (_evt, url, options) => {
    if (typeof url !== 'string' || !ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
      return { ok: false, status: 0, error: `URL not allowed: ${String(url).slice(0, 80)}` };
    }
    const accept = typeof options?.accept === 'string' ? options.accept : 'text/plain';
    // Serialise requests so the app never hammers a host in parallel.
    const run = inFlight.then(async () => {
      try {
        const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': USER_AGENT } });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text, retryAfter: res.headers.get('retry-after') };
      } catch (err) {
        return { ok: false, status: 0, error: err && err.message ? err.message : String(err) };
      }
    });
    inFlight = run.catch(() => undefined);
    return run;
  });
}

module.exports = { registerNetIpc };
