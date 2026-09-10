import { lazy } from 'react';
import { Swords } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getHistory, summarise } from './stats';

export const repertoirePlay: ActivityDefinition = {
  id: 'repertoire-play',
  title: 'Play the Opening',
  tagline: 'Play your repertoire out against Stockfish, past the end of the book.',
  category: 'Openings',
  description: 'Start anywhere in your opening tree; the opponent follows your book while in theory, then the engine takes over at a strength you choose. Review grades every move.',
  icon: Swords,
  accent: '#f2a65a',
  status: 'available',
  component: lazy(() => import('./RepertoirePlay')),
  summary: () => {
    const s = summarise(getHistory());
    if (s.games === 0) return null;
    return `${s.games} ${s.games === 1 ? 'game' : 'games'} · ${s.avgErrors.toFixed(1)} errors per game`;
  },
};
