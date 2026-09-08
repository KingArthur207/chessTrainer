// One shared engine for the whole app. Activities call `analyse()` (or
// `playMove()` later) and never touch UCI directly. Searches are serialised;
// scores are reported both as UCI gives them (side to move) and from White's
// point of view, which is what evaluation bars and trainers want.
import { listAvailableEngineProviders } from './registry';
import type { ChessEngine, EngineInfo } from './types';

export interface EvalLine {
  multiPv: number;
  depth: number;
  /** Centipawns from White's point of view. */
  cp: number | null;
  /** Mate in N from White's point of view (negative: Black mates). */
  mate: number | null;
  /** UCI moves. */
  pv: string[];
}

export interface Evaluation {
  fen: string;
  depth: number;
  lines: EvalLine[];
  bestMove: string | null;
  /** Convenience: the first line's score. */
  cp: number | null;
  mate: number | null;
  /** True once the search finished (bestmove received). */
  final: boolean;
}

export interface AnalyseOptions {
  depth?: number;
  moveTimeMs?: number;
  multiPv?: number;
  /** Limit playing strength to this Elo (Stockfish: 1320–3190). Omit for full strength. */
  elo?: number;
  /** Search until `stop()`; the promise resolves with what was found. */
  infinite?: boolean;
  /** Set `cancelled` before the search starts and it is skipped. */
  token?: { cancelled: boolean };
  onProgress?: (partial: Evaluation) => void;
}

export const ELO_MIN = 1320;
export const ELO_MAX = 3190;

const MATE_CP = 100_000;

/** Score for sorting/bars: mate counts as ±100000 adjusted so faster mates score higher. */
export function scoreValue(line: { cp: number | null; mate: number | null }): number {
  if (line.mate !== null) return line.mate > 0 ? MATE_CP - line.mate : -MATE_CP - line.mate;
  return line.cp ?? 0;
}

/** "+1.3", "−0.4", "M3", "−M2". */
export function formatScore(line: { cp: number | null; mate: number | null }): string {
  if (line.mate !== null) return line.mate > 0 ? `M${line.mate}` : `−M${-line.mate}`;
  if (line.cp === null) return '…';
  const pawns = line.cp / 100;
  const text = Math.abs(pawns).toFixed(1);
  return pawns > 0 ? `+${text}` : pawns < 0 ? `−${text}` : '0.0';
}

/** Share of the eval bar filled for White, 0..1 (logistic on pawns). */
export function whiteShare(line: { cp: number | null; mate: number | null }): number {
  if (line.mate !== null) return line.mate > 0 ? 1 : 0;
  const pawns = (line.cp ?? 0) / 100;
  return 1 / (1 + Math.exp(-0.9 * pawns));
}

function toWhite(info: EngineInfo, whiteToMove: boolean, depthFallback: number): EvalLine | null {
  if (!info.pv || info.pv.length === 0) return null;
  if (info.scoreCp === undefined && info.scoreMate === undefined) return null;
  const sign = whiteToMove ? 1 : -1;
  return {
    multiPv: info.multiPv ?? 1,
    depth: info.depth ?? depthFallback,
    cp: info.scoreCp !== undefined ? sign * info.scoreCp : null,
    mate: info.scoreMate !== undefined ? sign * info.scoreMate : null,
    pv: info.pv,
  };
}

export class EngineSession {
  private engine: ChessEngine | null = null;
  private initPromise: Promise<ChessEngine> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private engineFactory: () => Promise<ChessEngine>;
  /** Strength currently configured on the engine (null = full). */
  private limitedTo: number | null = null;

  constructor(factory?: () => Promise<ChessEngine>) {
    this.engineFactory =
      factory ??
      (async () => {
        const providers = await listAvailableEngineProviders();
        if (providers.length === 0) throw new Error('No chess engine is available. Add Stockfish to ./stockfish (npm run fetch:stockfish).');
        return providers[0].create();
      });
  }

  /** Engine display name once initialised (e.g. "Stockfish 19"). */
  get name(): string | null {
    return this.engine?.name ?? null;
  }

  get ready(): boolean {
    return this.engine !== null;
  }

  async init(): Promise<ChessEngine> {
    if (this.engine) return this.engine;
    this.initPromise ??= this.engineFactory().then((engine) => {
      this.engine = engine;
      return engine;
    });
    try {
      return await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  /** Analyse a position. Searches run one at a time in call order. */
  analyse(fen: string, options: AnalyseOptions = {}): Promise<Evaluation> {
    const run = async (): Promise<Evaluation> => {
      const engine = await this.init();
      const whiteToMove = fen.split(' ')[1] !== 'b';
      if (options.token?.cancelled) {
        return { fen, depth: 0, lines: [], bestMove: null, cp: null, mate: null, final: true };
      }
      const multiPv = options.multiPv ?? 1;
      engine.setOption?.('MultiPV', multiPv);
      this.applyStrength(engine, options.elo ?? null);
      engine.setPosition(fen);
      const lines = new Map<number, EvalLine>();
      let depth = 0;
      const assemble = (bestMove: string | null, final: boolean): Evaluation => {
        const sorted = [...lines.values()].sort((a, b) => a.multiPv - b.multiPv);
        const first = sorted[0];
        return {
          fen,
          depth,
          lines: sorted,
          bestMove,
          cp: first?.cp ?? null,
          mate: first?.mate ?? null,
          final,
        };
      };
      const result = await engine.go({ depth: options.depth, moveTimeMs: options.moveTimeMs, multiPv, infinite: options.infinite }, (info) => {
        const line = toWhite(info, whiteToMove, depth);
        if (!line) return;
        if (line.multiPv === 1 && info.depth !== undefined) depth = Math.max(depth, info.depth);
        // Keep the deepest report per line; a new depth replaces the old one.
        lines.set(line.multiPv, line);
        options.onProgress?.(assemble(null, false));
      });
      const best = result.bestMove && result.bestMove !== '(none)' ? result.bestMove : null;
      return assemble(best ?? lines.get(1)?.pv[0] ?? null, true);
    };
    const promise = this.queue.then(run, run);
    this.queue = promise.catch(() => undefined);
    return promise;
  }

  /** Ask the engine for a move to play, optionally at limited strength. */
  async playMove(fen: string, options: { elo?: number | null; moveTimeMs?: number } = {}): Promise<string | null> {
    const ev = await this.analyse(fen, { moveTimeMs: options.moveTimeMs ?? 600, multiPv: 1, elo: options.elo ?? undefined });
    return ev.bestMove;
  }

  private applyStrength(engine: ChessEngine, elo: number | null): void {
    const target = elo === null ? null : Math.min(ELO_MAX, Math.max(ELO_MIN, Math.round(elo)));
    if (target === this.limitedTo) return;
    if (target === null) {
      engine.setOption?.('UCI_LimitStrength', 'false');
    } else {
      engine.setOption?.('UCI_LimitStrength', 'true');
      engine.setOption?.('UCI_Elo', target);
    }
    this.limitedTo = target;
  }

  /** Interrupt the running search; its promise still resolves with what was found. */
  stop(): void {
    this.engine?.stop();
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
    this.initPromise = null;
    this.limitedTo = null;
  }
}

let shared: EngineSession | null = null;

/** The app-wide engine session (lazy; the engine process starts on first use). */
export function getEngineSession(): EngineSession {
  shared ??= new EngineSession();
  return shared;
}

export async function engineAvailable(): Promise<boolean> {
  return (await listAvailableEngineProviders()).length > 0;
}
