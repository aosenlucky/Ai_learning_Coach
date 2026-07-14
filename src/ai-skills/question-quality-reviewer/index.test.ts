import { describe, expect, it } from 'vitest';
import { reviewQuestionQuality } from './index';

describe('reviewQuestionQuality', () => {
  it('rewards application-oriented questions with clear criteria', () => {
    const score = reviewQuestionQuality({
      id: 'q1',
      setId: 'set1',
      format: 'open',
      type: 'scenario',
      bloomLevel: 'Apply',
      difficulty: 4,
      knowledgePoint: '流程重构带来的企业 AI 价值',
      question: '如果向制造企业 CIO 介绍 Agent 价值，你会如何设计交流逻辑？',
      expectedAnswer: '需要从业务瓶颈、流程嵌入、人机边界和试点指标展开。',
      evaluationCriteria: ['能识别业务瓶颈', '能说明流程嵌入', '能定义风险与指标'],
    });

    expect(score).toBeGreaterThanOrEqual(80);
  });
});
