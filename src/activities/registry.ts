// The single list the home screen and router read. Add new activities here.
import { analysisBoard } from './analysis';
import { boardMemory } from './board-memory';
import { boardVision } from './board-vision';
import { bulletTrainer } from './bullet-trainer';
import { candidateDrill } from './candidates';
import { endgameDrills } from './endgames';
import { evaluationTrainer } from './evaluation';
import { masterGames } from './master-games';
import { openingTrainer } from './opening-trainer';
import { repertoirePlay } from './repertoire-play';
import { visualisation } from './visualisation';
import type { ActivityDefinition } from './types';

export const activities: ActivityDefinition[] = [
  bulletTrainer,
  boardVision,
  openingTrainer,
  repertoirePlay,
  boardMemory,
  visualisation,
  evaluationTrainer,
  candidateDrill,
  endgameDrills,
  masterGames,
  analysisBoard,
];

export function getActivity(id: string | undefined): ActivityDefinition | undefined {
  return activities.find((a) => a.id === id);
}
