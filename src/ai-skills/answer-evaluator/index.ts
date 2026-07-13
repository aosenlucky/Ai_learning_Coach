import type { AbilityScore, Evaluation, Question, UserAnswer } from '../../types';
import { clampScore, pickTopTerms } from '../../lib/text';

function scoreCoverage(answer: string, expected: string): number {
  const expectedTerms = pickTopTerms(expected, 8);
  if (expectedTerms.length === 0) return 70;
  const hitCount = expectedTerms.filter((term) => answer.includes(term)).length;
  return clampScore(45 + (hitCount / expectedTerms.length) * 45 + Math.min(answer.length / 80, 1) * 10);
}

export function evaluateAnswer(question: Question, answer: UserAnswer): Evaluation {
  const content = answer.answer.trim();
  const coverage = scoreCoverage(content, `${question.knowledgePoint} ${question.expectedAnswer}`);
  const hasApplication = /场景|流程|指标|步骤|落地|业务|案例|实践/.test(content);
  const hasCritical = /风险|限制|反例|条件|边界|不一定|但是/.test(content);
  const hasStructure = /第一|第二|首先|其次|最后|1\.|2\.|3\./.test(content);
  const lengthScore = clampScore(Math.min(content.length / 220, 1) * 100);

  const ability: AbilityScore = {
    concept: clampScore(coverage),
    logic: clampScore(coverage * 0.65 + (hasStructure ? 25 : 8)),
    application: clampScore(coverage * 0.55 + (hasApplication ? 35 : 10)),
    critical: clampScore(coverage * 0.55 + (hasCritical ? 35 : 8)),
    expression: clampScore(lengthScore * 0.55 + (hasStructure ? 35 : 18)),
  };

  const score = clampScore(
    ability.concept * 0.2 +
      ability.logic * 0.2 +
      ability.application * 0.25 +
      ability.critical * 0.2 +
      ability.expression * 0.15,
  );

  const weaknesses = [
    ability.application < 75 ? '应用场景和行动步骤还不够具体' : '',
    ability.critical < 75 ? '风险边界和反例意识可以继续加强' : '',
    ability.logic < 75 ? '因果链条需要表达得更完整' : '',
  ].filter(Boolean);

  return {
    questionId: question.id,
    score,
    ability,
    strengths: [
      score >= 80 ? '能够抓住题目的主要意图' : '已经形成了初步回答框架',
      hasStructure ? '表达结构较清晰' : '有可继续组织成结构化表达的内容',
    ],
    weaknesses: weaknesses.length ? weaknesses : ['可以继续补充更有挑战性的真实案例'],
    missingPoints: pickTopTerms(question.expectedAnswer, 4).filter((term) => !content.includes(term)),
    followUpQuestions: [
      `如果把这个回答放进真实业务场景，第一步验证动作是什么？`,
      `这个结论在什么条件下会变得不成立？`,
    ],
  };
}
