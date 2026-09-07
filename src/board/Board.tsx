// React wrapper around chessground (lichess's board UI). It owns sizing
// (always a square that fits its container), user-move validation, and custom
// square highlights. Everything chess-rule related is decided by the caller
// through `dests` and `onUserMove`, so this component is reusable for any
// activity.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key, Piece } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './board.css';

export type { DrawShape, Key, Piece };

/** Imperative extras for editor-style boards (see Board Memory). */
export interface BoardHandle {
  /** Start dragging a brand-new piece from outside the board, e.g. a palette. */
  dragNewPiece(piece: Piece, event: MouseEvent | TouchEvent): void;
  /** Current piece placement (FEN placement field). */
  getFen(): string;
}

export interface BoardProps {
  /** Piece placement (full FEN or just the placement field). */
  fen: string;
  orientation?: 'white' | 'black';
  /** Show file/rank labels (default true). */
  coordinates?: boolean;
  /** When false, pieces cannot be moved. */
  interactive?: boolean;
  /** Map of square -> CSS class rendered under the pieces (see board.css). */
  highlights?: Map<Key, string>;
  lastMove?: [Key, Key];
  /**
   * Legal destinations per origin square. When given, any other move snaps
   * back silently without reaching `onUserMove`; when omitted, every move is
   * allowed (the caller decides).
   */
  dests?: Map<Key, Key[]>;
  /** Show destination dots for the selected piece (needs `dests`). */
  showDests?: boolean;
  /** Arrows and circles drawn over the board. */
  shapes?: DrawShape[];
  turnColor?: 'white' | 'black';
  /** Highlight the king of `turnColor` as in check. */
  check?: boolean;
  /** Animate position changes (e.g. a reply played by the app). */
  animateChanges?: boolean;
  /**
   * Called when the user completes a move. Return `true` to accept it; return
   * `false` and the piece snaps back to `fen`.
   */
  onUserMove?: (orig: Key, dest: Key) => boolean;
  /** Dragging a piece off the board removes it (editor mode). */
  deleteOnDropOff?: boolean;
  /** Fires after the user changed the pieces: a move, a drop-off, a new piece. */
  onChange?: (fen: string) => void;
  /** Fires when the user presses on any square, occupied or not. */
  onSquareSelect?: (key: Key) => void;
  /** Extra classes on the outer frame (e.g. "is-miss" flashes a red ring). */
  frameClassName?: string;
  animationMs?: number;
}

const EMPTY_HIGHLIGHTS = new Map<Key, string>();
const NO_SHAPES: DrawShape[] = [];
/**
 * A drop whose pointer overshoots the board edge by up to this fraction of a
 * square still lands on the edge square. Drops inside the board are untouched.
 */
const EDGE_TOLERANCE = 0.35;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(
  {
    fen,
    orientation = 'white',
    coordinates = true,
    interactive = true,
    highlights = EMPTY_HIGHLIGHTS,
    lastMove,
    dests,
    showDests = false,
    shapes = NO_SHAPES,
    turnColor,
    check = false,
    animateChanges = false,
    onUserMove,
    deleteOnDropOff = false,
    onChange,
    onSquareSelect,
    frameClassName = '',
    animationMs = 120,
  },
  ref,
) {
  const frameRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const fenRef = useRef(fen);
  const lastMoveRef = useRef(lastMove);
  const destsRef = useRef(dests);
  const turnColorRef = useRef(turnColor);
  const onUserMoveRef = useRef(onUserMove);
  const onChangeRef = useRef(onChange);
  const onSquareSelectRef = useRef(onSquareSelect);
  fenRef.current = fen;
  lastMoveRef.current = lastMove;
  destsRef.current = dests;
  turnColorRef.current = turnColor;
  onUserMoveRef.current = onUserMove;
  onChangeRef.current = onChange;
  onSquareSelectRef.current = onSquareSelect;
  const lastMoveKey = lastMove ? lastMove[0] + lastMove[1] : '';

  useImperativeHandle(
    ref,
    () => ({
      dragNewPiece: (piece, event) => apiRef.current?.dragNewPiece(piece, event, true),
      getFen: () => apiRef.current?.getFen() ?? fenRef.current,
    }),
    [],
  );

  // Create the board once.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const config: Config = {
      fen,
      orientation,
      turnColor,
      check,
      lastMove,
      coordinates,
      disableContextMenu: true,
      // Never `viewOnly`: chessground binds its pointer handlers only on the
      // first render and skips them when viewOnly is set, so locking is done
      // by toggling movability instead (see the `interactive` effect).
      viewOnly: false,
      animation: { enabled: true, duration: animationMs },
      highlight: { lastMove: true, check: true, custom: highlights },
      movable: {
        free: !dests,
        dests,
        color: interactive ? 'both' : undefined,
        showDests,
        events: {
          after: (orig, dest) => {
            const accepted = onUserMoveRef.current?.(orig, dest) ?? true;
            if (!accepted && apiRef.current) {
              // chessground has already applied the move, cleared `dests` and
              // flipped the turn; restore all three so the user can try again.
              apiRef.current.set({
                fen: fenRef.current,
                lastMove: lastMoveRef.current,
                turnColor: turnColorRef.current,
                movable: { dests: destsRef.current },
              });
            }
          },
        },
      },
      premovable: { enabled: false },
      draggable: { enabled: interactive, showGhost: true, autoDistance: true, deleteOnDropOff },
      selectable: { enabled: interactive },
      drawable: { enabled: false, visible: true },
      events: {
        change: () => {
          if (apiRef.current) onChangeRef.current?.(apiRef.current.getFen());
        },
        select: (key) => onSquareSelectRef.current?.(key),
      },
    };
    const api = Chessground(el, config);
    apiRef.current = api;
    // Dev-only hook so automated tests can drive the board (e.g. enable
    // `trustAllEvents` and dispatch synthetic pointer events).
    if (import.meta.env.DEV) (window as unknown as { __board?: Api }).__board = api;

    // Edge tolerance: chessground resolves a drop from the pointer position,
    // so overshooting the board by a few pixels cancels the move. These
    // capture-phase handlers run before chessground's own and pull a near-miss
    // back onto the edge square. Pointers inside the board are left alone.
    const nearMiss = (x: number, y: number): [number, number] | null => {
      const b = el.getBoundingClientRect();
      if (b.width === 0) return null;
      const inside = x >= b.left && x < b.right && y >= b.top && y < b.bottom;
      if (inside) return null;
      const tol = (b.width / 8) * EDGE_TOLERANCE;
      if (x < b.left - tol || x >= b.right + tol || y < b.top - tol || y >= b.bottom + tol) return null;
      // Whole pixels, at least one inside: event coordinates are integers.
      return [clamp(Math.round(x), Math.ceil(b.left) + 1, Math.floor(b.right) - 2), clamp(Math.round(y), Math.ceil(b.top) + 1, Math.floor(b.bottom) - 2)];
    };
    const onMouseUp = (e: MouseEvent) => {
      // Only real pointer events are adjusted; the substitute below is not.
      if (!e.isTrusted) return;
      const cur = api.state.draggable.current;
      if (!cur || !cur.started) return;
      const fixed = nearMiss(e.clientX, e.clientY);
      if (!fixed) return;
      e.stopImmediatePropagation();
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: fixed[0], clientY: fixed[1], button: e.button, buttons: 0 }),
      );
    };
    const onTouchEnd = () => {
      const cur = api.state.draggable.current;
      if (!cur || !cur.started) return;
      // touchend carries no position; chessground falls back to the last one.
      const fixed = nearMiss(cur.pos[0], cur.pos[1]);
      if (fixed) cur.pos = fixed;
    };
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('touchend', onTouchEnd, true);

    return () => {
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      api.destroy();
      apiRef.current = null;
      if (import.meta.env.DEV) delete (window as unknown as { __board?: Api }).__board;
    };
    // Initial config only; later changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position changes. By default the animation is skipped so a brand-new
  // position appears instantly instead of pieces "flying" between puzzles;
  // `animateChanges` opts in for real moves.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.set({
      fen,
      lastMove: lastMoveRef.current,
      turnColor,
      check,
      animation: { enabled: animateChanges, duration: animationMs },
    });
    if (!animateChanges) api.set({ animation: { enabled: true, duration: animationMs } });
  }, [fen, lastMoveKey, turnColor, check, animateChanges, animationMs]);

  useEffect(() => {
    apiRef.current?.set({ orientation, highlight: { custom: highlights } });
  }, [orientation, highlights]);

  useEffect(() => {
    apiRef.current?.set({ movable: { free: !dests, dests, showDests } });
  }, [dests, showDests]);

  useEffect(() => {
    apiRef.current?.setAutoShapes(shapes);
  }, [shapes]);

  useEffect(() => {
    apiRef.current?.set({ draggable: { deleteOnDropOff } });
  }, [deleteOnDropOff]);

  // Coordinates are part of the wrapper markup, so toggling needs a redraw.
  const coordinatesRef = useRef(coordinates);
  useEffect(() => {
    if (coordinatesRef.current === coordinates) return;
    coordinatesRef.current = coordinates;
    const api = apiRef.current;
    if (!api) return;
    api.set({ coordinates });
    api.redrawAll();
  }, [coordinates]);

  // Lock/unlock by toggling movability rather than viewOnly (see above).
  useEffect(() => {
    apiRef.current?.set({
      movable: { color: interactive ? 'both' : undefined },
      draggable: { enabled: interactive },
      selectable: { enabled: interactive },
    });
  }, [interactive]);

  // Keep the board a square that fills the frame, snapped to a multiple of 8px
  // so square edges stay crisp. chessground watches the wrapper with its own
  // ResizeObserver and repositions pieces itself.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const el = boardRef.current;
    if (!frame || !el) return;
    let raf = 0;
    const apply = () => {
      const { width, height } = frame.getBoundingClientRect();
      const size = Math.max(160, Math.floor(Math.min(width, height) / 8) * 8);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.setProperty('--cg-size', `${size}px`);
      // chessground caches the board rectangle; drop it so a pointer event
      // arriving before its own ResizeObserver fires still maps to squares.
      apiRef.current?.state.dom.bounds.clear();
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    ro.observe(frame);
    apply();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={frameRef} className={`board-frame ${frameClassName}`}>
      <div ref={boardRef} className="cg-wrap" />
    </div>
  );
});
