import type { KnowledgeAnalysis, LearningMode, Question, QuestionType } from '../../types';
import { createId } from '../../lib/id';
import { reviewQuestionQuality } from '../question-quality-reviewer';

const QUESTION_PLAN: QuestionType[] = [
  'scenario',
  'principle',
  'concept',
  'comparison',
  'critical',
  'expression',
  'scenario',
  'principle',
];

const TYPE_LABEL: Record<QuestionType, string> = {
  concept: '概念理解',
  principle: '原理分析',
  comparison: '对比分析',
  scenario: '场景应用',
  critical: '批判思考',
  expression: '表达输出',
};

export function generateQuestions(
  analysis: KnowledgeAnalysis,
  mode: LearningMode,
  requestedCount?: number,
): Question[] {
  const count = requestedCount ?? Math.min(8, Math.max(4, analysis.concepts.length + analysis.applications.length));
  const topic = analysis.topics[0] ?? '当前主题';
  const application = analysis.applications[0] ?? analysis.logic[0] ?? `围绕 ${topic} 设计一个实际应用方案`;
  const concept = analysis.concepts[0] ?? `${topic} 的核心概念`;
  const logic = analysis.logic[0] ?? `${topic} 背后的因果关系`;
  const controversy = analysis.controversies[0] ?? `${topic} 的限制与风险`;

  return Array.from({ length: count }, (_, index) => {
    const type = QUESTION_PLAN[index % QUESTION_PLAN.length];
    const base = {
      id: createId('question'),
      setId: '',
      type,
      difficulty: (type === 'scenario' || type === 'critical' ? 4 : 3) as Question['difficulty'],
      evaluationCriteria: [
        '覆盖材料中的核心知识点',
        '说明因果关系或判断依据',
        '结合真实场景给出可执行表达',
      ],
    };

    const templates: Record<QuestionType, Omit<Question, 'reviewScore' | 'setId' | 'id' | 'type' | 'difficulty' | 'evaluationCriteria'>> = {
      concept: {
        bloomLevel: 'Understand',
        knowledgePoint: concept,
        question: `请解释「${topic}」中最容易被误解的边界是什么，并说明它不应被简化为什么。`,
        expectedAnswer: `需要说明 ${concept}，并指出材料中被区分开的误解或边界。`,
      },
      principle: {
        bloomLevel: 'Analyze',
        knowledgePoint: logic,
        question: `材料中的关键因果链是什么？请说明为什么「结果」不是只由单一技术因素决定。`,
        expectedAnswer: `需要抽取 ${logic}，并说明技术、流程、组织或场景之间的因果关系。`,
      },
      comparison: {
        bloomLevel: 'Analyze',
        knowledgePoint: concept,
        question: `请对比材料中两个相近概念或做法的差异，并指出它们各自适合的场景。`,
        expectedAnswer: `需要建立清晰边界，至少包含定义差异、适用条件和风险差异。`,
      },
      scenario: {
        bloomLevel: mode === 'coach' ? 'Evaluate' : 'Apply',
        knowledgePoint: application,
        question: `如果你要把「${topic}」应用到自己的工作或一个企业场景中，你会如何设计推进逻辑？`,
        expectedAnswer: `需要结合 ${application}，给出目标、步骤、协作边界和评估指标。`,
      },
      critical: {
        bloomLevel: 'Evaluate',
        knowledgePoint: controversy,
        question: `材料中的观点在什么条件下可能失效？请提出至少两个风险或反例。`,
        expectedAnswer: `需要指出 ${controversy}，并给出判断条件，而不是简单赞同材料观点。`,
      },
      expression: {
        bloomLevel: 'Create',
        knowledgePoint: topic,
        question: `请用 3 分钟口头表达的结构，向非技术负责人说明「${topic}」的价值。`,
        expectedAnswer: '需要有开场、业务语言解释、例子、风险边界和下一步建议。',
      },
    };

    const question: Omit<Question, 'reviewScore'> = {
      ...base,
      ...templates[type],
      type,
      question: `${TYPE_LABEL[type]}：${templates[type].question}`,
    };

    return {
      ...question,
      reviewScore: reviewQuestionQuality(question),
    };
  });
}
