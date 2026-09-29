/**
 * OpenAI-compatible LLM client.
 *
 * This is the only module that talks to the model server. It speaks the
 * OpenAI Chat Completions protocol (`POST /v1/chat/completions` with SSE
 * streaming), so llama.cpp can be swapped for OpenAI, Ollama, vLLM, LM Studio,
 * LiteLLM… by changing the base URL / key in the settings — nothing else.
 */
import type { ChatCompletionParams, HealthStatus, ProviderConfig, ServerInfo } from '../types';

export class LLMApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LLMApiError';
    this.status = status;
  }
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

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const e = j?.error;
    return String((e && (e.message || e)) || j?.message || '');
  } catch {
    return '';
  }
}

/**
 * GET /health (llama.cpp, vLLM). Providers without it (OpenAI, Ollama)
 * answer 404 — we then fall back to GET /v1/models.
 */
export async function checkHealth(cfg: ProviderConfig, timeoutMs = 4000): Promise<Exclude<HealthStatus, 'checking' | 'demo'>> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const res = await fetch(`${base}/health`, { headers: authHeaders(cfg), signal: timeoutSignal(timeoutMs) });
  if (res.status === 503) return 'loading'; // llama.cpp: model still loading
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
  }
  return out;
}

/**
 * POST /v1/chat/completions with `stream: true`.
 * Yields content deltas as they arrive. Abort via `signal`.
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
  if (!res.body) throw new LLMApiError(res.status, 'Empty response body');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue; // comments, `event:` lines, blanks
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) throw new LLMApiError(chunk.error.code || 500, chunk.error.message || String(chunk.error));
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield delta.content as string;
        // Some servers (llama.cpp --reasoning-format, DeepSeek) stream reasoning separately:
        // it is not displayed, but yielding '' keeps the caller's inactivity timer alive.
        else if (delta?.reasoning_content) yield '';
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export const llmApi = { checkHealth, listModels, getServerInfo, streamChat, normalizeBaseUrl };
