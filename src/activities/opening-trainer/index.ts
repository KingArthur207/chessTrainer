import { lazy } from 'react';
import { BookOpen } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { leafLines } from './model';
import { isDue } from './srs';
import { loadOpenings, loadProgress } from './store';

export const openingTrainer: ActivityDefinition = {
  id: 'opening-trainer',
  title: 'Opening Trainer',
  tagline: 'Build your repertoire and drill it with spaced repetition.',
  category: 'Openings',
  description:
    'Store theory per opening as a move tree (play moves or paste PGN), then practise: the app plays the other side and quizzes you on every move.',
  icon: BookOpen,
  accent: '#f2a65a',
  status: 'available',
  component: lazy(() => import('./OpeningTrainer')),
  summary: () => {
    const openings = loadOpenings();
    if (openings.length === 0) return null;
    const progress = loadProgress();
    let lines = 0;
    let due = 0;
    for (const op of openings) {
      for (const line of leafLines(op.root)) {
        lines++;
        if (isDue(progress[op.id]?.[line.key])) due++;
      }
    }
    return `${openings.length} ${openings.length === 1 ? 'opening' : 'openings'} · ${due} of ${lines} lines due`;
  },
};
