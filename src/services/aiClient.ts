import type {
  Evaluation,
  KnowledgeAnalysis,
  LearningMode,
  LearningRecommendation,
  LearningReport,
  LearningSource,
  Question,
  QuestionSet,
  SkillResult,
  UserAnswer,
} from '../types';
import { createId } from '../lib/id';
import { average } from '../lib/text';
import { analyzeKnowledge } from '../ai-skills/knowledge-analyzer';
import { generateQuestions } from '../ai-skills/question-generator';
import { evaluateAnswer } from '../ai-skills/answer-evaluator';
import { buildLearningInsight, buildLearningRecommendation } from '../ai-skills/learning-recommendation';

const endpoint = (import.meta.env.VITE_AI_ENDPOINT as string | undefined) ?? '/api/ai';
const remoteEnabled = import.meta.env.VITE_USE_REMOTE_AI === 'true';

async function callRemote<T>(skill: string, input: unknown): Promise<T | null> {
  if (!remoteEnabled) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill, input }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: T };
    return payload.data ?? null;
  } catch {
    return null;
  }
}

export async function runKnowledgeAnalysis(source: LearningSource): Promise<SkillResult<KnowledgeAnalysis>> {
  const remote = await callRemote<KnowledgeAnalysis>('knowledge-analyzer', { source });
  if (remote) return { data: remote, usedRemote: true };
  return { data: analyzeKnowledge(source), usedRemote: false };
}

export async function runQuestionGeneration(
  source: LearningSource,
  analysis: KnowledgeAnalysis,
  mode: LearningMode,
  requestedCount?: number,
): Promise<SkillResult<QuestionSet>> {
  const remote = await callRemote<Question[]>('question-generator', { source, analysis, mode, requestedCount });
  const questions = remote ?? generateQuestions(analysis, mode, requestedCount);
  const setId = createId('qset');
  const questionSet: QuestionSet = {
    id: setId,
    sourceId: source.id,
    analysisId: analysis.id,
    mode,
    questionCount: questions.length,
    questions: questions.map((question) => ({ ...question, setId })),
    createdAt: new Date().toISOString(),
  };

  return { data: questionSet, usedRemote: Boolean(remote) };
}

export async function runAnswerEvaluation(
  questionSet: QuestionSet,
  answers: UserAnswer[],
): Promise<SkillResult<Evaluation[]>> {
  const remote = await callRemote<Evaluation[]>('answer-evaluator', { questionSet, answers });
  if (remote) return { data: remote, usedRemote: true };

  const data = questionSet.questions.map((question) => {
    const answer = answers.find((item) => item.questionId === question.id) ?? { questionId: question.id, answer: '' };
    return evaluateAnswer(question, answer);
  });

  return { data, usedRemote: false };
}

export async function runLearningReport(
  source: LearningSource,
  analysis: KnowledgeAnalysis,
  questionSet: QuestionSet,
  evaluations: Evaluation[],
): Promise<SkillResult<LearningReport>> {
  const remote = await callRemote<{
    recommendations: LearningRecommendation;
    report?: Partial<LearningReport>;
  }>('learning-recommendation', { source, analysis, questionSet, evaluations });

  const recommendations = remote?.recommendations ?? buildLearningRecommendation(analysis, evaluations);
  const report: LearningReport = {
    id: createId('report'),
    sourceId: source.id,
    questionSetId: questionSet.id,
    mode: questionSet.mode,
    score: average(evaluations.map((evaluation) => evaluation.score)),
    ability: {
      concept: average(evaluations.map((evaluation) => evaluation.ability.concept)),
      logic: average(evaluations.map((evaluation) => evaluation.ability.logic)),
      application: average(evaluations.map((evaluation) => evaluation.ability.application)),
      critical: average(evaluations.map((evaluation) => evaluation.ability.critical)),
      expression: average(evaluations.map((evaluation) => evaluation.ability.expression)),
    },
    strengths: [...new Set(evaluations.flatMap((evaluation) => evaluation.strengths))].slice(0, 4),
    weaknesses: [...new Set(evaluations.flatMap((evaluation) => evaluation.weaknesses))].slice(0, 4),
    recommendations,
    learningInsight: buildLearningInsight(analysis, recommendations),
    createdAt: new Date().toISOString(),
  };

  return { data: { ...report, ...remote?.report }, usedRemote: Boolean(remote) };
}
