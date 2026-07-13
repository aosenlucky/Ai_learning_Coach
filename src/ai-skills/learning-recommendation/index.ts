import type { Evaluation, LearningInsight, LearningRecommendation, KnowledgeAnalysis } from '../../types';
import { average, uniqueList } from '../../lib/text';

export function buildLearningRecommendation(
  analysis: KnowledgeAnalysis,
  evaluations: Evaluation[],
): LearningRecommendation {
  const avg = average(evaluations.map((evaluation) => evaluation.score));
  const missing = uniqueList(evaluations.flatMap((evaluation) => evaluation.missingPoints), 6);
  const weak = uniqueList(evaluations.flatMap((evaluation) => evaluation.weaknesses), 6);

  return {
    mastery: avg >= 85 ? '已经能稳定理解并迁移应用核心知识。' : avg >= 70 ? '核心理解已建立，但应用和批判表达还需要强化。' : '仍处在概念搭建阶段，需要回到材料重建知识结构。',
    gaps: weak.length ? weak : ['高挑战场景下的迁移表达还可以继续打磨'],
    supplements: missing.length
      ? missing.map((point) => `补充复盘：${point}`)
      : analysis.concepts.slice(0, 3).map((point) => `重新组织：${point}`),
    practiceTasks: [
      `用 ${analysis.strategy} 重新写一版 5 分钟表达稿。`,
      '选择一个真实工作场景，写出目标、步骤、指标和风险边界。',
    ],
    nextReviewFocus: uniqueList([...analysis.applications, ...analysis.controversies, ...analysis.logic], 4),
  };
}

export function buildLearningInsight(
  analysis: KnowledgeAnalysis,
  recommendation: LearningRecommendation,
): LearningInsight {
  return {
    topic: analysis.topics[0] ?? '当前主题',
    weakPoints: recommendation.gaps,
    addedUnderstanding: recommendation.supplements,
    applicationAdvice: recommendation.practiceTasks,
  };
}
