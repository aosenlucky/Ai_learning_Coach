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

function getRequestedCount(request: JsonRecord): number {
  const questionFormat = request.questionFormat === 'choice' ? 'choice' : 'open';
  const requested = Number(request.requestedCount);
  const fallback = questionFormat === 'choice' ? 20 : 8;
  const max = questionFormat === 'choice' ? 50 : 15;
  return Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : fallback, 3), max);
}

function getBatchSize(request: JsonRecord): number {
  const configured = Number(Deno.env.get('QUESTION_GENERATOR_BATCH_SIZE'));
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return request.questionFormat === 'choice' ? 8 : 5;
}

function normalizeQuestion(raw: JsonRecord, request: JsonRecord): JsonRecord {
  const format = raw.format === 'choice' || request.questionFormat === 'choice' ? 'choice' : 'open';
  const options = Array.isArray(raw.options)
    ? raw.options.slice(0, 4).map((option: JsonRecord, index: number) => ({
        id: String(option.id ?? String.fromCharCode(65 + index)).slice(0, 2),
        text: trimText(option.text, 500),
        rationale: trimText(option.rationale, 700),
      }))
    : undefined;

  return {
    format,
    type: raw.type ?? 'concept',
    bloomLevel: raw.bloomLevel ?? (format === 'choice' ? 'Understand' : 'Apply'),
    difficulty: Math.max(1, Math.min(5, Math.round(Number(raw.difficulty) || 3))),
    knowledgePoint: trimText(raw.knowledgePoint, 600),
    question: trimText(raw.question, 900),
    contextHint: trimText(raw.contextHint, 900),
    options,
    correctOptionIds: Array.isArray(raw.correctOptionIds) ? raw.correctOptionIds.slice(0, 1).map(String) : undefined,
    explanation: trimText(raw.explanation, 900),
    expectedAnswer: trimText(raw.expectedAnswer, 1200),
    evaluationCriteria: Array.isArray(raw.evaluationCriteria)
      ? raw.evaluationCriteria.slice(0, 5).map((item: unknown) => trimText(item, 240))
      : [],
    reviewScore: Math.max(0, Math.min(100, Math.round(Number(raw.reviewScore) || 85))),
  };
}

function normalizeQuestions(parsed: JsonRecord, request: JsonRecord): JsonRecord[] {
  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(questions)) throw new Error('DeepSeek JSON did not include questions array.');
  return questions.map((question) => normalizeQuestion(question, request));
}

function buildGeneratorInput(request: JsonRecord, count: number, existingQuestions: JsonRecord[]): JsonRecord {
  return {
    source: request.source,
    analysis: request.analysis,
    mode: request.mode,
    requestedCount: count,
    questionFormat: request.questionFormat,
    existingQuestions: existingQuestions.map((question) => ({
      type: question.type,
      knowledgePoint: question.knowledgePoint,
      question: question.question,
      correctOptionIds: question.correctOptionIds,
      options: (question.options ?? []).map((option: JsonRecord) => option.text),
    })),
    generationInstruction:
      '继续生成新的题目，不要重复 existingQuestions 的知识点、题干、正确项表达或干扰项结构；若是选择题，四个选项必须同等可信，不能出现一眼排除项。',
  };
}

async function callDeepSeek(request: JsonRecord, count: number, existingQuestions: JsonRecord[]): Promise<JsonRecord[]> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured.');

  const baseUrl = Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
  const model = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-pro';
  const maxTokens = Number(Deno.env.get('QUESTION_GENERATOR_MAX_TOKENS')) || (request.questionFormat === 'choice' ? 9000 : 6500);
  const requestTimeoutMs = Number(Deno.env.get('QUESTION_GENERATOR_REQUEST_TIMEOUT_MS')) || 120000;
  const thinkingType = Deno.env.get('QUESTION_GENERATOR_THINKING') ?? Deno.env.get('DEEPSEEK_THINKING') ?? 'enabled';
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
        temperature: 0.35,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${PROMPTS['question-generator']}\n\nReturn valid JSON only.` },
          { role: 'user', content: JSON.stringify(buildGeneratorInput(request, count, existingQuestions)) },
        ],
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek returned an empty message.');
    return normalizeQuestions(parseJson(content), request);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`DeepSeek question generator timed out after ${requestTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateJob(supabase: ReturnType<typeof getServiceClient>, jobId: string, patch: JsonRecord) {
  const { error } = await supabase
    .from('question_generation_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

async function processJob(jobId: string): Promise<void> {
  const supabase = getServiceClient();
  const { data: job, error } = await supabase.from('question_generation_jobs').select('*').eq('id', jobId).single();
  if (error) throw error;
  if (!job || job.status === 'succeeded' || job.status === 'failed') return;

  const now = Date.now();
  if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() > now && job.status === 'processing') return;

  const request = job.request;
  const total = getRequestedCount(request);
  const batchSize = getBatchSize(request);
  const sliceMs = Number(Deno.env.get('QUESTION_GENERATION_JOB_SLICE_MS')) || 130000;
  const leaseMs = Number(Deno.env.get('QUESTION_GENERATION_JOB_LEASE_MS')) || Math.max(sliceMs + 30000, 160000);
  const deadline = Date.now() + sliceMs;
  const results: JsonRecord[] = Array.isArray(job.result) ? [...job.result] : [];

  await updateJob(supabase, jobId, {
    status: 'processing',
    total,
    error: null,
    lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
  });

  try {
    while (results.length < total && Date.now() <= deadline - 10_000) {
      const count = Math.min(batchSize, total - results.length);
      const questions = await callDeepSeek(request, count, results);
      results.push(...questions.slice(0, count));
      await updateJob(supabase, jobId, {
        status: 'processing',
        progress: results.length,
        total,
        result: results,
        lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
      });
    }

    const complete = results.length >= total;
    await updateJob(supabase, jobId, {
      status: complete ? 'succeeded' : 'queued',
      progress: results.length,
      total,
      result: results.slice(0, total),
      lease_expires_at: null,
      completed_at: complete ? new Date().toISOString() : null,
    });
  } catch (processError) {
    await updateJob(supabase, jobId, {
      status: 'failed',
      error: processError instanceof Error ? processError.message : 'Question generation job failed.',
      lease_expires_at: null,
    });
  }
}

async function startJob(payload: JsonRecord): Promise<Response> {
  const supabase = getServiceClient();
  const request = {
    source: payload.source,
    analysis: payload.analysis,
    mode: payload.mode,
    requestedCount: payload.requestedCount,
    questionFormat: payload.questionFormat,
  };
  const total = getRequestedCount(request);
  const { data, error } = await supabase
    .from('question_generation_jobs')
    .insert({
      status: 'queued',
      progress: 0,
      total,
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
  const { data: job, error } = await supabase.from('question_generation_jobs').select('*').eq('id', payload.jobId).single();
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
    questions: job.status === 'succeeded' ? job.result : undefined,
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
