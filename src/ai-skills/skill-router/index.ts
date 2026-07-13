import type { LearningSource, StrategyMode } from '../../types';

export function routeSkillStrategy(source: Pick<LearningSource, 'type'>): StrategyMode {
  switch (source.type) {
    case 'meeting':
      return 'Business Application Mode';
    case 'book':
      return 'Deep Understanding Mode';
    case 'technical-doc':
      return 'Technical Mastery Mode';
    case 'client-proposal':
      return 'Executive Expression Mode';
    case 'article':
    case 'video-course':
    default:
      return 'Deep Understanding Mode';
  }
}
