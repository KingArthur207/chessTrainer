import { lazy } from 'react';
import { Gauge } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getHistory, summarise } from './stats';

export const evaluationTrainer: ActivityDefinition = {
  id: 'evaluation',
  title: 'Evaluation Trainer',
  tagline: 'Who is better, and by how much? Then check with Stockfish.',
  description: 'Assess positions on a seven-step scale and compare with the engine\'s score, best move and main line.',
  icon: Gauge,
  accent: '#ffb86c',
  status: 'available',
  component: lazy(() => import('./EvaluationTrainer')),
  summary: () => {
    const s = summarise(getHistory());
    if (s.attempts === 0) return null;
    return `Exact ${Math.round(s.exact * 100)}% · within one ${Math.round(s.close * 100)}% over ${s.attempts}`;
  },
};
