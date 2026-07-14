import { describe, expect, it } from 'vitest';
import type { KnowledgeAnalysis } from '../../types';
import { generateQuestions } from './index';

const analysis: KnowledgeAnalysis = {
  id: 'analysis-1',
  sourceId: 'source-1',
  strategy: 'Deep Understanding Mode',
  topics: ['强悍士气如何炼成'],
  concepts: [
    '士气不是口号鼓动，而是战略清晰、组织有力、利益绑定与心理求生共同作用的系统工程',
    '培养路径是压担子和任务式指挥',
    '容错本质是以胜利为唯一信仰的冒险驱动',
  ],
  logic: [
    '士气的关键不在顺境而在困局，当方向不明、资源枯竭、人心涣散时，不散队即是底线目标',
    '战略传递让队伍形成共同方向，任务式指挥把压力转化为个人主动性',
    '利益绑定和生存压力共同作用，才能让组织在逆境中保持行动',
  ],
  cases: ['湘江战役后队伍需要重新凝聚士气', '东北战场通过土改、剿匪、诉苦会重建组织信心'],
  applications: ['在新业务方向不明、团队压力大时，通过目标共识、任务分解、激励约束和复盘迭代稳定队伍'],
  controversies: ['高压管理如果缺少方向和利益绑定，可能导致反弹或队伍失去信任'],
  createdAt: new Date().toISOString(),
};

describe('generateQuestions', () => {
  it('generates non-duplicated questions with context hints for a 15-question set', () => {
    const questions = generateQuestions(analysis, 'exam', 15);
    const uniqueQuestions = new Set(questions.map((question) => question.question));

    expect(questions).toHaveLength(15);
    expect(uniqueQuestions.size).toBe(15);
    expect(questions.every((question) => question.contextHint && question.contextHint.length > 12)).toBe(true);
    expect(questions.some((question) => question.type === 'comparison' && question.question.includes('「') && question.question.includes('」'))).toBe(true);
  });

  it('generates choice questions up to 50 with options and answer keys', () => {
    const questions = generateQuestions(analysis, 'exam', 50, 'choice');

    expect(questions).toHaveLength(50);
    expect(questions.every((question) => question.format === 'choice')).toBe(true);
    expect(questions.every((question) => question.options?.length === 4)).toBe(true);
    expect(questions.every((question) => question.correctOptionIds?.length === 1)).toBe(true);
    expect(questions.every((question) => question.expectedAnswer.includes('正确答案'))).toBe(true);
  });
});
