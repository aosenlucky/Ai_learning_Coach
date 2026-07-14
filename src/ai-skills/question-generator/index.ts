import type { KnowledgeAnalysis, LearningMode, Question, QuestionFormat, QuestionOption, QuestionType } from '../../types';
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
  questionFormat: QuestionFormat = 'open',
): Question[] {
  if (questionFormat === 'choice') {
    return generateChoiceQuestions(analysis, requestedCount);
  }

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
      format: 'open' as QuestionFormat,
      type,
      difficulty: (type === 'scenario' || type === 'critical' ? 4 : 3) as Question['difficulty'],
      evaluationCriteria: [
        '覆盖材料中的核心知识点',
        '说明因果关系或判断依据',
        '结合真实场景给出可执行表达',
      ],
    };

    const templates: Record<QuestionType, Omit<Question, 'reviewScore' | 'setId' | 'id' | 'format' | 'type' | 'difficulty' | 'evaluationCriteria'>> = {
      concept: {
        bloomLevel: 'Understand',
        knowledgePoint: concept,
        contextHint: `材料提示：${shortText(concept)}。作答时先说“容易误解成什么”，再说“材料真正强调什么”。`,
        question: `请从「${responseAngle}」角度，围绕「${shortText(concept, 34)}」说明它最容易被误解成什么，以及真正边界是什么。`,
        expectedAnswer: buildOpenExpectedAnswer('concept', { topic, concept, responseAngle }),
        explanation: `本题看你能否把概念从口号、标签或单点动作中拆出来，说明它真正依赖的条件和边界。`,
      },
      principle: {
        bloomLevel: 'Analyze',
        knowledgePoint: logic,
        contextHint: `材料提示：${shortText(logic)}。作答时按“原因 -> 机制 -> 结果 -> 例子/反例”展开。`,
        question: `请从「${responseAngle}」角度拆解这条因果链：为什么「${shortText(logic, 30)}」会影响最终结果？`,
        expectedAnswer: buildOpenExpectedAnswer('principle', { topic, logic, responseAngle }),
        explanation: `本题不是让你背原句，而是把材料观点改写成“原因 -> 机制 -> 结果”的分析链。`,
      },
      comparison: {
        bloomLevel: 'Analyze',
        knowledgePoint: `${comparisonPair.left} vs ${comparisonPair.right}`,
        contextHint: `材料提示：可从“定义、作用机制、适用场景、风险”四个维度比较。`,
        question: `请从「${responseAngle}」角度对比「${comparisonPair.left}」和「${comparisonPair.right}」的差异，并说明各自适合什么场景。`,
        expectedAnswer: buildOpenExpectedAnswer('comparison', { topic, comparisonPair, responseAngle }),
        explanation: `本题要明确比较对象，并按定义、机制、场景、风险拆开，而不是泛泛说“二者不同”。`,
      },
      scenario: {
        bloomLevel: mode === 'coach' ? 'Evaluate' : 'Apply',
        knowledgePoint: application,
        contextHint: `材料提示：${shortText(application)}。本题聚焦「${scenarioFocus}」，不用复述全文。`,
        question: `如果把「${topic}」迁移到一个真实工作场景，请围绕「${scenarioFocus}」设计推进逻辑。`,
        expectedAnswer: buildOpenExpectedAnswer('scenario', { topic, application, scenarioFocus }),
        explanation: `本题看迁移能力：要把材料中的机制转成现实工作里的目标、动作、责任和衡量方式。`,
      },
      critical: {
        bloomLevel: 'Evaluate',
        knowledgePoint: controversy,
        contextHint: `材料提示：${shortText(controversy)}。作答时不要只赞同材料，要给出失效条件。`,
        question: `请从「${responseAngle}」角度判断：材料中关于「${shortText(controversy, 30)}」的观点在什么条件下可能失效？请提出两个风险或反例。`,
        expectedAnswer: buildOpenExpectedAnswer('critical', { topic, controversy, responseAngle }),
        explanation: `本题看边界意识：材料观点成立往往依赖前置条件，失效条件比复述观点更重要。`,
      },
      expression: {
        bloomLevel: 'Create',
        knowledgePoint: topic,
        contextHint: `材料提示：可以使用这个例子或片段作为支撑：${shortText(materialCase)}。`,
        question: `请用 3 分钟口头表达的结构，向「${audience}」说明「${topic}」为什么重要。`,
        expectedAnswer: buildOpenExpectedAnswer('expression', { topic, materialCase, audience }),
        explanation: `本题看输出能力：需要让非原始材料读者听懂“为什么重要、怎么用、要注意什么”。`,
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

function generateChoiceQuestions(analysis: KnowledgeAnalysis, requestedCount?: number): Question[] {
  const count = requestedCount ? Math.min(Math.max(requestedCount, 3), 50) : 20;
  const topic = analysis.topics[0] ?? '当前主题';
  const conceptPool = uniqueCandidates([...analysis.concepts, ...analysis.logic, ...analysis.applications, ...analysis.controversies]);
  const casePool = uniqueCandidates([...analysis.cases, ...analysis.applications, ...analysis.logic]);

  return Array.from({ length: count }, (_, index) => {
    const type = pickByIndex<QuestionType>(['concept', 'principle', 'comparison', 'critical'], index, 'concept');
    const point = pickByIndex(conceptPool, index, `${topic} 的关键判断`);
    const related = pickByIndex(conceptPool, index + 1, `${topic} 的另一项判断`);
    const materialCase = pickByIndex(casePool, index, point);
    const correct = buildChoiceCorrectAnswer(type, point, related, materialCase);
    const distractors = buildChoiceDistractors(type, point, related, topic);
    const options = shuffleOptions([correct, ...distractors], index);
    const correctOption = options.find((option) => option.text === correct.text) ?? options[0];
    const questionText = buildChoiceQuestion(type, point, related, topic, index);

    const question: Omit<Question, 'reviewScore'> = {
      id: createId('question'),
      setId: '',
      format: 'choice',
      type,
      bloomLevel: type === 'concept' ? 'Understand' : type === 'critical' ? 'Evaluate' : 'Analyze',
      difficulty: type === 'concept' ? 2 : 3,
      knowledgePoint: point,
      question: `${TYPE_LABEL[type]}：${questionText}`,
      contextHint: `材料提示：${shortText(point)}。选择最符合材料逻辑的一项。`,
      options,
      correctOptionIds: [correctOption.id],
      expectedAnswer: `正确答案：${correctOption.id}。${correct.rationale}`,
      explanation: correct.rationale,
      evaluationCriteria: [
        '选项必须符合材料原意',
        '能够区分相近概念或因果关系',
        '不是凭常识选择最顺耳的表述',
      ],
    };

    return {
      ...question,
      reviewScore: reviewQuestionQuality(question),
    };
  });
}

function buildChoiceQuestion(type: QuestionType, point: string, related: string, topic: string, index: number): string {
  const stems: Record<QuestionType, string> = {
    concept: `以下哪项最准确地概括了材料中「${shortText(point, 32)}」的含义？`,
    principle: `关于「${shortText(point, 32)}」背后的因果关系，哪项最符合材料逻辑？`,
    comparison: `如果要区分「${shortText(point, 18)}」与「${shortText(related, 18)}」，哪项判断更准确？`,
    critical: `关于「${shortText(point, 32)}」的适用边界，哪项判断更稳妥？`,
    scenario: `把「${topic}」迁移到工作场景时，哪项动作最优先？`,
    expression: `向他人解释「${topic}」时，哪项表达结构更合适？`,
  };
  return `${stems[type]}（第 ${index + 1} 题）`;
}

function buildChoiceCorrectAnswer(type: QuestionType, point: string, related: string, materialCase: string): QuestionOption {
  const rationaleByType: Record<QuestionType, string> = {
    concept: `材料强调的不是表层口号，而是「${point}」背后的机制、条件和边界。`,
    principle: `这项判断能把「${point}」拆成原因、组织机制与结果，而不是把结果归因于单一因素。`,
    comparison: `这项判断能区分「${point}」与「${related}」的作用边界，而不是把二者混成同一种做法。`,
    critical: `这项判断承认「${point}」有适用条件，并能提示过度使用或条件缺失时的风险。`,
    scenario: `这项动作能把材料中的机制落到真实场景，并保留目标、责任、指标和风险兜底。`,
    expression: `这项表达先给结论，再用「${materialCase}」支撑，最后落到现实价值和行动建议。`,
  };
  return {
    id: 'A',
    text: rationaleByType[type],
    rationale: rationaleByType[type],
  };
}

function buildChoiceDistractors(type: QuestionType, point: string, related: string, topic: string): QuestionOption[] {
  return [
    {
      id: 'B',
      text: `只要加强宣传和口号动员，就能自然解决「${shortText(point, 22)}」的问题。`,
      rationale: '这是把复杂机制简化成单点口号，容易忽略组织、利益、任务和环境条件。',
    },
    {
      id: 'C',
      text: `「${shortText(point, 22)}」主要取决于个人性格，与组织机制和场景条件关系不大。`,
      rationale: '这是个人英雄主义式解释，无法覆盖材料中的组织机制和场景约束。',
    },
    {
      id: 'D',
      text: `只要复制「${shortText(related || topic, 22)}」的做法，不需要判断适用条件。`,
      rationale: '这是机械迁移，忽略材料中的边界、时机和风险。',
    },
  ];
}

function shuffleOptions(options: QuestionOption[], seed: number): QuestionOption[] {
  const orderPatterns = [
    [0, 1, 2, 3],
    [1, 0, 3, 2],
    [2, 3, 0, 1],
    [3, 2, 1, 0],
  ];
  const ordered = orderPatterns[seed % orderPatterns.length].map((position) => options[position]);
  return ordered.map((option, index) => ({
    ...option,
    id: String.fromCharCode(65 + index),
  }));
}

function buildOpenExpectedAnswer(
  type: QuestionType,
  context: {
    topic: string;
    concept?: string;
    logic?: string;
    application?: string;
    controversy?: string;
    materialCase?: string;
    responseAngle?: string;
    scenarioFocus?: string;
    audience?: string;
    comparisonPair?: { left: string; right: string; leftMeaning: string; rightMeaning: string };
  },
): string {
  switch (type) {
    case 'concept':
      return `一个合格答案应说明：这里的核心不是把「${context.topic}」理解成口号、情绪或单点动作，而是围绕「${context.concept}」建立清晰边界。它成立需要具体条件支撑，回答时要说清“容易误解成什么”“材料真正强调什么”“什么情况下会失效”。`;
    case 'principle':
      return `因果链可以这样拆：前置原因是「${context.logic}」中描述的状态或矛盾；中间机制是组织方向、责任分解、利益/风险约束和关键节点判断共同发挥作用；结果是队伍或组织在压力下仍能形成一致行动。因此它不是单一因素造成的，而是环境、机制、干部/成员行动和反馈纠偏共同作用。`;
    case 'comparison':
      return `比较时可这样答：「${context.comparisonPair?.left}」偏向${context.comparisonPair?.leftMeaning}，「${context.comparisonPair?.right}」偏向${context.comparisonPair?.rightMeaning}。前者更适合解释概念边界或一般原则，后者更适合解释具体做法、案例或执行条件。风险在于把原则当动作，或把个案经验机械复制到不匹配的场景。`;
    case 'scenario':
      return `可按五步作答：1. 先定义真实场景和目标，聚焦「${context.scenarioFocus}」；2. 把材料中的机制「${context.application}」转成 2-3 个关键动作；3. 明确负责人和协作边界；4. 设定可观察指标；5. 预设风险兜底，避免把压力传导变成简单高压管理。`;
    case 'critical':
      return `批判答案应承认「${context.controversy}」有价值，但指出它的边界：如果方向本身错误、利益绑定缺失、资源条件过低、组织信任被破坏，或者高压替代了目标共识，这个观点可能失效。至少要给出两个风险或反例，并说明为什么会失效。`;
    case 'expression':
      return `3 分钟表达可以这样组织：先用一句话说明「${context.topic}」解决什么问题；再用材料中的例子「${context.materialCase}」解释机制；接着说它对现实工作的价值；然后补一句风险边界；最后给出一个下一步行动建议。听众是${context.audience}时，要少用术语，多用业务语言。`;
    default:
      return `围绕「${context.topic}」给出材料依据、机制解释、适用边界和现实应用。`;
  }
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
