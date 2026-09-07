import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ActivityStatus = 'available' | 'coming-soon';

/**
 * Everything the home screen and router need to know about an activity.
 * To add a new activity: create a folder under src/activities, export a
 * definition like this one, and push it into src/activities/registry.ts.
 */
export interface ActivityDefinition {
  /** URL-safe unique id, e.g. "bullet-trainer". */
  id: string;
  title: string;
  /** One-liner shown on the home card. */
  tagline: string;
  /** A sentence or two of detail. */
  description: string;
  icon: LucideIcon;
  /** CSS colour used for the card accent. */
  accent: string;
  status: ActivityStatus;
  /** Lazy-loaded page component. Required when status is "available". */
  component?: LazyExoticComponent<ComponentType>;
  /** Optional short stat line for the card, e.g. "Best: 42 in 60s". */
  summary?: () => string | null;
}
