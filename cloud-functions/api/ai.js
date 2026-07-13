const PROMPTS = {
  'knowledge-analyzer': `Analyze the provided learning source before any question generation. Return JSON with topics, concepts, logic, cases, applications, controversies, strategy, createdAt.`,
  'question-generator': `Generate high-value learning questions from the analysis. Avoid rote-memory questions. Return a JSON array with type, bloomLevel, difficulty, knowledgePoint, question, expectedAnswer, evaluationCriteria, reviewScore.`,
  'answer-evaluator': `Evaluate whether the user truly understands. Do not rely on keyword matching. Return a JSON array of evaluations with score, ability, strengths, weaknesses, missingPoints, followUpQuestions.`,
  'learning-recommendation': `Generate learning recommendations and an optional report patch. Return JSON with recommendations: mastery, gaps, supplements, practiceTasks, nextReviewFocus.`,
  'skill-router': `Route source type to one strategy mode. Return JSON only.`,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error('DeepSeek response did not include JSON.');
    return JSON.parse(match[0]);
  }
}

export async function onRequest(context) {
  const { request, env = {} } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'DEEPSEEK_API_KEY is not configured.' }, 501);
  }

  const { skill, input } = await request.json();
  const systemPrompt = PROMPTS[skill];
  if (!systemPrompt) {
    return jsonResponse({ error: `Unknown skill: ${skill}` }, 400);
  }

  const baseUrl = env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  const model = env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${systemPrompt}\n\nReturn valid JSON only.` },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
  });

  if (!response.ok) {
    return jsonResponse({ error: await response.text() }, response.status);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    return jsonResponse({ error: 'DeepSeek returned an empty message.' }, 502);
  }

  try {
    return jsonResponse({ data: parseJson(content) });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid JSON response.' }, 502);
  }
}
