// Opening repertoire data model: a tree of moves per opening, plus pure
// helpers to walk and edit it. Persistence lives in store.ts.
import type { Key } from 'chessground/types';
import { START_FEN } from '@/chess/position';

export type Side = 'white' | 'black';

export interface TreeNode {
  id: string;
  /** SAN of the move that leads to this node ("" for the root). */
  san: string;
  /** UCI of the move ("" for the root). */
  uci: string;
  /** Position after the move. */
  fen: string;
  comment?: string;
  /** First child is the main line; the rest are alternatives. */
  children: TreeNode[];
}

export interface Opening {
  id: string;
  name: string;
  /** The side the user plays and is quizzed on. */
  color: Side;
  createdAt: string;
  updatedAt: string;
  root: TreeNode;
}

/** A complete line from the root to a leaf. */
export interface Line {
  /** Stable identity: UCI moves joined by spaces. */
  key: string;
  /** Nodes after the root, in order. */
  nodes: TreeNode[];
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function createRoot(fen: string = START_FEN): TreeNode {
  return { id: newId(), san: '', uci: '', fen, children: [] };
}

export function createOpening(name: string, color: Side): Opening {
  const now = new Date().toISOString();
  return { id: newId(), name: name.trim(), color, createdAt: now, updatedAt: now, root: createRoot() };
}

export function isRoot(node: TreeNode): boolean {
  return node.uci === '';
}

/** Child of `node` reached by this UCI move, if any. */
export function childByUci(node: TreeNode, uci: string): TreeNode | undefined {
  return node.children.find((c) => c.uci === uci);
}

/** Root-to-node path (inclusive) for a node id, or null if absent. */
export function pathToNode(root: TreeNode, id: string): TreeNode[] | null {
  const stack: TreeNode[][] = [[root]];
  while (stack.length) {
    const path = stack.pop()!;
    const last = path[path.length - 1];
    if (last.id === id) return path;
    for (const child of last.children) stack.push([...path, child]);
  }
  return null;
}

/** Every root-to-leaf line, main lines first. */
export function leafLines(root: TreeNode): Line[] {
  const lines: Line[] = [];
  const walk = (node: TreeNode, trail: TreeNode[]) => {
    if (node.children.length === 0) {
      if (trail.length > 0) lines.push({ key: lineKey(trail), nodes: trail });
      return;
    }
    for (const child of node.children) walk(child, [...trail, child]);
  };
  walk(root, []);
  return lines;
}

export function lineKey(nodes: TreeNode[]): string {
  return nodes.map((n) => n.uci).join(' ');
}

export function countMoves(root: TreeNode): number {
  let n = 0;
  const walk = (node: TreeNode) => {
    for (const c of node.children) {
      n++;
      walk(c);
    }
  };
  walk(root);
  return n;
}

/** Human-readable SAN sequence with move numbers, e.g. "1.e4 c5 2.Nf3". */
export function lineToSan(nodes: TreeNode[], startFen: string = START_FEN): string {
  const parts: string[] = [];
  let fenBefore = startFen;
  nodes.forEach((n, i) => {
    const white = fenBefore.split(' ')[1] === 'w';
    const num = Number(fenBefore.split(' ')[5] ?? 1);
    if (white) parts.push(`${num}.${n.san}`);
    else parts.push(i === 0 ? `${num}...${n.san}` : n.san);
    fenBefore = n.fen;
  });
  return parts.join(' ');
}

// ---- Immutable-ish editing helpers ------------------------------------------
// The tree is mutated in place for simplicity; callers clone the opening
// object (spread) so React notices the change.

export function addChild(parent: TreeNode, move: { san: string; uci: string; fen: string }): TreeNode {
  const existing = childByUci(parent, move.uci);
  if (existing) return existing;
  const node: TreeNode = { id: newId(), san: move.san, uci: move.uci, fen: move.fen, children: [] };
  parent.children.push(node);
  return node;
}

/** Remove `child` (and its subtree) from `parent`. */
export function removeChild(parent: TreeNode, childId: string): boolean {
  const idx = parent.children.findIndex((c) => c.id === childId);
  if (idx < 0) return false;
  parent.children.splice(idx, 1);
  return true;
}

/** Make `child` the main line of `parent` (move it to index 0). */
export function promoteChild(parent: TreeNode, childId: string): boolean {
  const idx = parent.children.findIndex((c) => c.id === childId);
  if (idx <= 0) return false;
  const [node] = parent.children.splice(idx, 1);
  parent.children.unshift(node);
  return true;
}

export function lastNode(path: TreeNode[]): TreeNode {
  return path[path.length - 1];
}

export function lastMoveOf(path: TreeNode[]): [Key, Key] | undefined {
  const node = lastNode(path);
  if (isRoot(node)) return undefined;
  return [node.uci.slice(0, 2) as Key, node.uci.slice(2, 4) as Key];
}
