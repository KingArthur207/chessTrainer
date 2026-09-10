import { lazy } from 'react';
import { Eye } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getHistory, summarise } from './stats';

export const visualisation: ActivityDefinition = {
  id: 'visualisation',
  title: 'Blindfold Visualisation',
  tagline: 'Read the moves, picture the position, answer questions.',
  category: 'Calculation and memory',
  description:
    'A position and a short sequence of moves in notation only. Work out the resulting position in your head and answer questions about it; then watch the moves play out.',
  icon: Eye,
  accent: '#f78c6c',
  status: 'available',
  component: lazy(() => import('./Visualisation')),
  summary: () => {
    const s = summarise(getHistory());
    if (s.attempts === 0) return null;
    return `Avg ${Math.round(s.recent * 100)}% over ${s.attempts} ${s.attempts === 1 ? 'exercise' : 'exercises'}`;
  },
};
