import { lazy } from 'react';
import { ListOrdered } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getHistory, summarise } from './stats';

export const candidateDrill: ActivityDefinition = {
  id: 'candidates',
  title: 'Candidate Moves',
  tagline: 'Name three candidates, then see Stockfish\'s top three.',
  description: 'Enumerate the moves worth considering before looking for the best one, then compare with the engine\'s MultiPV ranking.',
  icon: ListOrdered,
  accent: '#a6e3a1',
  status: 'available',
  component: lazy(() => import('./CandidateDrill')),
  summary: () => {
    const s = summarise(getHistory());
    if (s.attempts === 0) return null;
    return `Best move ${Math.round(s.bestRate * 100)}% · ${s.avgOverlap.toFixed(1)}/3 hits over ${s.attempts}`;
  },
};
