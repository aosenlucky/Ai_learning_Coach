import type { AppState, Evaluation, KnowledgeAnalysis, LearningReport, LearningSource, QuestionSet, UserAnswer } from '../types';
import { sampleSource } from '../data/sample';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'personal-ai-learning-coach-state';

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
    };
  } catch {
    return initialState;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function persistSource(source: LearningSource): Promise<void> {
  if (!supabase) return;

  await supabase.from('learning_sources').upsert({
    id: source.id,
    title: source.title,
    type: source.type,
    topic: source.topic,
    content: source.content,
    tags: source.tags,
    learning_goal: source.goal,
    created_at: source.createdAt,
  });
}

export async function persistAnalysis(analysis: KnowledgeAnalysis): Promise<void> {
  if (!supabase) return;

  await supabase.from('knowledge_analysis').upsert({
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
  });
}

export async function persistQuestionSet(questionSet: QuestionSet): Promise<void> {
  if (!supabase) return;

  await supabase.from('question_sets').upsert({
    id: questionSet.id,
    source_id: questionSet.sourceId,
    analysis_id: questionSet.analysisId,
    mode: questionSet.mode,
    question_format: questionSet.questionFormat,
    question_count: questionSet.questionCount,
    created_at: questionSet.createdAt,
  });

  await supabase.from('questions').upsert(
    questionSet.questions.map((question) => ({
      id: question.id,
      question_set_id: questionSet.id,
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
  );
}

export async function persistReport(report: LearningReport): Promise<void> {
  if (!supabase) return;

  await supabase.from('learning_reports').upsert({
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
  });
}

export async function persistStudySession(
  questionSetId: string,
  answers: UserAnswer[],
  evaluations: Evaluation[],
): Promise<void> {
  if (!supabase) return;

  await supabase.from('answers').insert(
    answers.map((answer) => ({
      question_set_id: questionSetId,
      question_id: answer.questionId,
      answer: answer.answer,
      selected_option_ids: answer.selectedOptionIds,
    })),
  );

  await supabase.from('evaluations').insert(
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
  );
}
