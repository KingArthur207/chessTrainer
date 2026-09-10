import { lazy } from 'react';
import { Cpu } from 'lucide-react';
import type { ActivityDefinition } from '../types';

export const analysisBoard: ActivityDefinition = {
  id: 'analysis',
  title: 'Engine Analysis',
  tagline: 'Any position, any line, Stockfish thinking alongside you.',
  category: 'Technique and study',
  description: 'Set up a position or paste a game, play moves for either side, step through the history and watch the engine\'s lines update live.',
  icon: Cpu,
  accent: '#5ad1d1',
  status: 'available',
  component: lazy(() => import('./AnalysisBoard')),
};
