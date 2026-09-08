import { lazy } from 'react';
import { Crown } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { summary } from './stats';

export const endgameDrills: ActivityDefinition = {
  id: 'endgames',
  title: 'Endgame Drills',
  tagline: 'Convert theoretical endgames against Stockfish, on a schedule.',
  description: 'Lucena, Philidor, king-and-pawn opposition, queen vs rook, bishop-and-knight mate and more. The engine verifies every move; each ending is spaced-repetition scheduled.',
  icon: Crown,
  accent: '#7ee787',
  status: 'available',
  component: lazy(() => import('./EndgameDrills')),
  summary,
};
