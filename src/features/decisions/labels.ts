import type { DecisionCategory, DecisionStatus, OutcomeReview } from '@/domain/types';

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  considering: 'Considering',
  decided: 'Decided',
  completed: 'Completed',
  reviewed: 'Reviewed',
};

export const STATUS_TONE: Record<DecisionStatus, 'neutral' | 'accent' | 'good' | 'warn'> = {
  considering: 'warn',
  decided: 'accent',
  completed: 'accent',
  reviewed: 'good',
};

export const CATEGORY_LABEL: Record<DecisionCategory, string> = {
  purchase: 'Purchase',
  travel: 'Travel',
  financial: 'Financial',
  equipment: 'Engineering equipment',
  career: 'Career',
  lifestyle: 'Lifestyle',
  experience: 'Experience',
  other: 'Other',
};

export const EXPECTATIONS_LABEL: Record<OutcomeReview['expectationsMet'], string> = {
  exceeded: 'Exceeded expectations',
  met: 'Met expectations',
  partly: 'Partly met',
  not: 'Did not meet expectations',
};
