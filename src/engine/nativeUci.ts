// ChessEngine implementation backed by a native UCI binary (e.g. Stockfish)
// spawned by the Electron main process (electron/engine.cjs).
import type { EngineBridge } from '@/lib/platform';
import type { BestMove, ChessEngine, EngineInfo, SearchOptions } from './types';
import { buildGoCommand, parseBestMoveLine, parseInfoLine } from './uci';

type LineHandler = (line: string) => void;

export class NativeUciEngine implements ChessEngine {
  readonly name: string;
  private handlers = new Set<LineHandler>();
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly binaryPath: string,
    private readonly bridge: EngineBridge,
    name = 'Native UCI engine',
  ) {
    this.name = name;
  }

  async init(): Promise<void> {
    const result = await this.bridge.start(this.binaryPath);
    if (!result.ok) throw new Error(result.error);
    const unsubLine = this.bridge.onLine((line) => this.handlers.forEach((h) => h(line)));
    const unsubExit = this.bridge.onExit(() => {
      this.disposed = true;
    });
    this.unsubscribe = () => {
      unsubLine();
      unsubExit();
    };
    await this.request('uci', (l) => l === 'uciok');
    await this.request('isready', (l) => l === 'readyok');
  }

  setPosition(fen: string, moves: string[] = []): void {
    const pos = fen === 'startpos' ? 'startpos' : `fen ${fen}`;
    const tail = moves.length ? ` moves ${moves.join(' ')}` : '';
    this.send(`position ${pos}${tail}`);
  }

  async go(options: SearchOptions, onInfo?: (info: EngineInfo) => void): Promise<BestMove> {
    if (options.multiPv !== undefined) {
      this.send(`setoption name MultiPV value ${options.multiPv}`);
    }
    const infoHandler: LineHandler = (line) => {
      const info = parseInfoLine(line);
      if (info && onInfo) onInfo(info);
    };
    this.handlers.add(infoHandler);
    try {
      const line = await this.request(buildGoCommand(options), (l) => l.startsWith('bestmove'), 0);
      return parseBestMoveLine(line) ?? { bestMove: '(none)' };
    } finally {
      this.handlers.delete(infoHandler);
    }
  }

  stop(): void {
    this.send('stop');
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.handlers.clear();
    void this.bridge.stop();
  }

  private send(line: string): void {
    if (this.disposed) throw new Error('Engine has been disposed');
    void this.bridge.send(line);
  }

  /** Send a command and resolve with the first line matching `done`. */
  private request(command: string, done: (line: string) => boolean, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
      let timer: number | undefined;
      const handler: LineHandler = (line) => {
        if (!done(line)) return;
        this.handlers.delete(handler);
        if (timer !== undefined) window.clearTimeout(timer);
        resolve(line);
      };
      this.handlers.add(handler);
      if (timeoutMs > 0) {
        timer = window.setTimeout(() => {
          this.handlers.delete(handler);
          reject(new Error(`Engine did not respond to "${command}" within ${timeoutMs}ms`));
        }, timeoutMs);
      }
      this.send(command);
    });
  }
}
