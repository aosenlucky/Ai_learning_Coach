import { describe, expect, it } from 'vitest';
import type { Question } from '../../types';
import { evaluateAnswer } from './index';

const question: Question = {
  id: 'q1',
  setId: 'set1',
  type: 'principle',
  bloomLevel: 'Analyze',
  difficulty: 4,
  knowledgePoint: '士气的关键不在顺境而在困局',
  question: '请拆解这条因果链：为什么困局会影响士气锻造？',
  contextHint: '材料提示：当方向不明、资源枯竭、人心涣散时，不散队即是底线目标。',
  expectedAnswer: '参考答案应说明方向不明、资源枯竭、人心涣散会导致队伍失去行动一致性，因此需要战略传递、任务分解、利益绑定和纪律约束共同作用。',
  evaluationCriteria: ['说明原因', '说明机制', '说明结果'],
  reviewScore: 95,
};

describe('evaluateAnswer', () => {
  it('marks blank answers as not answered', () => {
    const evaluation = evaluateAnswer(question, { questionId: question.id, answer: '' });

    expect(evaluation.score).toBe(0);
    expect(evaluation.weaknesses.join('')).toContain('留空');
    expect(evaluation.missingPoints[0]).toContain('参考答案');
  });

  it('marks confusion-only answers as ineffective instead of generic feedback', () => {
    const evaluation = evaluateAnswer(question, { questionId: question.id, answer: '这种题目让我不知道该怎么回答。' });

    expect(evaluation.score).toBeLessThanOrEqual(28);
    expect(evaluation.weaknesses.join('')).toContain('还没有真正完成作答');
  });
});
