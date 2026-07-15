import type {
  AppState,
  Evaluation,
  Question,
  QuestionFormat,
  QuestionSet,
  UserAnswer,
} from '../types';

type JsonRecord = Record<string, unknown>;

export interface IntegrityStats {
  repairedQuestionIds: number;
  repairedReferences: number;
  clearedAnalysisReferences: number;
  skippedAnalyses: number;
  skippedQuestionSets: number;
  skippedAnswers: number;
  skippedEvaluations: number;
  skippedReports: number;
}

export interface PreparedRemoteState {
  state: AppState;
  stats: IntegrityStats;
}

export interface RecoveredJobState {
  questionSets: QuestionSet[];
  answers: Record<string, UserAnswer[]>;
  evaluations: Record<string, Evaluation[]>;
  recoveredQuestionSets: number;
}

export function normalizeQuestionSet(questionSet: QuestionSet): QuestionSet {
  const questions = Array.isArray(questionSet.questions) ? questionSet.questions : [];
  const requestedCount = Number.isFinite(questionSet.questionCount) ? questionSet.questionCount : 0;
  const questionFormat =
    questionSet.questionFormat ??
    (questions.some((question) => question.format === 'choice' || Boolean(question.options?.length)) ? 'choice' : 'open');

  return {
    ...questionSet,
    questionFormat,
    questionCount: Math.max(requestedCount, questions.length),
    questions: questions.map((question) => ({
      ...question,
      setId: question.setId || questionSet.id,
      format: question.format ?? questionFormat,
      type: question.type ?? 'concept',
      bloomLevel: question.bloomLevel ?? 'Understand',
      difficulty: question.difficulty ?? 3,
      knowledgePoint: question.knowledgePoint ?? question.question ?? '',
      question: question.question ?? '',
      expectedAnswer: question.expectedAnswer ?? question.explanation ?? '',
      evaluationCriteria: question.evaluationCriteria ?? [],
      reviewScore: question.reviewScore ?? 0,
    })),
  };
}

export function mergeQuestionSets(local: QuestionSet[], remote: QuestionSet[]): QuestionSet[] {
  const merged = new Map<string, QuestionSet>();
  local.map(normalizeQuestionSet).forEach((questionSet) => merged.set(questionSet.id, questionSet));

  remote.map(normalizeQuestionSet).forEach((remoteSet) => {
    const localSet = merged.get(remoteSet.id);
    if (!localSet) {
      merged.set(remoteSet.id, remoteSet);
      return;
    }

    const remoteIsComplete =
      remoteSet.questions.length > 0 && remoteSet.questions.length >= remoteSet.questionCount;
    const questions = remoteIsComplete
      ? remoteSet.questions
      : mergeById(localSet.questions, remoteSet.questions);
    merged.set(
      remoteSet.id,
      normalizeQuestionSet({
        ...localSet,
        ...remoteSet,
        questionCount: Math.max(localSet.questionCount, remoteSet.questionCount, questions.length),
        questions,
      }),
    );
  });

  return Array.from(merged.values());
}

export function reconcileRecordGroups<T extends { questionId: string }>(
  groups: Record<string, T[]>,
  questionSets: QuestionSet[],
): Record<string, T[]> {
  const questionSetsById = new Map(questionSets.map((questionSet) => [questionSet.id, questionSet]));

  return Object.entries(groups).reduce<Record<string, T[]>>((reconciled, [questionSetId, records]) => {
    const questionSet = questionSetsById.get(questionSetId);
    if (!questionSet?.questions.length) {
      reconciled[questionSetId] = records;
      return reconciled;
    }

    const validQuestionIds = new Set(questionSet.questions.map((question) => question.id));
    const byQuestionId = new Map<string, T>();
    records.forEach((record, index) => {
      const questionId = validQuestionIds.has(record.questionId)
        ? record.questionId
        : questionSet.questions[index]?.id;
      if (questionId) byQuestionId.set(questionId, { ...record, questionId });
    });
    if (byQuestionId.size) reconciled[questionSetId] = Array.from(byQuestionId.values());
    return reconciled;
  }, {});
}

export function prepareStateForRemote(state: AppState): PreparedRemoteState {
  const stats = createIntegrityStats();
  const sources = state.sources.filter((source) => Boolean(source.id));
  const sourceIds = new Set(sources.map((source) => source.id));
  const analyses = state.analyses.filter((analysis) => {
    const valid = Boolean(analysis.id) && sourceIds.has(analysis.sourceId);
    if (!valid) stats.skippedAnalyses += 1;
    return valid;
  });
  const analysisIds = new Set(analyses.map((analysis) => analysis.id));
  const globalQuestionIds = new Set<string>();
  const questionIdMaps = new Map<string, Map<string, string>>();

  const questionSets = state.questionSets
    .map(normalizeQuestionSet)
    .filter((questionSet) => {
      const valid = Boolean(questionSet.id) && sourceIds.has(questionSet.sourceId);
      if (!valid) stats.skippedQuestionSets += 1;
      return valid;
    })
    .map((questionSet) => {
      const questionIdMap = new Map<string, string>();
      const questions = questionSet.questions.map((question, index) => {
        const originalId = question.id?.trim() ?? '';
        let id = originalId;
        if (!id || globalQuestionIds.has(id)) {
          id = buildQuestionId(questionSet.id, index, globalQuestionIds);
          stats.repairedQuestionIds += 1;
        }
        globalQuestionIds.add(id);
        if (originalId && !questionIdMap.has(originalId)) questionIdMap.set(originalId, id);
        questionIdMap.set(id, id);
        return { ...question, id, setId: questionSet.id };
      });

      questionIdMaps.set(questionSet.id, questionIdMap);
      const analysisId = analysisIds.has(questionSet.analysisId) ? questionSet.analysisId : '';
      if (questionSet.analysisId && !analysisId) stats.clearedAnalysisReferences += 1;

      return {
        ...questionSet,
        analysisId,
        questionCount: questions.length || questionSet.questionCount,
        questions,
      };
    });

  const questionSetsById = new Map(questionSets.map((questionSet) => [questionSet.id, questionSet]));
  const answers = repairRecordGroups(
    state.answers,
    questionSetsById,
    questionIdMaps,
    stats,
    'skippedAnswers',
  );
  const evaluations = repairRecordGroups(
    state.evaluations,
    questionSetsById,
    questionIdMaps,
    stats,
    'skippedEvaluations',
  );
  const reports = state.reports.filter((report) => {
    const valid = sourceIds.has(report.sourceId) && questionSetsById.has(report.questionSetId);
    if (!valid) stats.skippedReports += 1;
    return valid;
  });

  return {
    state: { sources, analyses, questionSets, answers, evaluations, reports },
    stats,
  };
}

export function recoverStateFromJobs(
  questionSets: QuestionSet[],
  evaluationJobs: JsonRecord[],
  generationJobs: JsonRecord[],
): RecoveredJobState {
  const evaluationSnapshots = recoverEvaluationSnapshots(evaluationJobs);
  const generationSnapshots = recoverGenerationSnapshots(generationJobs);
  const usedGenerationJobs = new Set<string>();
  const answers: Record<string, UserAnswer[]> = {};
  const evaluations: Record<string, Evaluation[]> = {};
  let recoveredQuestionSets = 0;

  const recoveredSets = questionSets.map((questionSet) => {
    const normalized = normalizeQuestionSet(questionSet);
    const evaluationSnapshot = evaluationSnapshots.get(normalized.id);
    if (evaluationSnapshot) {
      answers[normalized.id] = evaluationSnapshot.answers;
      evaluations[normalized.id] = evaluationSnapshot.evaluations;
    }

    if (normalized.questions.length >= normalized.questionCount) return normalized;
    const recoveredQuestionSet = evaluationSnapshot?.questionSet;
    if (recoveredQuestionSet && recoveredQuestionSet.questions.length > normalized.questions.length) {
      recoveredQuestionSets += 1;
      return mergeQuestionSets([normalized], [recoveredQuestionSet])[0];
    }
    if (normalized.questions.length > 0) return normalized;

    const generationSnapshot = findGenerationSnapshot(normalized, generationSnapshots, usedGenerationJobs);
    if (!generationSnapshot) return normalized;
    usedGenerationJobs.add(generationSnapshot.id);
    recoveredQuestionSets += 1;
    return normalizeQuestionSet({
      ...normalized,
      questions: generationSnapshot.questions.map((question, index) => ({
        ...question,
        id: `${normalized.id}__recovered_${String(index + 1).padStart(3, '0')}`,
        setId: normalized.id,
      })),
    });
  });

  return { questionSets: recoveredSets, answers, evaluations, recoveredQuestionSets };
}

function recoverEvaluationSnapshots(jobs: JsonRecord[]): Map<
  string,
  { questionSet: QuestionSet; answers: UserAnswer[]; evaluations: Evaluation[] }
> {
  const snapshots = new Map<string, { questionSet: QuestionSet; answers: UserAnswer[]; evaluations: Evaluation[] }>();

  sortRowsByCreatedAt(jobs).forEach((job) => {
    const request = asRecord(job.request);
    const rawQuestionSet = asRecord(request.questionSet);
    const questionSetId = asString(rawQuestionSet.id);
    const rawQuestions = Array.isArray(rawQuestionSet.questions) ? rawQuestionSet.questions : [];
    if (!questionSetId || !rawQuestions.length) return;

    const questionSet = normalizeQuestionSet(rawQuestionSet as unknown as QuestionSet);
    const answers = (Array.isArray(request.answers) ? request.answers : [])
      .map((item) => asRecord(item))
      .map(normalizeAnswer)
      .filter((answer) => Boolean(answer.questionId));
    const evaluations = (Array.isArray(job.result) ? job.result : [])
      .map((item) => asRecord(item))
      .map(normalizeEvaluation)
      .filter((evaluation) => Boolean(evaluation.questionId));

    snapshots.set(questionSetId, { questionSet, answers, evaluations });
  });

  return snapshots;
}

function recoverGenerationSnapshots(jobs: JsonRecord[]): Array<{
  id: string;
  sourceId: string;
  analysisId: string;
  mode: string;
  questionFormat: QuestionFormat;
  completedAt: string;
  questions: Question[];
}> {
  return jobs.flatMap((job, jobIndex) => {
    const request = asRecord(job.request);
    const source = asRecord(request.source);
    const analysis = asRecord(request.analysis);
    const result = Array.isArray(job.result) ? job.result : [];
    if (!result.length) return [];

    const questionFormat: QuestionFormat = request.questionFormat === 'choice' ? 'choice' : 'open';
    const questions = result.map((item) => {
      const question = asRecord(item);
      return {
        ...(question as unknown as Question),
        id: '',
        setId: '',
        format: question.format === 'choice' ? 'choice' : questionFormat,
      };
    });

    return [
      {
        id: asString(job.id) || `generation-job-${jobIndex}`,
        sourceId: asString(source.id),
        analysisId: asString(analysis.id),
        mode: asString(request.mode),
        questionFormat,
        completedAt: asString(job.completed_at) || asString(job.created_at),
        questions,
      },
    ];
  });
}

function findGenerationSnapshot(
  questionSet: QuestionSet,
  snapshots: ReturnType<typeof recoverGenerationSnapshots>,
  usedJobIds: Set<string>,
) {
  const setTime = new Date(questionSet.createdAt).getTime();
  return snapshots
    .filter(
      (snapshot) =>
        !usedJobIds.has(snapshot.id) &&
        snapshot.sourceId === questionSet.sourceId &&
        (!questionSet.analysisId || snapshot.analysisId === questionSet.analysisId) &&
        snapshot.mode === questionSet.mode &&
        snapshot.questionFormat === questionSet.questionFormat &&
        snapshot.questions.length === questionSet.questionCount,
    )
    .sort((left, right) => timeDistance(left.completedAt, setTime) - timeDistance(right.completedAt, setTime))[0];
}

function repairRecordGroups<T extends { questionId: string }>(
  groups: Record<string, T[]>,
  questionSetsById: Map<string, QuestionSet>,
  questionIdMaps: Map<string, Map<string, string>>,
  stats: IntegrityStats,
  skippedKey: 'skippedAnswers' | 'skippedEvaluations',
): Record<string, T[]> {
  return Object.entries(groups).reduce<Record<string, T[]>>((repairedGroups, [questionSetId, records]) => {
    const questionSet = questionSetsById.get(questionSetId);
    if (!questionSet?.questions.length) {
      stats[skippedKey] += records.length;
      return repairedGroups;
    }

    const questionIdMap = questionIdMaps.get(questionSetId) ?? new Map<string, string>();
    const validQuestionIds = new Set(questionSet.questions.map((question) => question.id));
    const usedQuestionIds = new Set<string>();
    const repairedRecords = records.flatMap((record, index) => {
      const mappedId = questionIdMap.get(record.questionId);
      let questionId = mappedId && validQuestionIds.has(mappedId) ? mappedId : '';
      if (!questionId) {
        const sameIndexQuestionId = questionSet.questions[index]?.id;
        if (sameIndexQuestionId && !usedQuestionIds.has(sameIndexQuestionId)) {
          questionId = sameIndexQuestionId;
          stats.repairedReferences += 1;
        }
      } else if (questionId !== record.questionId) {
        stats.repairedReferences += 1;
      }

      if (!questionId || usedQuestionIds.has(questionId)) {
        stats[skippedKey] += 1;
        return [];
      }
      usedQuestionIds.add(questionId);
      return [{ ...record, questionId }];
    });

    if (repairedRecords.length) repairedGroups[questionSetId] = repairedRecords;
    return repairedGroups;
  }, {});
}

function normalizeAnswer(record: JsonRecord): UserAnswer {
  return {
    questionId: asString(record.questionId),
    answer: asString(record.answer),
    selectedOptionIds: asStringArray(record.selectedOptionIds),
  };
}

function normalizeEvaluation(record: JsonRecord): Evaluation {
  const ability = asRecord(record.ability);
  return {
    questionId: asString(record.questionId),
    score: asNumber(record.score),
    ability: {
      concept: asNumber(ability.concept),
      logic: asNumber(ability.logic),
      application: asNumber(ability.application),
      critical: asNumber(ability.critical),
      expression: asNumber(ability.expression),
    },
    strengths: asStringArray(record.strengths),
    weaknesses: asStringArray(record.weaknesses),
    missingPoints: asStringArray(record.missingPoints),
    followUpQuestions: asStringArray(record.followUpQuestions),
  };
}

function buildQuestionId(questionSetId: string, index: number, existing: Set<string>): string {
  const base = `${questionSetId}__q_${String(index + 1).padStart(3, '0')}`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createIntegrityStats(): IntegrityStats {
  return {
    repairedQuestionIds: 0,
    repairedReferences: 0,
    clearedAnalysisReferences: 0,
    skippedAnalyses: 0,
    skippedQuestionSets: 0,
    skippedAnswers: 0,
    skippedEvaluations: 0,
    skippedReports: 0,
  };
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  local.forEach((item) => merged.set(item.id, item));
  remote.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

function sortRowsByCreatedAt(rows: JsonRecord[]): JsonRecord[] {
  return [...rows].sort(
    (left, right) => new Date(asString(left.created_at)).getTime() - new Date(asString(right.created_at)).getTime(),
  );
}

function timeDistance(value: string, target: number): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && Number.isFinite(target) ? Math.abs(parsed - target) : Number.MAX_SAFE_INTEGER;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
