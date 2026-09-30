import type { AssistantMessage, Conversation, GenerationMetrics } from '../types';

export type StatsPeriod = 'today' | '7d' | '30d' | 'all';

export interface ModelStats {
  key: string;
  label: string;
  provider: string;
  providerLabel: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerSecond?: number;
  avgTtftMs?: number;
  avgDurationMs?: number;
  costUsd: number;
  knownCostRequests: number;
}

export interface UsageStats {
  requests: number;
  successful: number;
  errors: number;
  stopped: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerSecond?: number;
  avgTtftMs?: number;
  avgDurationMs?: number;
  totalDurationMs: number;
  reconnects: number;
  costUsd: number;
  knownCostRequests: number;
  estimatedTokenRequests: number;
  byModel: ModelStats[];
  byProvider: ModelStats[];
}

interface Record {
  message: AssistantMessage;
  metrics: GenerationMetrics;
}

function periodStart(period: StatsPeriod, now = Date.now()): number {
  if (period === 'all') return 0;
  if (period === 'today') {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  return now - (period === '7d' ? 7 : 30) * 86_400_000;
}

function records(conversations: Conversation[], period: StatsPeriod): Record[] {
  const since = periodStart(period);
  const out: Record[] = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== 'assistant' || !message.metrics) continue;
      const at = message.metrics.startedAt || message.createdAt;
      if (at < since) continue;
      out.push({ message, metrics: message.metrics });
    }
  }
  return out;
}

function avg(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return undefined;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function group(
  rows: Record[],
  keyOf: (r: Record) => string,
  labelOf: (r: Record) => string,
  providerOf: (r: Record) => [string, string],
): ModelStats[] {
  const map = new Map<string, Record[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()].map(([key, items]) => {
    const [provider, providerLabel] = providerOf(items[0]);
    return {
      key,
      label: labelOf(items[0]),
      provider,
      providerLabel,
      requests: items.length,
      errors: items.filter(x => x.message.status === 'error').length,
      inputTokens: items.reduce((n, x) => n + (x.metrics.inputTokens || 0), 0),
      outputTokens: items.reduce((n, x) => n + (x.metrics.outputTokens || 0), 0),
      totalTokens: items.reduce((n, x) => n + (x.metrics.totalTokens || 0), 0),
      avgTokensPerSecond: avg(items.map(x => x.metrics.tokensPerSecond)),
      avgTtftMs: avg(items.map(x => x.metrics.ttftMs)),
      avgDurationMs: avg(items.map(x => x.metrics.durationMs)),
      costUsd: items.reduce((n, x) => n + (typeof x.metrics.costUsd === 'number' ? x.metrics.costUsd : 0), 0),
      knownCostRequests: items.filter(x => typeof x.metrics.costUsd === 'number').length,
    };
  }).sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);
}

export function usageStatistics(conversations: Conversation[], period: StatsPeriod): UsageStats {
  const rows = records(conversations, period);
  return {
    requests: rows.length,
    successful: rows.filter(x => x.message.status === 'done').length,
    errors: rows.filter(x => x.message.status === 'error').length,
    stopped: rows.filter(x => x.message.status === 'stopped').length,
    inputTokens: rows.reduce((n, x) => n + (x.metrics.inputTokens || 0), 0),
    outputTokens: rows.reduce((n, x) => n + (x.metrics.outputTokens || 0), 0),
    totalTokens: rows.reduce((n, x) => n + (x.metrics.totalTokens || 0), 0),
    avgTokensPerSecond: avg(rows.map(x => x.metrics.tokensPerSecond)),
    avgTtftMs: avg(rows.map(x => x.metrics.ttftMs)),
    avgDurationMs: avg(rows.map(x => x.metrics.durationMs)),
    totalDurationMs: rows.reduce((n, x) => n + (x.metrics.durationMs || 0), 0),
    reconnects: rows.reduce((n, x) => n + (x.metrics.reconnects || 0), 0),
    costUsd: rows.reduce((n, x) => n + (typeof x.metrics.costUsd === 'number' ? x.metrics.costUsd : 0), 0),
    knownCostRequests: rows.filter(x => typeof x.metrics.costUsd === 'number').length,
    estimatedTokenRequests: rows.filter(x => x.metrics.tokenCountSource === 'estimated').length,
    byModel: group(
      rows,
      x => x.metrics.modelId,
      x => x.message.author || x.metrics.resolvedModel || x.metrics.modelId,
      x => [x.metrics.provider, x.metrics.providerLabel || x.metrics.provider],
    ),
    byProvider: group(
      rows,
      x => x.metrics.provider,
      x => x.metrics.providerLabel || x.metrics.provider,
      x => [x.metrics.provider, x.metrics.providerLabel || x.metrics.provider],
    ),
  };
}
