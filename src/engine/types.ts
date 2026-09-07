// Engine plugin contract.
//
// Any chess engine (native Stockfish via Electron, stockfish.wasm in a web
// worker, a remote analysis API…) implements `ChessEngine`, and is made
// discoverable through an `EngineProvider` registered in ./registry.ts.
// Activities only ever talk to these interfaces.

export interface EngineInfo {
  depth?: number;
  selDepth?: number;
  /** Score in centipawns from the side to move's point of view. */
  scoreCp?: number;
  /** Mate in N (negative when the side to move is getting mated). */
  scoreMate?: number;
  multiPv?: number;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  /** Principal variation as UCI moves, e.g. ["e2e4", "e7e5"]. */
  pv?: string[];
}

export interface SearchOptions {
  depth?: number;
  moveTimeMs?: number;
  nodes?: number;
  multiPv?: number;
  /** Search until `stop()` is called. */
  infinite?: boolean;
}

export interface BestMove {
  bestMove: string;
  ponder?: string;
}

export interface ChessEngine {
  readonly name: string;
  /** Spawn/load the engine and complete the UCI handshake. */
  init(): Promise<void>;
  /** `fen` may be the literal "startpos". `moves` are UCI moves played after it. */
  setPosition(fen: string, moves?: string[]): void;
  /** Start a search. Resolves with the best move when the engine reports it. */
  go(options: SearchOptions, onInfo?: (info: EngineInfo) => void): Promise<BestMove>;
  /** Interrupt the current search (the pending `go` still resolves). */
  stop(): void;
  /** Set a UCI option (e.g. MultiPV, Skill Level). Optional for non-UCI engines. */
  setOption?(name: string, value: string | number): void;
  /** Free all resources. The instance must not be used afterwards. */
  dispose(): void;
}

export interface EngineProvider {
  id: string;
  label: string;
  description: string;
  /** Cheap check: is this provider usable right now on this platform/config? */
  isAvailable(): Promise<boolean>;
  create(): Promise<ChessEngine>;
}
