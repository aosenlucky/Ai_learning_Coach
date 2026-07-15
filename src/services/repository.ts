import type {
  AbilityScore,
  AppState,
  BloomLevel,
  Evaluation,
  KnowledgeAnalysis,
  LearningInsight,
  LearningMode,
  LearningRecommendation,
  LearningReport,
  LearningSource,
  Question,
  QuestionFormat,
  QuestionOption,
  QuestionSet,
  QuestionType,
  SourceType,
  StrategyMode,
  UserAnswer,
} from '../types';
import { sampleSource } from '../data/sample';
import { supabase } from '../lib/supabase';
import {
  mergeQuestionSets,
  normalizeQuestionSet,
  prepareStateForRemote,
  reconcileRecordGroups,
  recoverStateFromJobs,
} from './stateIntegrity';

const STORAGE_KEY = 'personal-ai-learning-coach-state';
const abilityKeys = ['concept', 'logic', 'application', 'critical', 'expression'] as const;

type DbRow = Record<string, unknown>;

export interface RemoteSyncResult {
  sources: number;
  analyses: number;
  questionSets: number;
  answers: number;
  evaluations: number;
  reports: number;
  repairedRecords: number;
  skippedRecords: number;
}

export const initialState: AppState = {
  sources: [sampleSource],
  analyses: [],
  questionSets: [],
  answers: {},
  evaluations: {},
  reports: [],
};

export function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialState;

  try {
    const parsed = JSON.parse(raw) as AppState;
    return {
      ...initialState,
      ...parsed,
      sources: parsed.sources?.length ? parsed.sources : [sampleSource],
      questionSets: Array.isArray(parsed.questionSets) ? parsed.questionSets.map(normalizeQuestionSet) : [],
    };
  } catch {
    return initialState;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function loadRemoteState(): Promise<AppState | null> {
  if (!supabase) return null;

  try {
    const [
      sourcesResponse,
      analysesResponse,
      questionSetsResponse,
      questionsResponse,
      answersResponse,
      evaluationsResponse,
      reportsResponse,
    ] = await Promise.all([
      supabase.from('learning_sources').select('*').order('created_at', { ascending: false }),
      supabase.from('knowledge_analysis').select('*').order('created_at', { ascending: true }),
      supabase.from('question_sets').select('*').order('created_at', { ascending: true }),
      supabase.from('questions').select('*').order('id', { ascending: true }),
      supabase.from('answers').select('*').order('created_at', { ascending: true }),
      supabase.from('evaluations').select('*').order('created_at', { ascending: true }),
      supabase.from('learning_reports').select('*').order('created_at', { ascending: true }),
    ]);

    const failedResponse = [
      sourcesResponse,
      analysesResponse,
      questionSetsResponse,
      questionsResponse,
      answersResponse,
      evaluationsResponse,
      reportsResponse,
    ].find((response) => response.error);

    if (failedResponse?.error) throw failedResponse.error;

    const sources = ((sourcesResponse.data ?? []) as DbRow[]).map(mapSourceRow);
    const analyses = ((analysesResponse.data ?? []) as DbRow[]).map(mapAnalysisRow);
    const questionsBySetId = groupQuestionsBySetId((questionsResponse.data ?? []) as DbRow[]);
    let questionSets = ((questionSetsResponse.data ?? []) as DbRow[]).map((row) => ({
      id: asString(row.id),
      sourceId: asString(row.source_id),
      analysisId: asString(row.analysis_id),
      mode: (asString(row.mode) || 'exam') as LearningMode,
      questionFormat: (asString(row.question_format) || 'open') as QuestionFormat,
      questionCount: asNumber(row.question_count),
      questions: questionsBySetId[asString(row.id)] ?? [],
      createdAt: asString(row.created_at),
    }));
    let recoveredAnswers: Record<string, UserAnswer[]> = {};
    let recoveredEvaluations: Record<string, Evaluation[]> = {};

    if (questionSets.some((questionSet) => questionSet.questionCount > questionSet.questions.length)) {
      const [evaluationJobsResponse, generationJobsResponse] = await Promise.all([
        supabase
          .from('evaluation_jobs')
          .select('id, request, result, status, created_at, completed_at')
          .order('created_at', { ascending: true }),
        supabase
          .from('question_generation_jobs')
          .select('id, request, result, status, created_at, completed_at')
          .order('created_at', { ascending: true }),
      ]);

      if (evaluationJobsResponse.error) console.warn('Failed to load evaluation jobs for recovery', evaluationJobsResponse.error);
      if (generationJobsResponse.error) console.warn('Failed to load generation jobs for recovery', generationJobsResponse.error);

      const recovered = recoverStateFromJobs(
        questionSets,
        (evaluationJobsResponse.data ?? []) as DbRow[],
        (generationJobsResponse.data ?? []) as DbRow[],
      );
      questionSets = recovered.questionSets;
      recoveredAnswers = recovered.answers;
      recoveredEvaluations = recovered.evaluations;
    }

    const storedAnswers = groupLatestAnswersBySetId((answersResponse.data ?? []) as DbRow[]);
    const storedEvaluations = groupLatestEvaluationsBySetId((evaluationsResponse.data ?? []) as DbRow[]);

    const mergedAnswers = mergeAnswerRecords(recoveredAnswers, storedAnswers);
    const mergedEvaluations = mergeEvaluationRecords(recoveredEvaluations, storedEvaluations);

    return {
      sources: sources.length ? sources : [sampleSource],
      analyses,
      questionSets,
      answers: reconcileRecordGroups(mergedAnswers, questionSets),
      evaluations: reconcileRecordGroups(mergedEvaluations, questionSets),
      reports: ((reportsResponse.data ?? []) as DbRow[]).map(mapReportRow),
    };
  } catch (error) {
    console.warn('Failed to load Supabase state', error);
    return null;
  }
}

export function mergeAppState(local: AppState, remote: AppState): AppState {
  const localSources = isOnlySampleSource(local.sources) && hasUserSources(remote.sources) ? [] : local.sources;
  const questionSets = mergeQuestionSets(local.questionSets, remote.questionSets).sort(sortByCreatedAtAsc);
  const answers = mergeAnswerRecords(local.answers, remote.answers);
  const evaluations = mergeEvaluationRecords(local.evaluations, remote.evaluations);

  return {
    sources: mergeById(localSources, remote.sources).sort(sortByCreatedAtDesc),
    analyses: mergeById(local.analyses, remote.analyses).sort(sortByCreatedAtAsc),
    questionSets,
    answers: reconcileRecordGroups(answers, questionSets),
    evaluations: reconcileRecordGroups(evaluations, questionSets),
    reports: mergeById(local.reports, remote.reports).sort(sortByCreatedAtAsc),
  };
}

export async function syncStateToRemote(state: AppState): Promise<RemoteSyncResult> {
  requireSupabaseClient();
  const prepared = prepareStateForRemote(state);
  const syncState = prepared.state;

  for (const source of syncState.sources) {
    await persistSource(source);
  }

  for (const analysis of syncState.analyses) {
    await persistAnalysis(analysis);
  }

  for (const questionSet of syncState.questionSets) {
    await persistQuestionSet(questionSet);
  }

  let answerCount = 0;
  let evaluationCount = 0;
  for (const questionSet of syncState.questionSets) {
    if (!questionSet.questions.length) continue;
    const questionSetId = questionSet.id;
    const hasLocalSession =
      Object.prototype.hasOwnProperty.call(syncState.answers, questionSetId) ||
      Object.prototype.hasOwnProperty.call(syncState.evaluations, questionSetId);
    if (!hasLocalSession) continue;
    const answers = syncState.answers[questionSetId] ?? [];
    const evaluations = syncState.evaluations[questionSetId] ?? [];
    await replaceStudySession(questionSetId, answers, evaluations);
    answerCount += answers.length;
    evaluationCount += evaluations.length;
  }

  for (const report of syncState.reports) {
    await persistReport(report);
  }

  const repairedRecords =
    prepared.stats.repairedQuestionIds +
    prepared.stats.repairedReferences +
    prepared.stats.clearedAnalysisReferences;
  const skippedRecords =
    prepared.stats.skippedAnalyses +
    prepared.stats.skippedQuestionSets +
    prepared.stats.skippedAnswers +
    prepared.stats.skippedEvaluations +
    prepared.stats.skippedReports;

  return {
    sources: syncState.sources.length,
    analyses: syncState.analyses.length,
    questionSets: syncState.questionSets.length,
    answers: answerCount,
    evaluations: evaluationCount,
    reports: syncState.reports.length,
    repairedRecords,
    skippedRecords,
  };
}

export async function persistSource(source: LearningSource): Promise<void> {
  if (!supabase) return;

  await runSupabase(
    supabase.from('learning_sources').upsert({
      id: source.id,
      title: source.title,
      type: source.type,
      topic: source.topic,
      content: source.content,
      tags: source.tags,
      learning_goal: source.goal,
      created_at: source.createdAt,
    }),
    '保存素材到 Supabase',
  );
}

export async function persistAnalysis(analysis: KnowledgeAnalysis): Promise<void> {
  if (!supabase) return;

  await runSupabase(
    supabase.from('knowledge_analysis').upsert({
      id: analysis.id,
      source_id: analysis.sourceId,
      strategy: analysis.strategy,
      topics: analysis.topics,
      concepts: analysis.concepts,
      logic: analysis.logic,
      cases: analysis.cases,
      applications: analysis.applications,
      controversies: analysis.controversies,
      created_at: analysis.createdAt,
    }),
    '保存知识分析到 Supabase',
  );
}

export async function persistQuestionSet(questionSet: QuestionSet): Promise<void> {
  if (!supabase) return;
  const normalizedQuestionSet = normalizeQuestionSet(questionSet);

  await runSupabase(
    supabase.from('question_sets').upsert({
      id: normalizedQuestionSet.id,
      source_id: normalizedQuestionSet.sourceId,
      analysis_id: normalizedQuestionSet.analysisId || null,
      mode: normalizedQuestionSet.mode,
      question_format: normalizedQuestionSet.questionFormat,
      question_count: normalizedQuestionSet.questionCount,
      created_at: normalizedQuestionSet.createdAt,
    }),
    '保存题集到 Supabase',
  );

  if (normalizedQuestionSet.questions.length) {
    await runSupabase(
      supabase.from('questions').upsert(
        normalizedQuestionSet.questions.map((question) => ({
          id: question.id,
          question_set_id: normalizedQuestionSet.id,
          format: question.format,
          type: question.type,
          bloom_level: question.bloomLevel,
          difficulty: question.difficulty,
          knowledge_point: question.knowledgePoint,
          question: question.question,
          context_hint: question.contextHint,
          options: question.options,
          correct_option_ids: question.correctOptionIds,
          explanation: question.explanation,
          expected_answer: question.expectedAnswer,
          evaluation_criteria: question.evaluationCriteria,
          review_score: question.reviewScore,
        })),
      ),
      '保存题目到 Supabase',
    );
  }
}

function mapSourceRow(row: DbRow): LearningSource {
  return {
    id: asString(row.id),
    title: asString(row.title),
    type: (asString(row.type) || 'article') as SourceType,
    topic: asString(row.topic) || asString(row.title),
    content: asString(row.content),
    tags: asStringArray(row.tags),
    goal: asString(row.learning_goal),
    createdAt: asString(row.created_at),
  };
}

function mapAnalysisRow(row: DbRow): KnowledgeAnalysis {
  return {
    id: asString(row.id),
    sourceId: asString(row.source_id),
    strategy: (asString(row.strategy) || 'Deep Understanding Mode') as StrategyMode,
    topics: asStringArray(row.topics),
    concepts: asStringArray(row.concepts),
    logic: asStringArray(row.logic),
    cases: asStringArray(row.cases),
    applications: asStringArray(row.applications),
    controversies: asStringArray(row.controversies),
    createdAt: asString(row.created_at),
  };
}

function mapQuestionRow(row: DbRow): Question {
  return {
    id: asString(row.id),
    setId: asString(row.question_set_id),
    format: (asString(row.format) || 'open') as QuestionFormat,
    type: (asString(row.type) || 'concept') as QuestionType,
    bloomLevel: (asString(row.bloom_level) || 'Understand') as BloomLevel,
    difficulty: asDifficulty(row.difficulty),
    knowledgePoint: asString(row.knowledge_point),
    question: asString(row.question),
    contextHint: optionalString(row.context_hint),
    options: asQuestionOptions(row.options),
    correctOptionIds: asStringArray(row.correct_option_ids),
    explanation: optionalString(row.explanation),
    expectedAnswer: asString(row.expected_answer),
    evaluationCriteria: asStringArray(row.evaluation_criteria),
    reviewScore: asNumber(row.review_score),
  };
}

function mapReportRow(row: DbRow): LearningReport {
  return {
    id: asString(row.id),
    sourceId: asString(row.source_id),
    questionSetId: asString(row.question_set_id),
    mode: (asString(row.mode) || 'exam') as LearningMode,
    score: asNumber(row.score),
    ability: asAbility(row.ability),
    strengths: asStringArray(row.strengths),
    weaknesses: asStringArray(row.weaknesses),
    recommendations: asRecommendations(row.recommendations),
    learningInsight: asLearningInsight(row.learning_insight),
    createdAt: asString(row.created_at),
  };
}

function groupQuestionsBySetId(rows: DbRow[]): Record<string, Question[]> {
  return rows.reduce<Record<string, Question[]>>((grouped, row) => {
    const question = mapQuestionRow(row);
    if (!question.setId) return grouped;
    grouped[question.setId] = [...(grouped[question.setId] ?? []), question];
    return grouped;
  }, {});
}

function groupLatestAnswersBySetId(rows: DbRow[]): Record<string, UserAnswer[]> {
  const latestByQuestion = new Map<string, { questionSetId: string; createdAt: string; answer: UserAnswer }>();

  rows.forEach((row) => {
    const questionSetId = asString(row.question_set_id);
    const questionId = asString(row.question_id);
    if (!questionSetId || !questionId) return;

    const createdAt = asString(row.created_at);
    const key = `${questionSetId}:${questionId}`;
    const current = latestByQuestion.get(key);
    if (current && current.createdAt > createdAt) return;

    latestByQuestion.set(key, {
      questionSetId,
      createdAt,
      answer: {
        questionId,
        answer: asString(row.answer),
        selectedOptionIds: asStringArray(row.selected_option_ids),
      },
    });
  });

  return Array.from(latestByQuestion.values()).reduce<Record<string, UserAnswer[]>>((grouped, item) => {
    grouped[item.questionSetId] = [...(grouped[item.questionSetId] ?? []), item.answer];
    return grouped;
  }, {});
}

function groupLatestEvaluationsBySetId(rows: DbRow[]): Record<string, Evaluation[]> {
  const latestByQuestion = new Map<string, { questionSetId: string; createdAt: string; evaluation: Evaluation }>();

  rows.forEach((row) => {
    const questionSetId = asString(row.question_set_id);
    const questionId = asString(row.question_id);
    if (!questionSetId || !questionId) return;

    const createdAt = asString(row.created_at);
    const key = `${questionSetId}:${questionId}`;
    const current = latestByQuestion.get(key);
    if (current && current.createdAt > createdAt) return;

    latestByQuestion.set(key, {
      questionSetId,
      createdAt,
      evaluation: {
        questionId,
        score: asNumber(row.score),
        ability: asAbility(row.ability),
        strengths: asStringArray(row.strengths),
        weaknesses: asStringArray(row.weaknesses),
        missingPoints: asStringArray(row.missing_points),
        followUpQuestions: asStringArray(row.follow_up_questions),
      },
    });
  });

  return Array.from(latestByQuestion.values()).reduce<Record<string, Evaluation[]>>((grouped, item) => {
    grouped[item.questionSetId] = [...(grouped[item.questionSetId] ?? []), item.evaluation];
    return grouped;
  }, {});
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  local.forEach((item) => merged.set(item.id, item));
  remote.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

function mergeAnswerRecords(
  local: Record<string, UserAnswer[]>,
  remote: Record<string, UserAnswer[]>,
): Record<string, UserAnswer[]> {
  const questionSetIds = new Set([...Object.keys(local), ...Object.keys(remote)]);

  return Array.from(questionSetIds).reduce<Record<string, UserAnswer[]>>((merged, questionSetId) => {
    merged[questionSetId] = mergeByQuestionId(local[questionSetId] ?? [], remote[questionSetId] ?? []);
    return merged;
  }, {});
}

function mergeEvaluationRecords(
  local: Record<string, Evaluation[]>,
  remote: Record<string, Evaluation[]>,
): Record<string, Evaluation[]> {
  const questionSetIds = new Set([...Object.keys(local), ...Object.keys(remote)]);

  return Array.from(questionSetIds).reduce<Record<string, Evaluation[]>>((merged, questionSetId) => {
    merged[questionSetId] = mergeByQuestionId(local[questionSetId] ?? [], remote[questionSetId] ?? []);
    return merged;
  }, {});
}

function mergeByQuestionId<T extends { questionId: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  local.forEach((item) => merged.set(item.questionId, item));
  remote.forEach((item) => merged.set(item.questionId, item));
  return Array.from(merged.values());
}

function isOnlySampleSource(sources: LearningSource[]): boolean {
  return sources.length === 1 && sources[0]?.id === sampleSource.id;
}

function hasUserSources(sources: LearningSource[]): boolean {
  return sources.some((source) => source.id !== sampleSource.id);
}

function sortByCreatedAtAsc(left: { createdAt: string }, right: { createdAt: string }): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function sortByCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }): number {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  const text = asString(value);
  return text || undefined;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDifficulty(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const parsed = asNumber(value);
  if (parsed >= 1 && parsed <= 5) return parsed as 1 | 2 | 3 | 4 | 5;
  return 3;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asQuestionOptions(value: unknown): QuestionOption[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const options = value
    .map((item) => asRecord(item))
    .map((item) => ({
      id: asString(item.id),
      text: asString(item.text),
      rationale: asString(item.rationale),
    }))
    .filter((item) => item.id && item.text);

  return options.length ? options : undefined;
}

function asAbility(value: unknown): AbilityScore {
  const record = asRecord(value);

  return abilityKeys.reduce<AbilityScore>(
    (ability, key) => ({
      ...ability,
      [key]: asNumber(record[key]),
    }),
    { concept: 0, logic: 0, application: 0, critical: 0, expression: 0 },
  );
}

function asRecommendations(value: unknown): LearningRecommendation {
  const record = asRecord(value);

  return {
    mastery: asString(record.mastery),
    gaps: asStringArray(record.gaps),
    supplements: asStringArray(record.supplements),
    practiceTasks: asStringArray(record.practiceTasks),
    nextReviewFocus: asStringArray(record.nextReviewFocus),
  };
}

function asLearningInsight(value: unknown): LearningInsight {
  const record = asRecord(value);

  return {
    topic: asString(record.topic),
    weakPoints: asStringArray(record.weakPoints),
    addedUnderstanding: asStringArray(record.addedUnderstanding),
    applicationAdvice: asStringArray(record.applicationAdvice),
  };
}

export async function persistReport(report: LearningReport): Promise<void> {
  if (!supabase) return;

  await runSupabase(
    supabase.from('learning_reports').upsert({
      id: report.id,
      source_id: report.sourceId,
      question_set_id: report.questionSetId,
      mode: report.mode,
      score: report.score,
      ability: report.ability,
      strengths: report.strengths,
      weaknesses: report.weaknesses,
      recommendations: report.recommendations,
      learning_insight: report.learningInsight,
      created_at: report.createdAt,
    }),
    '保存学习报告到 Supabase',
  );
}

export async function persistQuestionSetGraph(
  source: LearningSource,
  analysis: KnowledgeAnalysis,
  questionSet: QuestionSet,
): Promise<void> {
  await persistSource(source);
  await persistAnalysis(analysis);
  await persistQuestionSet(questionSet);
}

export async function persistCompletedStudyGraph(
  source: LearningSource,
  analysis: KnowledgeAnalysis,
  questionSet: QuestionSet,
  answers: UserAnswer[],
  evaluations: Evaluation[],
  report: LearningReport,
): Promise<void> {
  if (!supabase) return;

  const prepared = prepareStateForRemote({
    sources: [source],
    analyses: [analysis],
    questionSets: [questionSet],
    answers: { [questionSet.id]: answers },
    evaluations: { [questionSet.id]: evaluations },
    reports: [report],
  }).state;
  const preparedQuestionSet = prepared.questionSets[0];
  if (!preparedQuestionSet?.questions.length) {
    throw new Error('保存学习记录失败：题集没有可关联的题目，请先重新生成或恢复题目。');
  }

  await persistQuestionSetGraph(source, analysis, preparedQuestionSet);
  await replaceStudySession(
    preparedQuestionSet.id,
    prepared.answers[preparedQuestionSet.id] ?? [],
    prepared.evaluations[preparedQuestionSet.id] ?? [],
  );
  await persistReport(report);
}

function requireSupabaseClient(): NonNullable<typeof supabase> {
  if (!supabase) {
    throw new Error('Supabase 未连接：请在 EdgeOne 配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 后重新部署。');
  }

  return supabase;
}

async function replaceStudySession(
  questionSetId: string,
  answers: UserAnswer[],
  evaluations: Evaluation[],
): Promise<void> {
  const client = requireSupabaseClient();

  await runSupabase(client.from('answers').delete().eq('question_set_id', questionSetId), '清理旧答题记录');
  await runSupabase(client.from('evaluations').delete().eq('question_set_id', questionSetId), '清理旧批改记录');
  await insertStudySession(questionSetId, answers, evaluations);
}

async function insertStudySession(
  questionSetId: string,
  answers: UserAnswer[],
  evaluations: Evaluation[],
): Promise<void> {
  const client = requireSupabaseClient();

  if (answers.length) {
    await runSupabase(
      client.from('answers').insert(
        answers.map((answer) => ({
          question_set_id: questionSetId,
          question_id: answer.questionId,
          answer: answer.answer,
          selected_option_ids: answer.selectedOptionIds,
        })),
      ),
      '保存答题记录到 Supabase',
    );
  }

  if (evaluations.length) {
    await runSupabase(
      client.from('evaluations').insert(
        evaluations.map((evaluation) => ({
          question_set_id: questionSetId,
          question_id: evaluation.questionId,
          score: evaluation.score,
          ability: evaluation.ability,
          strengths: evaluation.strengths,
          weaknesses: evaluation.weaknesses,
          missing_points: evaluation.missingPoints,
          follow_up_questions: evaluation.followUpQuestions,
        })),
      ),
      '保存批改记录到 Supabase',
    );
  }
}

async function runSupabase<T extends { error: { message: string } | null }>(
  request: PromiseLike<T>,
  action: string,
): Promise<T> {
  const response = await request;
  if (response.error) {
    throw new Error(`${action}失败：${response.error.message}`);
  }

  return response;
}
