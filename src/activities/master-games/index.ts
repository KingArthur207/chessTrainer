import { lazy } from 'react';
import { Library } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getHistory, summarise } from './stats';

export const masterGames: ActivityDefinition = {
  id: 'master-games',
  title: 'Master Games',
  tagline: 'Guess the move through classic and master games.',
  description: 'Play one side of a game and guess every move; score against the actual move and the engine\'s evaluation.',
  icon: Library,
  accent: '#e06c9f',
  status: 'available',
  component: lazy(() => import('./MasterGames')),
  summary: () => {
    const s = summarise(getHistory());
    if (s.sessions === 0) return null;
    return `Accuracy ${Math.round(s.accuracy * 100)}% · ${Math.round(s.matched * 100)}% game moves over ${s.sessions}`;
  },
};
