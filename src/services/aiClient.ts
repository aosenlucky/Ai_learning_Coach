import type {
  Evaluation,
  KnowledgeAnalysis,
  LearningMode,
  LearningRecommendation,
  LearningReport,
  LearningSource,
  Question,
  QuestionFormat,
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
const allowRemoteFallback = import.meta.env.VITE_ALLOW_REMOTE_FALLBACK === 'true';
const configuredRemoteEvaluationConcurrency = Number(import.meta.env.VITE_REMOTE_EVAL_CONCURRENCY ?? 1);
const remoteEvaluationConcurrency =
  Number.isFinite(configuredRemoteEvaluationConcurrency) && configuredRemoteEvaluationConcurrency > 0
    ? configuredRemoteEvaluationConcurrency
    : 1;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const asyncEvaluationEnabled = import.meta.env.VITE_USE_ASYNC_EVALUATION !== 'false';
const configuredAsyncEvaluationEndpoint = import.meta.env.VITE_ASYNC_EVALUATION_ENDPOINT as string | undefined;
const asyncEvaluationEndpoint =
  configuredAsyncEvaluationEndpoint?.trim() ||
  (supabaseUrl ? `${supabaseUrl}/functions/v1/evaluate-answer-job` : '');
const asyncEvaluationPollMs = Number(import.meta.env.VITE_ASYNC_EVALUATION_POLL_MS ?? 2500);
const asyncEvaluationTimeoutMs = Number(import.meta.env.VITE_ASYNC_EVALUATION_TIMEOUT_MS ?? 900000);

class RemoteAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteAiError';
  }
}

function compactRemoteMessage(message: string, fallback: string): string {
  const text = message
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, 500);
}

async function callRemote<T>(skill: string, input: unknown, required = false): Promise<T | null> {
  if (!remoteEnabled) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill, input }),
    });

    if (!response.ok) {
      const message = await response.text();
      if (required) throw new RemoteAiError(`${skill} 远程调用失败：${compactRemoteMessage(message, response.statusText)}`);
      return null;
    }
    const payload = (await response.json()) as { data?: T };
    if (!payload.data && required) throw new RemoteAiError(`${skill} 远程调用没有返回 data。`);
    return payload.data ?? null;
  } catch (error) {
    if (required) {
      if (error instanceof RemoteAiError) throw error;
      throw new RemoteAiError(`${skill} 远程调用异常：${error instanceof Error ? error.message : '未知错误'}`);
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getAsyncEvaluationHeaders(): HeadersInit {
  if (!supabaseAnonKey) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  };
}

async function callAsyncEvaluationJob<T>(body: unknown): Promise<T> {
  if (!asyncEvaluationEndpoint || !supabaseAnonKey) {
    throw new RemoteAiError('异步批改未配置：请设置 VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY，或 VITE_ASYNC_EVALUATION_ENDPOINT。');
  }

  const response = await fetch(asyncEvaluationEndpoint, {
    method: 'POST',
    headers: getAsyncEvaluationHeaders(),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: { error?: string } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: compactRemoteMessage(text, response.statusText) };
  }
  if (!response.ok) {
    throw new RemoteAiError(`异步批改任务失败：${payload.error ?? response.statusText}`);
  }
  return payload as T;
}

async function runAsyncEvaluationJob(questionSet: QuestionSet, answers: UserAnswer[]): Promise<Evaluation[]> {
  const started = await callAsyncEvaluationJob<{ jobId: string; status: string; progress: number; total: number }>({
    action: 'start',
    questionSet,
    answers,
  });
  const startedAt = Date.now();

  while (Date.now() - startedAt < asyncEvaluationTimeoutMs) {
    await sleep(asyncEvaluationPollMs);
    const status = await callAsyncEvaluationJob<{
      jobId: string;
      status: 'queued' | 'processing' | 'succeeded' | 'failed';
      progress: number;
      total: number;
      error?: string;
      evaluations?: Evaluation[];
    }>({
      action: 'status',
      jobId: started.jobId,
    });

    if (status.status === 'succeeded' && status.evaluations) return status.evaluations;
    if (status.status === 'failed') {
      throw new RemoteAiError(`异步批改任务失败：${status.error ?? '未知错误'}`);
    }
  }

  throw new RemoteAiError('异步批改任务等待超时，请稍后在历史记录中重试或检查 Supabase Function 日志。');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency || 1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function findAnswer(questionId: string, answers: UserAnswer[]): UserAnswer {
  return answers.find((item) => item.questionId === questionId) ?? { questionId, answer: '' };
}

async function evaluateOpenQuestionsRemotely(
  questionSet: QuestionSet,
  answers: UserAnswer[],
  required: boolean,
): Promise<Evaluation[]> {
  const openQuestions = questionSet.questions.filter((question) => question.format !== 'choice');
  const evaluations = await mapWithConcurrency(openQuestions, remoteEvaluationConcurrency, async (question) => {
    const answer = findAnswer(question.id, answers);
    const singleQuestionSet: QuestionSet = {
      ...questionSet,
      questionCount: 1,
      questions: [question],
    };
    const remote = await callRemote<Evaluation[]>(
      'answer-evaluator',
      { questionSet: singleQuestionSet, answers: [answer] },
      required,
    );
    const evaluation = remote?.[0];
    if (evaluation) return { ...evaluation, questionId: evaluation.questionId || question.id };
    if (required) throw new RemoteAiError(`answer-evaluator 没有返回第 ${question.id} 题的批改结果。`);
    return null;
  });

  return evaluations.filter((evaluation): evaluation is Evaluation => Boolean(evaluation));
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
  questionFormat: QuestionFormat = 'open',
): Promise<SkillResult<QuestionSet>> {
  const remoteRequired = remoteEnabled && !allowRemoteFallback;
  const remote = await callRemote<Question[]>(
    'question-generator',
    { source, analysis, mode, requestedCount, questionFormat },
    remoteRequired,
  );
  if (remoteRequired && (!remote || !remote.length)) {
    throw new RemoteAiError('question-generator 远程调用没有返回有效题目，已阻止本地模板题 fallback。');
  }
  const questions = remote?.length ? remote : generateQuestions(analysis, mode, requestedCount, questionFormat);
  const setId = createId('qset');
  const questionSet: QuestionSet = {
    id: setId,
    sourceId: source.id,
    analysisId: analysis.id,
    mode,
    questionFormat,
    questionCount: questions.length,
    questions: questions.map((question) => ({ ...question, format: question.format ?? questionFormat, setId })),
    createdAt: new Date().toISOString(),
  };

  return { data: questionSet, usedRemote: Boolean(remote) };
}

export async function runAnswerEvaluation(
  questionSet: QuestionSet,
  answers: UserAnswer[],
): Promise<SkillResult<Evaluation[]>> {
  const openQuestions = questionSet.questions.filter((question) => question.format !== 'choice');
  if (openQuestions.length && remoteEnabled) {
    if (asyncEvaluationEnabled) {
      const remote = await runAsyncEvaluationJob(questionSet, answers);
      const remoteByQuestionId = new Map(remote.map((evaluation) => [evaluation.questionId, evaluation]));
      const data = questionSet.questions.map((question) => {
        const answer = findAnswer(question.id, answers);
        return remoteByQuestionId.get(question.id) ?? evaluateAnswer(question, answer);
      });
      return { data, usedRemote: true };
    }

    const remote = await evaluateOpenQuestionsRemotely(questionSet, answers, !allowRemoteFallback);
    if (remote.length) {
      const remoteByQuestionId = new Map(remote.map((evaluation) => [evaluation.questionId, evaluation]));
      const data = questionSet.questions.map((question) => {
        const answer = findAnswer(question.id, answers);
        return remoteByQuestionId.get(question.id) ?? evaluateAnswer(question, answer);
      });
      return { data, usedRemote: true };
    }
  }

  const data = questionSet.questions.map((question) => {
    const answer = findAnswer(question.id, answers);
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
