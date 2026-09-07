import { useCallback, useEffect, useState } from 'react';
import { createOpening, type Opening, type Side } from './model';
import { OpeningEditor } from './OpeningEditor';
import { OpeningLibrary } from './OpeningLibrary';
import { PracticeSession } from './PracticeSession';
import type { LineProgress } from './srs';
import { loadOpenings, loadProgress, saveOpenings, saveProgress, type ProgressTable } from './store';
import './opening-trainer.css';

type View = { kind: 'library' } | { kind: 'edit'; id: string } | { kind: 'practice'; id: string; mode: 'due' | 'all' };

export default function OpeningTrainer() {
  const [openings, setOpenings] = useState<Opening[]>(() => loadOpenings());
  const [progress, setProgress] = useState<ProgressTable>(() => loadProgress());
  const [view, setView] = useState<View>({ kind: 'library' });

  useEffect(() => saveOpenings(openings), [openings]);
  useEffect(() => saveProgress(progress), [progress]);

  const create = useCallback((name: string, color: Side) => {
    const opening = createOpening(name, color);
    setOpenings((prev) => [...prev, opening]);
    setView({ kind: 'edit', id: opening.id });
  }, []);

  const updateOpening = useCallback((opening: Opening) => {
    setOpenings((prev) => prev.map((o) => (o.id === opening.id ? opening : o)));
  }, []);

  const remove = useCallback((id: string) => {
    setOpenings((prev) => prev.filter((o) => o.id !== id));
    setProgress((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const recordProgress = useCallback((openingId: string, lineKey: string, p: LineProgress) => {
    setProgress((prev) => ({ ...prev, [openingId]: { ...(prev[openingId] ?? {}), [lineKey]: p } }));
  }, []);

  const toLibrary = useCallback(() => setView({ kind: 'library' }), []);

  if (view.kind === 'edit') {
    const opening = openings.find((o) => o.id === view.id);
    if (!opening) return <OpeningLibrary openings={openings} progress={progress} onCreate={create} onDelete={remove} onEdit={(id) => setView({ kind: 'edit', id })} onPractice={(id, mode) => setView({ kind: 'practice', id, mode })} />;
    return (
      <OpeningEditor
        opening={opening}
        onChange={updateOpening}
        onBack={toLibrary}
        onPractice={() => setView({ kind: 'practice', id: opening.id, mode: 'all' })}
      />
    );
  }

  if (view.kind === 'practice') {
    const opening = openings.find((o) => o.id === view.id);
    if (opening) {
      return (
        <PracticeSession
          key={`${opening.id}-${view.mode}`}
          opening={opening}
          progress={progress[opening.id] ?? {}}
          mode={view.mode}
          onProgress={(key, p) => recordProgress(opening.id, key, p)}
          onExit={toLibrary}
          onEdit={() => setView({ kind: 'edit', id: opening.id })}
        />
      );
    }
  }

  return (
    <OpeningLibrary
      openings={openings}
      progress={progress}
      onCreate={create}
      onDelete={remove}
      onEdit={(id) => setView({ kind: 'edit', id })}
      onPractice={(id, mode) => setView({ kind: 'practice', id, mode })}
    />
  );
}
