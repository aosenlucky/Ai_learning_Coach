import type { Question } from '../../types';
import { clampScore } from '../../lib/text';

export function reviewQuestionQuality(question: Omit<Question, 'reviewScore'>): number {
  const knowledgeCoverage = question.knowledgePoint.length > 4 ? 20 : 12;
  const thoughtDepth = ['Analyze', 'Evaluate', 'Create', 'Apply'].includes(question.bloomLevel) ? 20 : 13;
  const applicationValue = question.type === 'scenario' || question.type === 'expression' ? 20 : 15;
  const avoidsRoteMemory = question.question.includes('什么是') ? 8 : 20;
  const criteriaClarity = question.evaluationCriteria.length >= 3 ? 20 : 12;

  return clampScore(knowledgeCoverage + thoughtDepth + applicationValue + avoidsRoteMemory + criteriaClarity);
}
