import { PROMPTS } from './generated-prompts.js';

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

function normalizeSkillData(skill, parsed) {
  if (skill === 'question-generator') {
    return Array.isArray(parsed) ? parsed : parsed.questions;
  }
  if (skill === 'answer-evaluator') {
    return Array.isArray(parsed) ? parsed : parsed.evaluations;
  }
  return parsed;
}

function getDefaultMaxTokens(skill, input) {
  if (skill === 'answer-evaluator') return 2200;
  if (skill === 'learning-recommendation') return 3000;
  if (skill === 'knowledge-analyzer') return 3000;
  if (skill === 'question-generator') {
    return input?.questionFormat === 'choice' ? 10000 : 6500;
  }
  return 4096;
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
  const maxTokens = Number(env.DEEPSEEK_MAX_TOKENS) || getDefaultMaxTokens(skill, input);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
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
    const parsed = parseJson(content);
    const data = normalizeSkillData(skill, parsed);
    if (!data) {
      return jsonResponse({ error: `DeepSeek JSON did not include data for ${skill}.` }, 502);
    }
    return jsonResponse({ data });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid JSON response.' }, 502);
  }
}
