# Chess Trainer

A modern desktop chess training app. It launches full screen, uses lichess's
board and piece style, and is built to grow: new activities, master-game
sources and chess engines plug in through small, documented interfaces.

## Run it

```bash
npm install
npm run dev        # Electron app with hot reload
```

Other scripts:

| Script              | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev:web`   | Renderer only, in the browser at http://localhost:5173  |
| `npm run build`     | Type-check and build the renderer into `dist/`          |
| `npm start`         | Build, then run the packaged-style app from `dist/`     |
| `npm run package`   | Build a macOS `.app` into `release/` (electron-builder) |
| `npm test`          | Unit tests (PGN import/export round-trip, scheduling)   |
| `npm run test:e2e`  | Playwright tests of the real Electron app (all drills)  |

Keyboard: **Space** starts a run, **Esc** ends it, **Ctrl+Cmd+F** toggles full
screen.

## Stockfish

`stockfish/` holds the official Stockfish 19 macOS universal binary (GPL-3.0,
licence alongside). The main process finds it automatically, packaged builds
copy it into the app's resources, and the native engine provider in
`src/engine` uses it unless another binary is configured. To refresh it, or to
fetch the right build on another platform:

```bash
npm run fetch:stockfish
```

The binary is git-ignored because of its size; run that script after cloning.

## Activities

### Bullet Trainer
A reflex drill. A single piece appears on an empty board with a glowing
target square that it can legally reach. Drag it (or click the piece, then the
square) as fast as you can. Choose 30 s, 45 s or 1 min.

- Correct move: counts as solved, the next piece appears instantly.
- Wrong or illegal move: the piece snaps back, the board flashes red and a
  miss is counted. Dropping a piece off the board is ignored.
- Results show solved, misses, accuracy, average and fastest move, and the
  personal best per duration is remembered.

### Opening Trainer
A Chessable-style repertoire trainer.

- **Library.** One entry per opening (Sicilian Dragon, Nimzo-Indian, …), each
  with the side you play. Cards show lines, moves, how many lines are due and
  when you last practised. A labelled example repertoire is seeded on first
  launch and can be deleted.
- **Editor.** Play moves on the board to grow the tree (existing moves are
  followed, new ones are added), click any move in the Lichess-study style
  move list to jump there, annotate moves (notes show during practice), promote
  a variation to the main line, delete a branch. Arrow keys navigate.
- **Import PGN.** Paste one or many lines: move numbers optional, `( )`
  variations, `{ }` comments, `!?` glyphs, NAGs, headers and results are all
  handled. A blank line or a fresh `1.` starts another line; shared prefixes
  merge into the tree. Illegal moves are reported with their context and the
  rest still imports.
- **Export PGN.** The whole tree as one PGN with nested variations and
  comments, wrapped at 80 columns. Pasting it back into Import recreates the
  identical tree (covered by a unit test).
- **Practice.** The board is oriented for your side; the app plays the other
  side from your theory and quizzes you on every move to the end of the line.
  Any book move for your side is accepted and practice follows that branch.
  After a wrong move you retry; the second miss highlights the piece, the third
  shows the move as an arrow. Lines are scheduled with spaced repetition
  (1, 3, 7, 14, 30, 60, 120, 240 days; a failed line returns within the
  session) and the library offers "due" or "all" lines.

### Board Memory
The classic de Groot exercise. A position flashes on the board for 3, 5, 10 or
20 seconds, disappears, and you rebuild it: click a palette piece and stamp
squares, drag pieces in from the palette, move them around, or drag them off
the board to remove them. Check scores you against the original (correct,
missing, wrong, extra) and shows the differences highlighted on both the
solution and your answer. Positions come from five bundled classic games
(Morphy's Opera Game, the Immortal and Evergreen games, Byrne–Fischer 1956,
Kasparov–Topalov 1999), from your own opening trees, or from random piece
placement, which is much harder because there is no structure to chunk.

The default source is **Lichess masters**: recent over-the-board games from
Lichess's official broadcast tournaments. The app fetches 500 games at a time
(up to 8 positions per game) through `GET /api/broadcast/top` and
`GET /api/broadcast/{id}.pgn`, saves the positions locally, and marks each
one as seen when it is shown. When fewer than 20 % remain it prefetches the
next batch in the background; when none remain it fetches on demand. Offline
you keep whatever is saved and unseen; a connection is only needed to renew.
Requests go through the main process (`electron/net.cjs`), one at a time
with a one-second pause, and an HTTP 429 pauses the fetch for the time
Lichess asks (60 s by default) with a countdown in the panel. Lichess does not
publish numeric limits for these endpoints; a refresh is about ten requests
and happens roughly once per 4,000 positions, so this stays far inside its
"be reasonable" policy. The batch size can be tuned via the localStorage key
`chess-trainer:board-memory:lichess-target-games`.

### Blindfold Visualisation
A position is shown and 2, 4, 6 or 8 half-moves are given in notation only.
Picture the resulting position and answer three questions about it: what
stands on a square that changed (pick from a piece palette or "empty"), where
a piece that moved ended up (click the square), and whether a moved piece is
attacked or a king is in check (yes/no, or the Y and N keys). Each answer gets
immediate feedback; then the moves play out on the board with your answers
marked. In blindfold mode the start position disappears after ten seconds.
Sequences come from the Lichess pool (which stores ten continuation moves per
position, shared with Board Memory), the classic games, or the main lines of
your own openings.

The cards for Master Games, Engine Analysis and Endgame Drills are
placeholders for the next activities.

## Project layout

```
electron/            Main process: window, menu, IPC, native UCI engine bridge
  main.cjs
  net.cjs            Allowlisted outbound HTTP (lichess.org), one request at a time
  preload.cjs        The only bridge into the renderer (window.chessTrainer)
  engine.cjs         Spawns a UCI binary and streams its output over IPC
src/
  activities/        One folder per activity + registry.ts (home screen list)
    bullet-trainer/
    opening-trainer/ model.ts (tree), pgn.ts (import/export), srs.ts, store.ts,
                     editor, practice session
    board-memory/    positions.ts (sources + scoring), lichessPool.ts (500-game
                     batches, seen tracking, prefetch), stats.ts, BoardMemory.tsx
    visualisation/   exercise.ts (sequences + questions), sources.ts, Visualisation.tsx
  board/             Board.tsx: React wrapper around chessground (lichess board)
  chess/             Board geometry, single-piece drills, chess.js position helpers
  engine/            ChessEngine / EngineProvider contracts, UCI parser,
                     NativeUciEngine, provider registry
  games/             GameSource contract, PGN parsing (chess.js), source registry
  components/        AppShell (header, back button, fullscreen toggle), PiecePalette
  pages/             Home, ActivityPage (routes activities from the registry)
  lib/               platform bridge typing, storage, sounds, lichess API client
scripts/
  e2e-electron.mjs   End-to-end test that drives the app with real mouse input
```

## Extending

**Add an activity.** Create `src/activities/<name>/` with a page component and
an `ActivityDefinition` (`src/activities/types.ts`), then add it to the array
in `src/activities/registry.ts`. It appears on the home screen and gets its
route automatically. Use `<Board>` from `src/board/Board.tsx` for any board UI;
it takes a FEN, highlight map and an `onUserMove(orig, dest) => boolean`
callback that decides whether a move is accepted.

**Use or add an engine.** `listAvailableEngineProviders()` in `src/engine`
returns the providers that can run right now; the built-in one wraps the
bundled Stockfish (`NativeUciEngine` speaks UCI through the Electron bridge in
`electron/engine.cjs`). Call `create()`, then `setPosition()` and `go()` to
search. To add another engine, implement `ChessEngine` (`src/engine/types.ts`)
and register an `EngineProvider`; candidates are `stockfish.wasm` in a Web
Worker for the browser build, or a cloud evaluation API.

**Add master games.** Implement `GameSource` (`src/games/types.ts`) and call
`registerGameSource()`. `InMemoryPgnSource` is a working reference built from
PGN text, and `parsePgn()` turns a game into a list of moves with FENs before
and after each one, ready to step through on the board.

## Credits

Board UI by [chessground](https://github.com/lichess-org/chessground)
(GPL-3.0) and the cburnett piece set (CC BY-SA 3.0), both from lichess.
Move validation for PGN by [chess.js](https://github.com/jhlywa/chess.js).
