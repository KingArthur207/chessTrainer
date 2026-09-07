import { lazy } from 'react';
import { Zap } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { getBest } from './stats';

export const bulletTrainer: ActivityDefinition = {
  id: 'bullet-trainer',
  title: 'Bullet Trainer',
  tagline: 'Move pieces to their targets as fast as you can.',
  description:
    'A timed reflex drill. Pieces appear one at a time with a highlighted destination; move each one there before the clock runs out.',
  icon: Zap,
  accent: '#5aa9ff',
  status: 'available',
  component: lazy(() => import('./BulletTrainer')),
  summary: () => {
    const best = getBest(60);
    return best ? `Best: ${best.solved} in 1 min` : null;
  },
};
