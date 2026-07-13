import { describe, expect, it } from 'vitest';
import { routeSkillStrategy } from './index';

describe('routeSkillStrategy', () => {
  it('routes source type to the expected strategy mode', () => {
    expect(routeSkillStrategy({ type: 'meeting' })).toBe('Business Application Mode');
    expect(routeSkillStrategy({ type: 'book' })).toBe('Deep Understanding Mode');
    expect(routeSkillStrategy({ type: 'technical-doc' })).toBe('Technical Mastery Mode');
    expect(routeSkillStrategy({ type: 'client-proposal' })).toBe('Executive Expression Mode');
  });
});
