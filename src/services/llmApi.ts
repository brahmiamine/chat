/**
 * OpenAI-compatible LLM client.
 *
 * Besides normal OpenAI SSE streaming, Lueur's local Termux router exposes
 * resumable background generations. Those jobs are owned by the router, so a
 * browser/tab disconnect does not cancel llama.cpp.
 */
import type { ChatCompletionParams, GenerationMetrics, HealthStatus, ProviderConfig, ServerInfo, TokenCountSource } from '../types';

/** The response had started, then the connection dropped mid-stream (not a CORS issue). */
export class StreamInterruptedError extends Error {
  constructor() {
    super('Stream interrupted');
    this.name = 'StreamInterruptedError';
  }
}

export class LLMApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LLMApiError';
    this.status = status;
  }
}

interface RouterGenerationMetrics {
  provider?: string;
  provider_label?: string;
  model_id?: string;
  resolved_model?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  token_count_source?: TokenCountSource;
  ttft_ms?: number | null;
  duration_ms?: number | null;
  generation_ms?: number | null;
  tokens_per_second?: number | null;
  queue_ms?: number | null;
  context_limit?: number | null;
  finish_reason?: string | null;
  cost_usd?: number | null;
  reconnects?: number;
  http_status?: number | null;
  started_at?: number;
  completed_at?: number | null;
}

export interface BackgroundGeneration {
  id: string;
  status: 'running' | 'done' | 'stopped' | 'error';
  content: string;
  cursor: number;
  error?: string | null;
  error_code?: number | null;
  updated_at?: number;
  metrics?: RouterGenerationMetrics;
}

export function generationMetrics(snapshot: BackgroundGeneration): GenerationMetrics | undefined {
  const m = snapshot.metrics;
  if (!m?.provider || !m.model_id) return undefined;
  return {
    provider: m.provider,
    providerLabel: m.provider_label,
    modelId: m.model_id,
    resolvedModel: m.resolved_model,
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    totalTokens: m.total_tokens,
    tokenCountSource: m.token_count_source,
    ttftMs: m.ttft_ms ?? undefined,
    durationMs: m.duration_ms ?? undefined,
    generationMs: m.generation_ms ?? undefined,
    tokensPerSecond: m.tokens_per_second ?? undefined,
    queueMs: m.queue_ms ?? undefined,
    contextLimit: m.context_limit ?? undefined,
    finishReason: m.finish_reason ?? undefined,
    costUsd: m.cost_usd,
    reconnects: m.reconnects,
    httpStatus: m.http_status ?? undefined,
    startedAt: m.started_at,
    completedAt: m.completed_at ?? undefined,
  };
}

/** Server root: tolerates a pasted `/v1` or full `/v1/chat/completions` endpoint. */
export function normalizeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1(\/chat\/completions)?$/, '');
}

function authHeaders(cfg: ProviderConfig): Record<string, string> {
  return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

function jsonHeaders(cfg: ProviderConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders(cfg) };
}

function timeoutSignal(ms: number, outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return outer && 'any' in AbortSignal ? AbortSignal.any([t, outer]) : t;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>(resolve => window.setTimeout(resolve, ms));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const e = j?.error;
    return String((e && (e.message || e)) || j?.message || '');
  } catch {
    return '';
  }
}

/** Parse an OpenAI-compatible SSE response into visible content deltas. */
async function* parseSse(
  res: Response,
  signal: AbortSignal,
  strictDone = false,
): AsyncGenerator<string, void, void> {
  if (!res.body) throw new LLMApiError(res.status, 'Empty response body');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let gotDone = false;
  try {
    while (true) {
      let part: ReadableStreamReadResult<string>;
      try {
        part = await reader.read();
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || signal.aborted) throw e;
        throw new StreamInterruptedError();
      }

      const { done, value } = part;
      if (done) break;
      buf += value;

      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);

        // Router/model-loading/background keepalive.
        if (line.startsWith(':')) {
          yield '';
          continue;
        }
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          gotDone = true;
          return;
        }

        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) {
          throw new LLMApiError(
            chunk.error.code || 500,
            chunk.error.message || String(chunk.error),
          );
        }

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield delta.content as string;
        else if (delta?.reasoning_content) yield '';
      }
    }

    if (strictDone && !gotDone && !signal.aborted) {
      throw new StreamInterruptedError();
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * GET /health (llama.cpp, vLLM). Providers without it (OpenAI, Ollama)
 * answer 404 — we then fall back to GET /v1/models.
 */
export async function checkHealth(cfg: ProviderConfig, timeoutMs = 4000): Promise<Exclude<HealthStatus, 'checking' | 'demo'>> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const res = await fetch(`${base}/health`, { headers: authHeaders(cfg), signal: timeoutSignal(timeoutMs) });
  if (res.status === 503) return 'loading';
  if (res.ok) {
    let body: { status?: string } = {};
    try { body = await res.json(); } catch { /* vLLM returns an empty body */ }
    return !body.status || body.status === 'ok' ? 'online' : 'offline';
  }
  if (res.status === 404) {
    const r = await fetch(`${base}/v1/models`, { headers: authHeaders(cfg), signal: timeoutSignal(timeoutMs) });
    return r.ok ? 'online' : 'offline';
  }
  return 'offline';
}

/** True only for Lueur's router that can keep a generation alive server-side. */
export async function supportsBackgroundGenerations(cfg: ProviderConfig): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/health`, {
      headers: authHeaders(cfg),
      signal: timeoutSignal(4000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.background_generations === true;
  } catch {
    return false;
  }
}

/** GET /v1/models — ids of models exposed by the server. */
export async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/v1/models`, { headers: authHeaders(cfg), signal: timeoutSignal(5000, signal) });
  if (!res.ok) throw new LLMApiError(res.status, await readErrorMessage(res));
  const j = await res.json();
  const list: Array<{ id?: string; name?: string; model?: string }> = j.data || j.models || [];
  return list.map(m => m.id || m.name || m.model || '').filter(Boolean);
}

/** Best-effort server details: models + llama.cpp `/props` (model path, context size). */
export async function getServerInfo(cfg: ProviderConfig): Promise<ServerInfo> {
  const out: ServerInfo = { models: [] };
  const [models, props] = await Promise.allSettled([
    listModels(cfg),
    fetch(`${normalizeBaseUrl(cfg.baseUrl)}/props`, { headers: authHeaders(cfg), signal: timeoutSignal(5000) }).then(r => (r.ok ? r.json() : null)),
  ]);
  if (models.status === 'fulfilled') out.models = models.value;
  if (props.status === 'fulfilled' && props.value) {
    const p = props.value;
    out.modelPath = p.model_path;
    out.nCtx = p.default_generation_settings?.n_ctx ?? p.n_ctx;
    if (p.providers && typeof p.providers === 'object') out.providers = p.providers;
  }
  return out;
}

/**
 * Normal OpenAI-compatible POST /v1/chat/completions with streaming.
 */
export async function* streamChat(
  cfg: ProviderConfig,
  params: ChatCompletionParams,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...jsonHeaders(cfg), Accept: 'text/event-stream' },
    body: JSON.stringify({ ...params, stream: true }),
    signal,
  });
  if (!res.ok) throw new LLMApiError(res.status, await readErrorMessage(res));
  yield* parseSse(res, signal);
}

/**
 * Starts an idempotent router-owned generation. If the public connection drops,
 * it reconnects to the same job instead of asking llama.cpp to generate twice.
 */
export async function* streamBackgroundChat(
  cfg: ProviderConfig,
  params: ChatCompletionParams,
  jobId: string,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  let cursor = 0;
  let initial = true;

  while (!signal.aborted) {
    try {
      let res: Response;

      if (initial) {
        res = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: { ...jsonHeaders(cfg), Accept: 'text/event-stream' },
          body: JSON.stringify({
            ...params,
            stream: true,
            _lueur_job_id: jobId,
            _lueur_cursor: cursor,
          }),
          signal,
        });
      } else {
        res = await fetch(
          `${base}/lueur/generations/${encodeURIComponent(jobId)}/stream?cursor=${cursor}`,
          { headers: { ...authHeaders(cfg), Accept: 'text/event-stream' }, signal },
        );
      }

      if (!res.ok) throw new LLMApiError(res.status, await readErrorMessage(res));
      initial = false;

      for await (const token of parseSse(res, signal, true)) {
        if (token) cursor += codePointLength(token);
        yield token;
      }
      return;
    } catch (e) {
      if (signal.aborted || (e as Error)?.name === 'AbortError') throw e;
      if (e instanceof LLMApiError) throw e;

      // A mobile browser may suspend/drop the SSE socket while hidden. The
      // router keeps generating; reconnect after a short delay.
      yield '';
      await sleep(800, signal);
    }
  }
}

/** Re-attach to a router-owned generation after a page reload/browser reopen. */
export async function* resumeBackgroundChat(
  cfg: ProviderConfig,
  jobId: string,
  cursor: number,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  let offset = Math.max(0, cursor);

  while (!signal.aborted) {
    try {
      const res = await fetch(
        `${base}/lueur/generations/${encodeURIComponent(jobId)}/stream?cursor=${offset}`,
        { headers: { ...authHeaders(cfg), Accept: 'text/event-stream' }, signal },
      );
      if (!res.ok) throw new LLMApiError(res.status, await readErrorMessage(res));

      for await (const token of parseSse(res, signal, true)) {
        if (token) offset += codePointLength(token);
        yield token;
      }
      return;
    } catch (e) {
      if (signal.aborted || (e as Error)?.name === 'AbortError') throw e;
      if (e instanceof LLMApiError) throw e;
      yield '';
      await sleep(800, signal);
    }
  }
}

export async function getBackgroundGeneration(
  cfg: ProviderConfig,
  jobId: string,
): Promise<BackgroundGeneration> {
  const res = await fetch(
    `${normalizeBaseUrl(cfg.baseUrl)}/lueur/generations/${encodeURIComponent(jobId)}`,
    { headers: authHeaders(cfg), signal: timeoutSignal(5000) },
  );
  if (!res.ok) throw new LLMApiError(res.status, await readErrorMessage(res));
  return res.json();
}

export async function cancelBackgroundGeneration(
  cfg: ProviderConfig,
  jobId: string,
): Promise<void> {
  const res = await fetch(
    `${normalizeBaseUrl(cfg.baseUrl)}/lueur/generations/${encodeURIComponent(jobId)}/cancel`,
    {
      method: 'POST',
      headers: jsonHeaders(cfg),
      body: '{}',
      signal: timeoutSignal(5000),
    },
  );
  if (!res.ok && res.status !== 404) throw new LLMApiError(res.status, await readErrorMessage(res));
}

/**
 * Network-level probe that ignores CORS (`no-cors` yields an opaque response).
 * If this succeeds while a normal request failed, the server is reachable but
 * does not allow this page's origin.
 */
export async function isReachableIgnoringCors(cfg: ProviderConfig): Promise<boolean> {
  try {
    await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/health`, { mode: 'no-cors', signal: timeoutSignal(5000) });
    return true;
  } catch {
    return false;
  }
}

export const llmApi = {
  checkHealth,
  listModels,
  getServerInfo,
  streamChat,
  supportsBackgroundGenerations,
  streamBackgroundChat,
  resumeBackgroundChat,
  getBackgroundGeneration,
  cancelBackgroundGeneration,
  normalizeBaseUrl,
  isReachableIgnoringCors,
};
