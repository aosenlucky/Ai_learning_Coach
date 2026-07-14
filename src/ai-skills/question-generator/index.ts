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
  'principle',
  'scenario',
  'comparison',
  'critical',
  'concept',
  'scenario',
  'principle',
  'expression',
  'scenario',
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
  const count = requestedCount ? Math.min(Math.max(requestedCount, 3), 15) : Math.min(8, Math.max(4, analysis.concepts.length + analysis.applications.length));
  const topic = analysis.topics[0] ?? '当前主题';
  const conceptPool = uniqueCandidates([...analysis.concepts, ...analysis.topics.map((item) => `${item} 的核心边界`)]);
  const logicPool = uniqueCandidates([...analysis.logic, ...analysis.concepts, ...analysis.applications]);
  const applicationPool = uniqueCandidates([...analysis.applications, ...analysis.cases, ...analysis.logic]);
  const controversyPool = uniqueCandidates([...analysis.controversies, ...analysis.logic, ...analysis.concepts]);
  const casePool = uniqueCandidates([...analysis.cases, ...analysis.applications, ...analysis.logic]);

  return Array.from({ length: count }, (_, index) => {
    const type = QUESTION_PLAN[index % QUESTION_PLAN.length];
    const concept = pickByIndex(conceptPool, index, `${topic} 的核心概念`);
    const logic = pickByIndex(logicPool, index, `${topic} 背后的因果关系`);
    const application = pickByIndex(applicationPool, index, `围绕 ${topic} 设计一个实际应用方案`);
    const controversy = pickByIndex(controversyPool, index, `${topic} 的限制与风险`);
    const materialCase = pickByIndex(casePool, index, application);
    const comparisonPair = buildComparisonPair(concept, conceptPool, index, topic);
    const responseAngle = pickByIndex(
      ['材料原意', '组织机制', '现实迁移', '失效条件', '执行动作', '表达说服', '复盘评估', '利益绑定', '风险约束', '案例证据', '团队管理', '战略调整', '个人成长', '沟通对象', '短期行动'],
      index,
      '材料原意',
    );
    const audience = pickByIndex(['非专业听众', '业务负责人', '一线团队', '新加入成员', '跨部门协作者'], index, '非专业听众');
    const scenarioFocus = pickByIndex(
      ['目标设定', '战略传递', '任务分解', '激励与约束', '复盘迭代', '风险控制'],
      index,
      '推进逻辑',
    );
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
        contextHint: `材料提示：${shortText(concept)}。作答时先说“容易误解成什么”，再说“材料真正强调什么”。`,
        question: `请从「${responseAngle}」角度，围绕「${shortText(concept, 34)}」说明它最容易被误解成什么，以及真正边界是什么。`,
        expectedAnswer: `参考答案应指出：${concept}。不能只给口号式定义，需要说明误解、真实含义、成立条件和边界。`,
      },
      principle: {
        bloomLevel: 'Analyze',
        knowledgePoint: logic,
        contextHint: `材料提示：${shortText(logic)}。作答时按“原因 -> 机制 -> 结果 -> 例子/反例”展开。`,
        question: `请从「${responseAngle}」角度拆解这条因果链：为什么「${shortText(logic, 30)}」会影响最终结果？`,
        expectedAnswer: `参考答案应围绕这条链条展开：${logic}。需要至少说明直接原因、中间机制、最终结果，以及为什么它不是单一因素造成的。`,
      },
      comparison: {
        bloomLevel: 'Analyze',
        knowledgePoint: `${comparisonPair.left} vs ${comparisonPair.right}`,
        contextHint: `材料提示：可从“定义、作用机制、适用场景、风险”四个维度比较。`,
        question: `请从「${responseAngle}」角度对比「${comparisonPair.left}」和「${comparisonPair.right}」的差异，并说明各自适合什么场景。`,
        expectedAnswer: `参考答案应说明两者的边界：${comparisonPair.left} 更偏向 ${comparisonPair.leftMeaning}；${comparisonPair.right} 更偏向 ${comparisonPair.rightMeaning}。至少包含定义差异、适用条件、可能风险和一个材料中的例子。`,
      },
      scenario: {
        bloomLevel: mode === 'coach' ? 'Evaluate' : 'Apply',
        knowledgePoint: application,
        contextHint: `材料提示：${shortText(application)}。本题聚焦「${scenarioFocus}」，不用复述全文。`,
        question: `如果把「${topic}」迁移到一个真实工作场景，请围绕「${scenarioFocus}」设计推进逻辑。`,
        expectedAnswer: `参考答案应结合 ${application}，给出场景目标、关键动作、负责人/协作边界、衡量指标和风险兜底。`,
      },
      critical: {
        bloomLevel: 'Evaluate',
        knowledgePoint: controversy,
        contextHint: `材料提示：${shortText(controversy)}。作答时不要只赞同材料，要给出失效条件。`,
        question: `请从「${responseAngle}」角度判断：材料中关于「${shortText(controversy, 30)}」的观点在什么条件下可能失效？请提出两个风险或反例。`,
        expectedAnswer: `参考答案应指出 ${controversy} 的适用边界，并给出至少两个风险、反例或前置条件。`,
      },
      expression: {
        bloomLevel: 'Create',
        knowledgePoint: topic,
        contextHint: `材料提示：可以使用这个例子或片段作为支撑：${shortText(materialCase)}。`,
        question: `请用 3 分钟口头表达的结构，向「${audience}」说明「${topic}」为什么重要。`,
        expectedAnswer: `参考答案应面向${audience}，包含：一句话结论、材料中的例子、对现实工作的价值、风险边界和下一步行动建议。`,
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

function uniqueCandidates(items: string[]): string[] {
  const seen = new Set<string>();
  return items
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function pickByIndex<T>(items: T[], index: number, fallback: T): T {
  if (!items.length) return fallback;
  return items[index % items.length];
}

function shortText(value: string, max = 72): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function buildComparisonPair(
  concept: string,
  conceptPool: string[],
  index: number,
  topic: string,
): { left: string; right: string; leftMeaning: string; rightMeaning: string } {
  const notIndex = concept.indexOf('不是');
  const butIndex = concept.indexOf('而是');
  if (notIndex >= 0 && butIndex > notIndex) {
    const left = shortText(concept.slice(notIndex + 2, butIndex).replace(/[，,。；;]+$/g, ''), 18);
    const right = shortText(concept.slice(butIndex + 2).replace(/[，,。；;]+$/g, ''), 24);
    return {
      left: left || `${topic} 的表层理解`,
      right: right || `${topic} 的系统理解`,
      leftMeaning: '表层、单点或容易误解的做法',
      rightMeaning: '材料真正强调的系统性做法',
    };
  }

  const left = shortText(pickByIndex(conceptPool, index, `${topic} 的做法 A`), 18);
  const right = shortText(pickByIndex(conceptPool, index + 1, `${topic} 的做法 B`), 18);
  return {
    left,
    right: right === left ? `${topic} 的另一种做法` : right,
    leftMeaning: '材料中的一个概念或做法',
    rightMeaning: '材料中另一个需要区分的概念或做法',
  };
}
