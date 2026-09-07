// The single list the home screen and router read. Add new activities here.
import { Cpu, Crown, Library } from 'lucide-react';
import { boardMemory } from './board-memory';
import { boardVision } from './board-vision';
import { bulletTrainer } from './bullet-trainer';
import { candidateDrill } from './candidates';
import { evaluationTrainer } from './evaluation';
import { openingTrainer } from './opening-trainer';
import { visualisation } from './visualisation';
import type { ActivityDefinition } from './types';

export const activities: ActivityDefinition[] = [
  bulletTrainer,
  boardVision,
  openingTrainer,
  boardMemory,
  visualisation,
  evaluationTrainer,
  candidateDrill,
  {
    id: 'master-games',
    title: 'Master Games',
    tagline: 'Replay and guess-the-move through classic games.',
    description:
      'Step through annotated master games and test yourself by predicting the next move. Backed by the pluggable game-source layer.',
    icon: Library,
    accent: '#e06c9f',
    status: 'coming-soon',
  },
  {
    id: 'engine-analysis',
    title: 'Engine Analysis',
    tagline: 'Analyse positions with Stockfish.',
    description:
      'Evaluate positions, find your mistakes and explore lines with Stockfish or any UCI engine via the engine plugin layer.',
    icon: Cpu,
    accent: '#5ad1d1',
    status: 'coming-soon',
  },
  {
    id: 'endgame-drills',
    title: 'Endgame Drills',
    tagline: 'Convert winning endgames against the engine.',
    description: 'Practise fundamental endgames and technique against an engine opponent.',
    icon: Crown,
    accent: '#7ee787',
    status: 'coming-soon',
  },
];

export function getActivity(id: string | undefined): ActivityDefinition | undefined {
  return activities.find((a) => a.id === id);
}
