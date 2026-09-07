// Lichess-study style move list: main line inline, alternatives as indented
// ( variations ), comments in italics. Click a move to jump to it.
import { useEffect, useRef, type ReactNode } from 'react';
import { moveNumberPrefix } from '@/chess/position';
import type { TreeNode } from './model';

interface MoveTreeProps {
  root: TreeNode;
  currentId: string;
  onSelect: (node: TreeNode) => void;
}

export function MoveTree({ root, currentId, onSelect }: MoveTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.querySelector('.mt-move.is-current')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  const move = (parentFen: string, node: TreeNode, forceNumber: boolean): ReactNode => (
    <button
      key={node.id}
      type="button"
      className={`mt-move ${node.id === currentId ? 'is-current' : ''}`}
      onClick={() => onSelect(node)}
    >
      {moveNumberPrefix(parentFen, forceNumber)}
      {node.san}
    </button>
  );

  const comment = (node: TreeNode): ReactNode =>
    node.comment ? (
      <span key={`${node.id}-c`} className="mt-comment">
        {node.comment}
      </span>
    ) : null;

  /** Everything below `parent`, as a flat list of inline nodes. */
  const renderFrom = (parent: TreeNode, forceNumber: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let node = parent;
    let force = forceNumber;
    while (node.children.length > 0) {
      const [main, ...alts] = node.children;
      out.push(move(node.fen, main, force), comment(main));
      if (alts.length > 0) {
        out.push(
          <div key={`${main.id}-v`} className="mt-variations">
            {alts.map((alt) => (
              <div key={alt.id} className="mt-variation">
                <span className="mt-paren">(</span>
                {move(node.fen, alt, true)}
                {comment(alt)}
                {renderFrom(alt, !!alt.comment)}
                <span className="mt-paren">)</span>
              </div>
            ))}
          </div>,
        );
      }
      force = alts.length > 0 || !!main.comment;
      node = main;
    }
    return out;
  };

  return (
    <div ref={containerRef} className="ot__tree">
      {root.children.length === 0 ? (
        <span className="mt-empty">No moves yet. Play moves on the board or import PGN.</span>
      ) : (
        renderFrom(root, false)
      )}
    </div>
  );
}
