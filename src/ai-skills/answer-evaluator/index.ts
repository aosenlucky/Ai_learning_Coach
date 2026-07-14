import type { AbilityScore, Evaluation, Question, UserAnswer } from '../../types';
import { clampScore, pickTopTerms } from '../../lib/text';

const TYPE_EXPECTATION = {
  concept: ['误解点', '真实含义', '边界条件'],
  principle: ['原因', '机制', '结果', '多因素解释'],
  comparison: ['定义差异', '适用场景', '风险边界'],
  scenario: ['真实场景', '推进步骤', '协作边界', '衡量指标'],
  critical: ['失效条件', '风险', '反例'],
  expression: ['听众视角', '例子', '结论', '行动建议'],
};

function scoreCoverage(answer: string, expected: string): { score: number; expectedTerms: string[]; matchedTerms: string[] } {
  const expectedTerms = pickTopTerms(expected, 10);
  if (expectedTerms.length === 0) return { score: 65, expectedTerms: [], matchedTerms: [] };
  const hitCount = expectedTerms.filter((term) => answer.includes(term)).length;
  const matchedTerms = expectedTerms.filter((term) => answer.includes(term));
  const score = clampScore(25 + (hitCount / expectedTerms.length) * 55 + Math.min(answer.length / 220, 1) * 20);
  return { score, expectedTerms, matchedTerms };
}

export function evaluateAnswer(question: Question, answer: UserAnswer): Evaluation {
  if (question.format === 'choice') {
    return evaluateChoiceAnswer(question, answer);
  }

  const content = answer.answer.trim();
  const unanswered = content.length < 8;
  const confusionOnly = /不知道|怎么回答|不清楚|没看懂|题目让我|无法回答/.test(content) && content.length < 90;
  const { score: coverage, expectedTerms, matchedTerms } = scoreCoverage(content, `${question.knowledgePoint} ${question.expectedAnswer}`);
  const hasApplication = /场景|流程|指标|步骤|落地|业务|案例|实践/.test(content);
  const hasCritical = /风险|限制|反例|条件|边界|不一定|但是/.test(content);
  const hasStructure = /第一|第二|首先|其次|最后|1\.|2\.|3\./.test(content);
  const hasComparison = /相比|区别|差异|一方面|另一方面|适合|而|不是|而是/.test(content);
  const hasCauseChain = /因为|所以|导致|形成|机制|结果|原因|关键|来自/.test(content);
  const lengthScore = clampScore(Math.min(content.length / 220, 1) * 100);

  if (unanswered) {
    return {
      questionId: question.id,
      score: 0,
      ability: { concept: 0, logic: 0, application: 0, critical: 0, expression: 0 },
      strengths: ['未检测到有效回答'],
      weaknesses: [
        `这题需要围绕「${question.knowledgePoint}」作答，而不是留空。`,
        `建议先按提示写出 3 个要点：${TYPE_EXPECTATION[question.type].slice(0, 3).join('、')}。`,
      ],
      missingPoints: [question.expectedAnswer],
      followUpQuestions: [`请先用一句话复述：材料关于「${question.knowledgePoint}」到底想说明什么？`],
    };
  }

  const ability: AbilityScore = {
    concept: clampScore(coverage + (matchedTerms.length >= 2 ? 8 : 0)),
    logic: clampScore(coverage * 0.58 + (hasCauseChain ? 28 : 6) + (hasStructure ? 10 : 0)),
    application: clampScore(coverage * 0.5 + (hasApplication ? 34 : 8) + (question.type === 'scenario' ? 8 : 0)),
    critical: clampScore(coverage * 0.5 + (hasCritical ? 34 : 8) + (question.type === 'critical' ? 8 : 0)),
    expression: clampScore(lengthScore * 0.55 + (hasStructure ? 35 : 18)),
  };

  let score = clampScore(
    ability.concept * 0.2 +
      ability.logic * 0.2 +
      ability.application * 0.25 +
      ability.critical * 0.2 +
      ability.expression * 0.15,
  );
  if (question.type === 'comparison' && !hasComparison) score = clampScore(score - 18);
  if (question.type === 'principle' && !hasCauseChain) score = clampScore(score - 18);
  if (confusionOnly) score = Math.min(score, 28);

  const strengths = buildStrengths(question, {
    score,
    matchedTerms,
    hasApplication,
    hasCritical,
    hasStructure,
    hasComparison,
    hasCauseChain,
  });
  const weaknesses = buildWeaknesses(question, {
    confusionOnly,
    hasApplication,
    hasCritical,
    hasStructure,
    hasComparison,
    hasCauseChain,
    matchedTerms,
  });

  return {
    questionId: question.id,
    score,
    ability,
    strengths,
    weaknesses,
    missingPoints: expectedTerms.filter((term) => !content.includes(term)).slice(0, 6),
    followUpQuestions: buildFollowUps(question),
  };
}

function evaluateChoiceAnswer(question: Question, answer: UserAnswer): Evaluation {
  const selected = answer.selectedOptionIds?.length
    ? answer.selectedOptionIds
    : answer.answer.trim()
      ? [answer.answer.trim()]
      : [];
  const correct = question.correctOptionIds ?? [];
  const selectedSet = new Set(selected);
  const isCorrect = selected.length === correct.length && correct.every((id) => selectedSet.has(id));
  const score = isCorrect ? 100 : 0;
  const selectedText = selected
    .map((id) => question.options?.find((option) => option.id === id))
    .filter(Boolean)
    .map((option) => `${option?.id}. ${option?.text}`)
    .join('；');
  const correctText = correct
    .map((id) => question.options?.find((option) => option.id === id))
    .filter(Boolean)
    .map((option) => `${option?.id}. ${option?.text}`)
    .join('；');

  return {
    questionId: question.id,
    score,
    ability: {
      concept: score,
      logic: score,
      application: question.type === 'scenario' ? score : Math.round(score * 0.8),
      critical: question.type === 'critical' ? score : Math.round(score * 0.8),
      expression: score,
    },
    strengths: isCorrect
      ? [`选择正确，能够识别材料中「${question.knowledgePoint}」的关键判断。`]
      : selected.length
        ? [`已完成选择，但当前选项与材料中的关键判断不一致：${selectedText || selected.join('、')}。`]
        : ['未选择答案。'],
    weaknesses: isCorrect
      ? ['可以继续用自己的话解释为什么其他选项不符合材料边界。']
      : [`正确答案是 ${correct.join('、')}：${correctText || question.expectedAnswer}`],
    missingPoints: isCorrect ? [] : [question.explanation ?? question.expectedAnswer],
    followUpQuestions: isCorrect
      ? [`请用一句话解释：为什么 ${correct.join('、')} 比其他选项更符合材料？`]
      : [`请回到材料提示，说明为什么正确选项 ${correct.join('、')} 更符合「${question.knowledgePoint}」。`],
  };
}

function buildStrengths(
  question: Question,
  checks: {
    score: number;
    matchedTerms: string[];
    hasApplication: boolean;
    hasCritical: boolean;
    hasStructure: boolean;
    hasComparison: boolean;
    hasCauseChain: boolean;
  },
): string[] {
  const strengths: string[] = [];
  if (checks.matchedTerms.length) {
    strengths.push(`回答触及了材料中的关键点：${checks.matchedTerms.slice(0, 3).join('、')}。`);
  }
  if (question.type === 'scenario' && checks.hasApplication) strengths.push('能把材料迁移到具体业务场景，而不是只停留在概念复述。');
  if (question.type === 'critical' && checks.hasCritical) strengths.push('能意识到观点存在适用条件和风险边界。');
  if (question.type === 'comparison' && checks.hasComparison) strengths.push('已经尝试建立两个概念或做法之间的边界。');
  if (question.type === 'principle' && checks.hasCauseChain) strengths.push('回答中出现了因果解释的雏形。');
  if (checks.hasStructure) strengths.push('表达采用分点结构，便于继续打磨。');
  if (!strengths.length) strengths.push(`已经围绕「${question.knowledgePoint}」开始作答，但还需要贴近材料。`);
  return strengths.slice(0, 3);
}

function buildWeaknesses(
  question: Question,
  checks: {
    confusionOnly: boolean;
    hasApplication: boolean;
    hasCritical: boolean;
    hasStructure: boolean;
    hasComparison: boolean;
    hasCauseChain: boolean;
    matchedTerms: string[];
  },
): string[] {
  if (checks.confusionOnly) {
    return [
      '当前回答主要是在反馈“题目不好答”，还没有真正完成作答。',
      `建议根据题目提示，先围绕「${question.knowledgePoint}」写出材料中的一句依据，再展开自己的判断。`,
    ];
  }

  const weaknesses: string[] = [];
  if (checks.matchedTerms.length < 2) weaknesses.push(`与参考答案中的核心材料点关联不足，需要回到「${question.knowledgePoint}」本身。`);
  if (question.type === 'principle' && !checks.hasCauseChain) weaknesses.push('因果题需要写出“原因 -> 机制 -> 结果”，目前链条不完整。');
  if (question.type === 'comparison' && !checks.hasComparison) weaknesses.push('对比题需要明确比较对象，并按定义、机制、场景、风险几个维度展开。');
  if (question.type === 'scenario' && !checks.hasApplication) weaknesses.push('场景题需要给出真实场景、推进步骤、负责人和衡量指标。');
  if (question.type === 'critical' && !checks.hasCritical) weaknesses.push('批判题需要写出失效条件、风险或反例，不能只复述材料观点。');
  if (question.type === 'expression' && !checks.hasStructure) weaknesses.push('表达题需要有清晰结构：结论、例子、价值、风险、行动建议。');
  return weaknesses.length ? weaknesses.slice(0, 4) : ['可以继续补充一个材料中的具体例子，让答案更有证据支撑。'];
}

function buildFollowUps(question: Question): string[] {
  switch (question.type) {
    case 'principle':
      return [`请把「${question.knowledgePoint}」改写成一条“原因 -> 机制 -> 结果”的链条。`];
    case 'comparison':
      return ['请用一张两列表，对两个概念分别写出定义、适用场景和风险。'];
    case 'scenario':
      return ['如果明天就要推进这件事，第一周的三个动作分别是什么？'];
    case 'critical':
      return ['这个观点在哪两种组织条件下最可能失效？'];
    case 'expression':
      return ['请把这段表达压缩成 1 分钟版本，保留一个例子和一个行动建议。'];
    case 'concept':
    default:
      return [`请用“不是 X，而是 Y，因为 Z”的句式重写「${question.knowledgePoint}」。`];
  }
}
