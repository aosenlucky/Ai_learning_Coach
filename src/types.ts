export type SourceType = 'book' | 'meeting' | 'article' | 'video-course' | 'technical-doc' | 'client-proposal';

export type LearningMode = 'exam' | 'coach';

export type QuestionFormat = 'open' | 'choice';

export type BloomLevel = 'Remember' | 'Understand' | 'Apply' | 'Analyze' | 'Evaluate' | 'Create';

export type QuestionType =
  | 'concept'
  | 'principle'
  | 'comparison'
  | 'scenario'
  | 'critical'
  | 'expression';

export type AbilityKey = 'concept' | 'logic' | 'application' | 'critical' | 'expression';

export interface QuestionOption {
  id: string;
  text: string;
  rationale: string;
}

export interface LearningSource {
  id: string;
  title: string;
  type: SourceType;
  topic: string;
  content: string;
  tags: string[];
  goal: string;
  createdAt: string;
}

export interface KnowledgeAnalysis {
  id: string;
  sourceId: string;
  strategy: StrategyMode;
  topics: string[];
  concepts: string[];
  logic: string[];
  cases: string[];
  applications: string[];
  controversies: string[];
  createdAt: string;
}

export interface Question {
  id: string;
  setId: string;
  format: QuestionFormat;
  type: QuestionType;
  bloomLevel: BloomLevel;
  difficulty: 1 | 2 | 3 | 4 | 5;
  knowledgePoint: string;
  question: string;
  contextHint?: string;
  options?: QuestionOption[];
  correctOptionIds?: string[];
  explanation?: string;
  expectedAnswer: string;
  evaluationCriteria: string[];
  reviewScore: number;
}

export interface QuestionSet {
  id: string;
  sourceId: string;
  analysisId: string;
  mode: LearningMode;
  questionFormat: QuestionFormat;
  questionCount: number;
  questions: Question[];
  createdAt: string;
}

export interface UserAnswer {
  questionId: string;
  answer: string;
  selectedOptionIds?: string[];
}

export interface AbilityScore {
  concept: number;
  logic: number;
  application: number;
  critical: number;
  expression: number;
}

export interface Evaluation {
  questionId: string;
  score: number;
  ability: AbilityScore;
  strengths: string[];
  weaknesses: string[];
  missingPoints: string[];
  followUpQuestions: string[];
}

export interface LearningReport {
  id: string;
  sourceId: string;
  questionSetId: string;
  mode: LearningMode;
  score: number;
  ability: AbilityScore;
  strengths: string[];
  weaknesses: string[];
  recommendations: LearningRecommendation;
  learningInsight: LearningInsight;
  createdAt: string;
}

export interface LearningRecommendation {
  mastery: string;
  gaps: string[];
  supplements: string[];
  practiceTasks: string[];
  nextReviewFocus: string[];
}

export interface LearningInsight {
  topic: string;
  weakPoints: string[];
  addedUnderstanding: string[];
  applicationAdvice: string[];
}

export type StrategyMode =
  | 'Business Application Mode'
  | 'Deep Understanding Mode'
  | 'Technical Mastery Mode'
  | 'Executive Expression Mode';

export interface AppState {
  sources: LearningSource[];
  analyses: KnowledgeAnalysis[];
  questionSets: QuestionSet[];
  answers: Record<string, UserAnswer[]>;
  evaluations: Record<string, Evaluation[]>;
  reports: LearningReport[];
}

export interface SkillResult<T> {
  data: T;
  usedRemote: boolean;
}
