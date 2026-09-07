// Engine provider registry. Register new providers here (or from a plugin's
// entry module) and every engine-aware activity will list them.
import { bridge } from '@/lib/platform';
import { loadJson, saveJson } from '@/lib/storage';
import { NativeUciEngine } from './nativeUci';
import type { EngineProvider } from './types';

const providers: EngineProvider[] = [];

export function registerEngineProvider(provider: EngineProvider): void {
  if (providers.some((p) => p.id === provider.id)) return;
  providers.push(provider);
}

export function listEngineProviders(): readonly EngineProvider[] {
  return providers;
}

export async function listAvailableEngineProviders(): Promise<EngineProvider[]> {
  const flags = await Promise.all(providers.map((p) => p.isAvailable().catch(() => false)));
  return providers.filter((_, i) => flags[i]);
}

// ---- Built-in: native UCI binary (desktop only) ---------------------------
// Uses a user-configured binary when set, otherwise the Stockfish build
// bundled in ./stockfish (discovered by the main process).
const ENGINE_PATH_KEY = 'engine:native:path';

export function getNativeEnginePath(): string | null {
  return loadJson<string | null>(ENGINE_PATH_KEY, null);
}

export function setNativeEnginePath(path: string | null): void {
  saveJson(ENGINE_PATH_KEY, path);
}

/** Configured path, falling back to the bundled Stockfish. */
export async function resolveNativeEnginePath(): Promise<string | null> {
  return getNativeEnginePath() ?? (bridge ? await bridge.engine.defaultPath() : null);
}

if (bridge) {
  const desktop = bridge;
  registerEngineProvider({
    id: 'native-uci',
    label: 'Stockfish (native)',
    description: 'Runs the bundled Stockfish binary, or any UCI engine you point it at.',
    isAvailable: async () => (await resolveNativeEnginePath()) !== null,
    create: async () => {
      const path = await resolveNativeEnginePath();
      if (!path) throw new Error('No engine binary found: add one to ./stockfish or call setNativeEnginePath()');
      const engine = new NativeUciEngine(path, desktop.engine, 'Stockfish');
      await engine.init();
      return engine;
    },
  });
}

// Future providers (examples):
//   registerEngineProvider(stockfishWasmProvider) // stockfish.wasm in a Worker
//   registerEngineProvider(lichessCloudEvalProvider)
