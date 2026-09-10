import { lazy } from 'react';
import { Compass } from 'lucide-react';
import type { ActivityDefinition } from '../types';
import { summary } from './stats';

export const boardVision: ActivityDefinition = {
  id: 'board-vision',
  title: 'Board Vision',
  tagline: 'Square names, square colours and knight routes, against the clock.',
  category: 'Vision and reflexes',
  description: 'Three quick drills for knowing the board cold: find named squares without coordinates, call square colours blind, and route a knight past enemy pawns in the fewest moves.',
  icon: Compass,
  accent: '#8be9fd',
  status: 'available',
  component: lazy(() => import('./BoardVision')),
  summary,
};
