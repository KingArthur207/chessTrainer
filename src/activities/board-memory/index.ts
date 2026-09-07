import { lazy } from 'react';
import { Brain } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getHistory, summarise } from './stats';

export const boardMemory: ActivityDefinition = {
  id: 'board-memory',
  title: 'Board Memory',
  tagline: 'Glimpse a position, then rebuild it from memory.',
  description:
    'Flash a real position for a few seconds, hide it, and reconstruct it piece by piece. Trains the chunked pattern memory strong players rely on.',
  icon: Brain,
  accent: '#c792ea',
  status: 'available',
  component: lazy(() => import('./BoardMemory')),
  summary: () => {
    const s = summarise(getHistory());
    if (s.attempts === 0) return null;
    return `Avg ${Math.round(s.recent * 100)}% over ${s.attempts} ${s.attempts === 1 ? 'position' : 'positions'}`;
  },
};
