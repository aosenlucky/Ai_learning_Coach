import { describe, expect, it } from 'vitest';
import type { AppState, Question, QuestionSet } from '../types';
import {
  mergeQuestionSets,
  prepareStateForRemote,
  reconcileRecordGroups,
  recoverStateFromJobs,
} from './stateIntegrity';

function makeQuestion(id: string, setId: string): Question {
  return {
    id,
    setId,
    format: 'open',
    type: 'concept',
    bloomLevel: 'Understand',
    difficulty: 3,
    knowledgePoint: '测试知识点',
    question: '测试题目',
    expectedAnswer: '测试答案',
    evaluationCriteria: [],
    reviewScore: 80,
  };
}

function makeQuestionSet(id: string, questions: Question[]): QuestionSet {
  return {
    id,
    sourceId: 'source-1',
    analysisId: 'analysis-1',
    mode: 'exam',
    questionFormat: 'open',
    questionCount: questions.length || 1,
    questions,
    createdAt: '2026-07-15T00:00:00.000Z',
  };
}

function makeState(questionSets: QuestionSet[]): AppState {
  return {
    sources: [
      {
        id: 'source-1',
        title: '测试素材',
        type: 'article',
        topic: '测试',
        content: '内容',
        tags: [],
        goal: '',
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    ],
    analyses: [
      {
        id: 'analysis-1',
        sourceId: 'source-1',
        strategy: 'Deep Understanding Mode',
        topics: [],
        concepts: [],
        logic: [],
        cases: [],
        applications: [],
        controversies: [],
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    ],
    questionSets,
    answers: {},
    evaluations: {},
    reports: [],
  };
}

describe('state integrity', () => {
  it('keeps local questions when the remote question set is only an empty shell', () => {
    const local = makeQuestionSet('set-1', [makeQuestion('q-1', 'set-1')]);
    const remote = makeQuestionSet('set-1', []);

    const merged = mergeQuestionSets([local], [remote]);

    expect(merged[0].questions).toHaveLength(1);
    expect(merged[0].questions[0].id).toBe('q-1');
  });

  it('uses a complete remote question set as authoritative after id migration', () => {
    const local = makeQuestionSet('set-1', [makeQuestion('legacy-q-1', 'set-1')]);
    const remote = makeQuestionSet('set-1', [makeQuestion('set-1__q_001', 'set-1')]);

    const merged = mergeQuestionSets([local], [remote]);
    const answers = reconcileRecordGroups(
      {
        'set-1': [
          { questionId: 'legacy-q-1', answer: '旧引用' },
          { questionId: 'set-1__q_001', answer: '云端引用' },
        ],
      },
      merged,
    );

    expect(merged[0].questions.map((question) => question.id)).toEqual(['set-1__q_001']);
    expect(answers['set-1']).toEqual([{ questionId: 'set-1__q_001', answer: '云端引用' }]);
  });

  it('repairs duplicate question ids and remaps their answer references', () => {
    const first = makeQuestionSet('set-1', [makeQuestion('q-1', 'set-1')]);
    const second = makeQuestionSet('set-2', [makeQuestion('q-1', 'set-2')]);
    const state = makeState([first, second]);
    state.answers = {
      'set-1': [{ questionId: 'q-1', answer: '答案一' }],
      'set-2': [{ questionId: 'q-1', answer: '答案二' }],
    };

    const prepared = prepareStateForRemote(state);
    const secondQuestionId = prepared.state.questionSets[1].questions[0].id;

    expect(secondQuestionId).not.toBe('q-1');
    expect(prepared.state.answers['set-2'][0].questionId).toBe(secondQuestionId);
    expect(prepared.stats.repairedQuestionIds).toBe(1);
    expect(prepared.stats.repairedReferences).toBe(1);
  });

  it('skips orphan answer records instead of violating a foreign key', () => {
    const state = makeState([makeQuestionSet('set-1', [])]);
    state.answers = { 'set-1': [{ questionId: 'missing-question', answer: '孤立答案' }] };

    const prepared = prepareStateForRemote(state);

    expect(prepared.state.answers['set-1']).toBeUndefined();
    expect(prepared.stats.skippedAnswers).toBe(1);
  });

  it('recovers an empty question set and its answers from an evaluation job', () => {
    const completeSet = makeQuestionSet('set-1', [makeQuestion('q-1', 'set-1')]);
    const emptySet = makeQuestionSet('set-1', []);
    const evaluationJob = {
      id: 'job-1',
      created_at: '2026-07-15T00:01:00.000Z',
      request: {
        questionSet: completeSet,
        answers: [{ questionId: 'q-1', answer: '已作答' }],
      },
      result: [],
    };

    const recovered = recoverStateFromJobs([emptySet], [evaluationJob], []);

    expect(recovered.questionSets[0].questions).toHaveLength(1);
    expect(recovered.answers['set-1'][0].answer).toBe('已作答');
    expect(recovered.recoveredQuestionSets).toBe(1);
  });

  it('fills a partially stored question set from an evaluation job without losing stored questions', () => {
    const firstQuestion = makeQuestion('q-1', 'set-1');
    const secondQuestion = makeQuestion('q-2', 'set-1');
    const partialSet = { ...makeQuestionSet('set-1', [firstQuestion]), questionCount: 2 };
    const completeSet = makeQuestionSet('set-1', [firstQuestion, secondQuestion]);
    const evaluationJob = {
      id: 'job-1',
      created_at: '2026-07-15T00:01:00.000Z',
      request: { questionSet: completeSet, answers: [] },
      result: [],
    };

    const recovered = recoverStateFromJobs([partialSet], [evaluationJob], []);

    expect(recovered.questionSets[0].questions.map((question) => question.id)).toEqual(['q-1', 'q-2']);
    expect(recovered.recoveredQuestionSets).toBe(1);
  });

  it('recovers generated questions when no evaluation job exists', () => {
    const emptySet = makeQuestionSet('set-1', []);
    const generatedQuestion = makeQuestion('', '');
    const generationJob = {
      id: 'generation-job-1',
      created_at: '2026-07-14T23:59:00.000Z',
      completed_at: '2026-07-14T23:59:30.000Z',
      request: {
        source: { id: 'source-1' },
        analysis: { id: 'analysis-1' },
        mode: 'exam',
        questionFormat: 'open',
      },
      result: [generatedQuestion],
    };

    const recovered = recoverStateFromJobs([emptySet], [], [generationJob]);

    expect(recovered.questionSets[0].questions).toHaveLength(1);
    expect(recovered.questionSets[0].questions[0].id).toBe('set-1__recovered_001');
    expect(recovered.recoveredQuestionSets).toBe(1);
  });
});
