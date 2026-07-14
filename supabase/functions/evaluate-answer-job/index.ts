import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.88.0';
import { PROMPTS } from '../_shared/generated-prompts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type JsonRecord = Record<string, any>;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function waitUntil(task: Promise<unknown>): void {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(task);
    return;
  }
  task.catch((error) => console.error('Background task failed', error));
}

function trimText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function parseJson(content: string): JsonRecord {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error('DeepSeek response did not include JSON.');
    return JSON.parse(match[0]);
  }
}

function normalizeEvaluation(question: JsonRecord, parsed: JsonRecord): JsonRecord {
  const evaluations = Array.isArray(parsed) ? parsed : parsed.evaluations;
  const evaluation = evaluations?.[0];
  if (!evaluation) throw new Error('DeepSeek JSON did not include evaluations[0].');
  return {
    questionId: evaluation.questionId || question.id,
    score: Math.max(0, Math.min(100, Math.round(Number(evaluation.score) || 0))),
    ability: {
      concept: Math.max(0, Math.min(100, Math.round(Number(evaluation.ability?.concept) || 0))),
      logic: Math.max(0, Math.min(100, Math.round(Number(evaluation.ability?.logic) || 0))),
      application: Math.max(0, Math.min(100, Math.round(Number(evaluation.ability?.application) || 0))),
      critical: Math.max(0, Math.min(100, Math.round(Number(evaluation.ability?.critical) || 0))),
      expression: Math.max(0, Math.min(100, Math.round(Number(evaluation.ability?.expression) || 0))),
    },
    strengths: (evaluation.strengths ?? []).slice(0, 3).map((item: unknown) => trimText(item, 120)),
    weaknesses: (evaluation.weaknesses ?? []).slice(0, 4).map((item: unknown) => trimText(item, 120)),
    missingPoints: (evaluation.missingPoints ?? []).slice(0, 5).map((item: unknown) => trimText(item, 120)),
    followUpQuestions: (evaluation.followUpQuestions ?? []).slice(0, 2).map((item: unknown) => trimText(item, 120)),
  };
}

function buildEvaluatorInput(question: JsonRecord, answer: JsonRecord): JsonRecord {
  return {
    compact: true,
    question: {
      id: question.id,
      type: question.type,
      bloomLevel: question.bloomLevel,
      knowledgePoint: trimText(question.knowledgePoint, 900),
      question: trimText(question.question, 1200),
      contextHint: trimText(question.contextHint, 1200),
      expectedAnswer: trimText(question.expectedAnswer, 2400),
      evaluationCriteria: (question.evaluationCriteria ?? []).slice(0, 5).map((item: unknown) => trimText(item, 220)),
    },
    answer: {
      questionId: answer.questionId,
      answer: trimText(answer.answer, 12000),
    },
  };
}

function getOpenQuestions(request: JsonRecord): JsonRecord[] {
  return (request.questionSet?.questions ?? []).filter((question: JsonRecord) => question.format !== 'choice');
}

function findAnswer(request: JsonRecord, questionId: string): JsonRecord {
  return (request.answers ?? []).find((answer: JsonRecord) => answer.questionId === questionId) ?? { questionId, answer: '' };
}

async function callDeepSeek(question: JsonRecord, answer: JsonRecord): Promise<JsonRecord> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured.');

  const baseUrl = Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
  const model = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-pro';
  const maxTokens = Number(Deno.env.get('DEEPSEEK_EVALUATOR_MAX_TOKENS')) || 3200;
  const requestTimeoutMs = Number(Deno.env.get('DEEPSEEK_EVALUATOR_REQUEST_TIMEOUT_MS')) || 120000;
  const thinkingType = Deno.env.get('DEEPSEEK_EVALUATOR_THINKING') ?? 'enabled';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        thinking: { type: thinkingType === 'disabled' ? 'disabled' : 'enabled' },
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${PROMPTS['answer-evaluator']}\n\nReturn valid JSON only.` },
          { role: 'user', content: JSON.stringify(buildEvaluatorInput(question, answer)) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek returned an empty message.');
    return normalizeEvaluation(question, parseJson(content));
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`DeepSeek evaluator timed out after ${requestTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateJob(supabase: ReturnType<typeof getServiceClient>, jobId: string, patch: JsonRecord) {
  const { error } = await supabase
    .from('evaluation_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

async function processJob(jobId: string): Promise<void> {
  const supabase = getServiceClient();
  const { data: job, error } = await supabase.from('evaluation_jobs').select('*').eq('id', jobId).single();
  if (error) throw error;
  if (!job || job.status === 'succeeded' || job.status === 'failed') return;

  const now = Date.now();
  if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() > now && job.status === 'processing') return;

  const sliceMs = Number(Deno.env.get('EVALUATION_JOB_SLICE_MS')) || 130000;
  const leaseMs = Number(Deno.env.get('EVALUATION_JOB_LEASE_MS')) || Math.max(sliceMs + 30000, 160000);
  const deadline = Date.now() + sliceMs;
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();

  await updateJob(supabase, jobId, {
    status: 'processing',
    error: null,
    lease_expires_at: leaseExpiresAt,
  });

  const request = job.request;
  const questions = getOpenQuestions(request);
  const results: JsonRecord[] = Array.isArray(job.result) ? [...job.result] : [];
  const completed = new Set(results.map((evaluation) => evaluation.questionId));

  try {
    for (const question of questions) {
      if (completed.has(question.id)) continue;
      if (Date.now() > deadline - 10_000) break;

      const answer = findAnswer(request, question.id);
      const evaluation = await callDeepSeek(question, answer);
      results.push(evaluation);
      completed.add(question.id);

      await updateJob(supabase, jobId, {
        status: 'processing',
        progress: results.length,
        total: questions.length,
        result: results,
        lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
      });
    }

    const complete = results.length >= questions.length;
    await updateJob(supabase, jobId, {
      status: complete ? 'succeeded' : 'queued',
      progress: results.length,
      total: questions.length,
      result: results,
      lease_expires_at: null,
      completed_at: complete ? new Date().toISOString() : null,
    });
  } catch (processError) {
    await updateJob(supabase, jobId, {
      status: 'failed',
      error: processError instanceof Error ? processError.message : 'Evaluation job failed.',
      lease_expires_at: null,
    });
  }
}

async function startJob(payload: JsonRecord): Promise<Response> {
  const supabase = getServiceClient();
  const request = { questionSet: payload.questionSet, answers: payload.answers };
  const openQuestions = getOpenQuestions(request);
  const { data, error } = await supabase
    .from('evaluation_jobs')
    .insert({
      question_set_id: payload.questionSet?.id ?? null,
      status: 'queued',
      progress: 0,
      total: openQuestions.length,
      request,
      result: [],
    })
    .select('id,status,progress,total')
    .single();

  if (error) throw error;
  waitUntil(processJob(data.id));
  return jsonResponse({ jobId: data.id, status: data.status, progress: data.progress, total: data.total });
}

async function getJobStatus(payload: JsonRecord): Promise<Response> {
  const supabase = getServiceClient();
  const { data: job, error } = await supabase.from('evaluation_jobs').select('*').eq('id', payload.jobId).single();
  if (error) throw error;
  if (!job) return jsonResponse({ error: 'Job not found.' }, 404);

  const leaseExpired = !job.lease_expires_at || new Date(job.lease_expires_at).getTime() <= Date.now();
  if ((job.status === 'queued' || (job.status === 'processing' && leaseExpired)) && job.progress < job.total) {
    waitUntil(processJob(job.id));
  }

  return jsonResponse({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    total: job.total,
    error: job.error,
    evaluations: job.status === 'succeeded' ? job.result : undefined,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  try {
    const payload = await request.json();
    if (payload.action === 'start') return await startJob(payload);
    if (payload.action === 'status') return await getJobStatus(payload);
    return jsonResponse({ error: 'Unknown action.' }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500);
  }
});
