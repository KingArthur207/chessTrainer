// Typed access to the Electron preload bridge (electron/preload.cjs).
// When the app runs in a plain browser (`npm run dev:web`) the bridge is
// absent and every helper falls back to a web equivalent.

export interface EngineBridge {
  /** Path of the Stockfish binary bundled in ./stockfish, or null if absent. */
  defaultPath(): Promise<string | null>;
  start(binaryPath: string): Promise<{ ok: true } | { ok: false; error: string }>;
  send(line: string): Promise<void>;
  stop(): Promise<void>;
  onLine(cb: (line: string) => void): () => void;
  onExit(cb: (code: number | null) => void): () => void;
}

export interface TextResponse {
  ok: boolean;
  status: number;
  text?: string;
  error?: string;
  retryAfter?: string | null;
}

export interface NetBridge {
  /** GET a text resource. Only allowlisted hosts (lichess.org) are permitted. */
  fetchText(url: string, options?: { accept?: string }): Promise<TextResponse>;
}

export interface ChessTrainerBridge {
  platform: 'electron';
  os: NodeJS.Platform | string;
  window: {
    toggleFullscreen(): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void;
  };
  app: {
    version(): Promise<string>;
  };
  net: NetBridge;
  engine: EngineBridge;
}

declare global {
  interface Window {
    chessTrainer?: ChessTrainerBridge;
  }
}

export const bridge: ChessTrainerBridge | undefined =
  typeof window !== 'undefined' ? window.chessTrainer : undefined;

export const isElectron = bridge !== undefined;
export const isMacElectron = isElectron && bridge?.os === 'darwin';

export async function toggleFullscreen(): Promise<boolean> {
  if (bridge) return bridge.window.toggleFullscreen();
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return false;
  }
  await document.documentElement.requestFullscreen();
  return true;
}

export async function isFullscreen(): Promise<boolean> {
  if (bridge) return bridge.window.isFullscreen();
  return document.fullscreenElement !== null;
}

/** Subscribe to fullscreen changes on either platform. Returns unsubscribe. */
export function onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void {
  if (bridge) return bridge.window.onFullscreenChange(cb);
  const handler = () => cb(document.fullscreenElement !== null);
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}

/** GET a text resource through the Electron bridge, or window.fetch on the web. */
export async function fetchText(url: string, accept = 'text/plain'): Promise<TextResponse> {
  if (bridge) return bridge.net.fetchText(url, { accept });
  try {
    const res = await fetch(url, { headers: { Accept: accept } });
    return { ok: res.ok, status: res.status, text: await res.text(), retryAfter: res.headers.get('retry-after') };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
