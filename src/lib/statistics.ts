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

export interface TimelinePoint {
  key: string;
  label: string;
  shortLabel: string;
  start: number;
  end: number;
  requests: number;
  tokens: number;
  errors: number;
  conversations: number;
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
  timeline: TimelinePoint[];
}

interface Record {
  conversationId: string;
  timestamp: number;
  message: AssistantMessage;
  metrics: GenerationMetrics;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function periodStart(period: StatsPeriod, now = Date.now()): number {
  if (period === 'all') return 0;
  if (period === 'today') return startOfDay(now);
  return startOfDay(now - (period === '7d' ? 6 : 29) * 86_400_000);
}

function records(conversations: Conversation[], period: StatsPeriod): Record[] {
  const since = periodStart(period);
  const out: Record[] = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== 'assistant' || !message.metrics) continue;
      const timestamp = message.metrics.startedAt || message.createdAt;
      if (timestamp < since) continue;
      out.push({ conversationId: conversation.id, timestamp, message, metrics: message.metrics });
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

function timelineSpec(rows: Record[], period: StatsPeriod, now: number) {
  if (period === 'today') {
    return {
      start: startOfDay(now),
      step: 3_600_000,
      count: 24,
      label: (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      short: (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit' }),
    };
  }

  if (period === '7d' || period === '30d') {
    const count = period === '7d' ? 7 : 30;
    const start = startOfDay(now - (count - 1) * 86_400_000);
    return {
      start,
      step: 86_400_000,
      count,
      label: (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
      short: (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    };
  }

  const first = rows.length ? Math.min(...rows.map(r => r.timestamp)) : now;
  const span = Math.max(1, now - first);
  let step = 86_400_000;
  if (span <= 2 * 86_400_000) step = 3_600_000;
  else if (span > 60 * 86_400_000 && span <= 240 * 86_400_000) step = 7 * 86_400_000;
  else if (span > 240 * 86_400_000) step = 30 * 86_400_000;

  const rawStart = step < 86_400_000 ? Math.floor(first / step) * step : startOfDay(first);
  const count = Math.min(60, Math.max(1, Math.ceil((now - rawStart) / step) + 1));
  const start = Math.max(rawStart, now - (count - 1) * step);

  return {
    start,
    step,
    count,
    label: (ts: number) => step < 86_400_000
      ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit' })
      : new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: step >= 30 * 86_400_000 ? '2-digit' : undefined }),
    short: (ts: number) => step < 86_400_000
      ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit' })
      : new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
  };
}

function timeline(rows: Record[], period: StatsPeriod, now = Date.now()): TimelinePoint[] {
  const spec = timelineSpec(rows, period, now);
  const points: TimelinePoint[] = Array.from({ length: spec.count }, (_, i) => {
    const start = spec.start + i * spec.step;
    return {
      key: String(start),
      label: spec.label(start),
      shortLabel: spec.short(start),
      start,
      end: start + spec.step,
      requests: 0,
      tokens: 0,
      errors: 0,
      conversations: 0,
    };
  });

  const conversations = points.map(() => new Set<string>());
  for (const row of rows) {
    const idx = Math.floor((row.timestamp - spec.start) / spec.step);
    if (idx < 0 || idx >= points.length) continue;
    const point = points[idx];
    point.requests += 1;
    point.tokens += row.metrics.totalTokens || 0;
    if (row.message.status === 'error') point.errors += 1;
    conversations[idx].add(row.conversationId);
  }

  points.forEach((point, i) => { point.conversations = conversations[i].size; });
  return points;
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
    timeline: timeline(rows, period),
  };
}
