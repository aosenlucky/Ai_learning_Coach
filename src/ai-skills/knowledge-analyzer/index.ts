import type { KnowledgeAnalysis, LearningSource } from '../../types';
import { createId } from '../../lib/id';
import { pickTopTerms, splitSentences, uniqueList } from '../../lib/text';
import { routeSkillStrategy } from '../skill-router';

export function analyzeKnowledge(source: LearningSource): KnowledgeAnalysis {
  const sentences = splitSentences(source.content);
  const topTerms = pickTopTerms(`${source.topic} ${source.tags.join(' ')} ${source.content}`, 10);
  const conceptSignals = ['是', '不是', '概念', '价值', '区别', '边界', '定义'];
  const logicSignals = ['因为', '因此', '所以', '来自', '导致', '关键', '如果', '不一定'];
  const caseSignals = ['例如', '比如', '场景', '企业', '客户', '会议', '制造', 'CIO'];
  const applicationSignals = ['如何', '落地', '设计', '应用', '流程', '任务', '实践', '协作'];
  const controversySignals = ['是否', '不一定', '风险', '争议', '限制', '不能', '不是'];

  const bySignals = (signals: string[]) =>
    sentences.filter((sentence) => signals.some((signal) => sentence.includes(signal)));

  return {
    id: createId('analysis'),
    sourceId: source.id,
    strategy: routeSkillStrategy(source),
    topics: uniqueList([source.topic, ...source.tags, ...topTerms.slice(0, 3)], 6),
    concepts: uniqueList([...bySignals(conceptSignals), ...topTerms.map((term) => `${term} 的边界与作用`)], 8),
    logic: uniqueList(bySignals(logicSignals), 6),
    cases: uniqueList(bySignals(caseSignals), 5),
    applications: uniqueList(bySignals(applicationSignals), 6),
    controversies: uniqueList(bySignals(controversySignals), 4),
    createdAt: new Date().toISOString(),
  };
}
