/**
 * Conversation state + generation lifecycle.
 *
 * Background-generation notes
 * - On Lueur's Termux router, llama.cpp generation is owned by the router.
 *   Closing/suspending the browser only disconnects the viewer; it does not
 *   cancel the model.
 * - The assistant message stores a generationId in IndexedDB. When Lueur is
 *   opened again it asks the router for the current job snapshot, catches up,
 *   then re-attaches to the live SSE stream.
 * - Explicit "Stop" still cancels the router-owned job.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentStep, AssistantMessage, AttachedFile, ChatCompletionParams, ChatError, Conversation, GenerationMetrics, MessageStatus, Settings, UserMessage } from '../types';
import { generationMetrics, LLMApiError, llmApi, type LueurMeta } from '../services/llmApi';
import { demoStream } from '../services/demoProvider';
import { conversationDb } from '../services/db';
import { diagnoseError, type AbortReason } from '../services/errors';
import { buildHistory, makeTitle, uid } from '../lib/chat';
import { currentModel } from '../lib/settings';

const INACTIVITY_TIMEOUT_MS = 90_000;
const CHECKPOINT_MS = 1500;
const ACTIVE_KEY = 'lueur.active';

function estimateOutputTokens(text: string): number {
  const chars = Array.from(text || '').length;
  return chars ? Math.max(1, Math.round(chars / 4)) : 0;
}

function fallbackMetrics(
  model: ReturnType<typeof currentModel>,
  startedAt: number,
  firstTokenAt: number | undefined,
  completedAt: number,
  content: string,
): GenerationMetrics {
  const outputTokens = estimateOutputTokens(content);
  const generationMs = firstTokenAt ? Math.max(0, completedAt - firstTokenAt) : undefined;
  return {
    provider: model.provider || 'custom',
    providerLabel: model.providerLabel,
    modelId: model.id,
    resolvedModel: model.id.replace(/^[a-z]+::/i, ''),
    outputTokens,
    totalTokens: outputTokens,
    tokenCountSource: 'estimated',
    ttftMs: firstTokenAt ? Math.max(0, firstTokenAt - startedAt) : undefined,
    durationMs: Math.max(0, completedAt - startedAt),
    generationMs,
    tokensPerSecond: generationMs && outputTokens ? Number((outputTokens / (generationMs / 1000)).toFixed(2)) : undefined,
    costUsd: model.provider === 'local' ? 0 : null,
    reconnects: 0,
    startedAt,
    completedAt,
  };
}

export interface LiveStream {
  cid: string;
  mid: string;
  content: string;
}

interface Options {
  /** Called when a generation fails for a network reason (to refresh the Online/Offline badge). */
  onConnectionError?: () => void;
}

interface ActiveRun {
  ctrl: AbortController;
  reason: AbortReason;
  cid: string;
  mid: string;
  jobId?: string;
  background: boolean;
}

export function useChat(settings: Settings, { onConnectionError }: Options = {}) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStream | null>(null);

  // Refs mirror the latest values for async code (streams outlive renders).
  const convsRef = useRef(convs);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onConnErrRef = useRef(onConnectionError);
  onConnErrRef.current = onConnectionError;
  const run = useRef<ActiveRun | null>(null);

  /** Synchronously updates the ref and schedules the React state update. */
  const commit = useCallback((fn: (list: Conversation[]) => Conversation[]) => {
    convsRef.current = fn(convsRef.current);
    setConvs(convsRef.current);
  }, []);

  const persist = useCallback((id: string, override?: Conversation) => {
    const c = override || convsRef.current.find(x => x.id === id);
    if (c) conversationDb.put(c).catch(() => {});
  }, []);

  const patchConv = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    commit(list => list.map(c => (c.id === id ? fn(c) : c)));
  }, [commit]);

  // ---- load from IndexedDB, restore the last open conversation ----
  useEffect(() => {
    let cancelled = false;
    conversationDb.all().then(list => {
      if (cancelled) return;

      // Old conversations (created before background jobs existed) cannot be
      // resumed. New streaming messages with generationId remain streaming and
      // are re-attached below.
      for (const c of list) {
        for (const m of c.messages) {
          if (m.role === 'assistant' && m.status === 'streaming' && !m.generationId) {
            m.status = 'stopped';
          }
        }
      }

      convsRef.current = list;
      setConvs(list);
      let saved: string | null = null;
      try { saved = localStorage.getItem(ACTIVE_KEY); } catch { /* ignore */ }
      if (saved && list.some(c => c.id === saved)) setActiveId(saved);
    }).catch(() => {}).finally(() => !cancelled && setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(ACTIVE_KEY, activeId || ''); } catch { /* ignore */ }
  }, [activeId, loaded]);

  // On actual page/tab destruction, detach the browser request only. A
  // router-owned background job intentionally keeps running.
  useEffect(() => () => run.current?.ctrl.abort(), []);

  const finalize = useCallback((
    cid: string,
    aid: string,
    content: string,
    status: MessageStatus,
    error: ChatError | null = null,
    metrics?: GenerationMetrics,
  ) => {
    patchConv(cid, c => ({
      ...c,
      messages: c.messages.map(m => (
        m.id === aid
          ? { ...m, content, status, error, metrics: metrics || (m as AssistantMessage).metrics } as AssistantMessage
          : m
      )),
    }));
    persist(cid);
  }, [patchConv, persist]);

  /** Agent steps are rare events: store them on the message right away. */
  const setSteps = useCallback((cid: string, mid: string, steps: AgentStep[]) => {
    patchConv(cid, c => ({
      ...c,
      messages: c.messages.map(m => (m.id === mid ? { ...m, steps } as AssistantMessage : m)),
    }));
    persist(cid);
  }, [patchConv, persist]);

  // ---- generation ----
  const generate = useCallback(async (cid: string, overrides?: Partial<Settings>) => {
    const conv = convsRef.current.find(c => c.id === cid);
    if (!conv || run.current) return;

    const s = { ...settingsRef.current, ...overrides };
    const model = currentModel(s);
    const generationStartedAt = Date.now();
    let firstTokenAt: number | undefined;
    let metrics: GenerationMetrics | undefined;
    const lastUser = [...conv.messages].reverse().find((m): m is UserMessage => m.role === 'user');

    const aid = uid();
    const ctrl = new AbortController();
    const current: ActiveRun = {
      ctrl,
      reason: null,
      cid,
      mid: aid,
      jobId: s.provider === 'demo' ? undefined : aid,
      background: false,
    };
    run.current = current;

    // Persist immediately. Even if the browser is closed a fraction of a
    // second later, the next launch knows which router job to recover.
    const placeholder: AssistantMessage = {
      id: aid,
      role: 'assistant',
      content: '',
      status: 'streaming',
      author: model.label,
      generationId: current.jobId,
      metrics: {
        provider: model.provider || 'custom',
        providerLabel: model.providerLabel,
        modelId: model.id,
        resolvedModel: model.id.replace(/^[a-z]+::/i, ''),
        startedAt: generationStartedAt,
      },
      createdAt: generationStartedAt,
    };
    patchConv(cid, c => ({
      ...c,
      updatedAt: Date.now(),
      model: model.id,
      modelLabel: model.label,
      messages: [...c.messages, placeholder],
    }));
    persist(cid);
    setLive({ cid, mid: aid, content: '' });

    let full = '';
    let pending = '';
    let raf = 0;
    let timer = 0;
    let lastCheckpoint = Date.now();

    const withContent = (content: string, status: MessageStatus, error: ChatError | null = null) =>
      (c: Conversation): Conversation => ({
        ...c,
        messages: c.messages.map(m => (
          m.id === aid
            ? { ...m, content, status, error } as AssistantMessage
            : m
        )),
      });

    const flush = () => {
      raf = 0;
      if (!pending) return;
      full += pending;
      pending = '';
      setLive({ cid, mid: aid, content: full });

      if (Date.now() - lastCheckpoint > CHECKPOINT_MS) {
        lastCheckpoint = Date.now();
        const c = convsRef.current.find(x => x.id === cid);
        if (c) persist(cid, withContent(full, 'streaming')(c));
      }
    };

    const onMeta = (meta: LueurMeta) => {
      if (Array.isArray(meta.steps)) setSteps(cid, aid, meta.steps);
      if (typeof meta.replace === 'string') {
        full = meta.replace;
        pending = '';
        setLive({ cid, mid: aid, content: full });
      }
    };

    const arm = () => {
      if (current.background) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        current.reason = 'timeout';
        ctrl.abort();
      }, INACTIVITY_TIMEOUT_MS);
    };

    let status: MessageStatus = 'done';
    let error: ChatError | null = null;
    let detached = false;
    arm();

    try {
      let stream: AsyncGenerator<string, void, void>;

      if (s.provider === 'demo') {
        // Demo mode is browser-owned and cannot survive a closed page.
        stream = demoStream(lastUser?.content || '', ctrl.signal);
      } else {
        const cfg = { baseUrl: s.baseUrl, apiKey: s.apiKey };
        const caps = await llmApi.getRouterCapabilities(cfg);
        const background = caps.background;
        current.background = background;

        if (background && current.jobId) {
          clearTimeout(timer);
          const params: ChatCompletionParams = {
            model: model.id,
            // With the agent router, send everything: it summarizes, retrieves
            // memories/documents and fits the model's real context itself.
            messages: caps.agent
              ? buildHistory(conv.messages, s, { full: true, splitFiles: true })
              : buildHistory(conv.messages, s),
            temperature: s.temperature,
            top_p: s.topP,
            max_tokens: s.maxTokens,
          };
          if (caps.agent) {
            params._lueur_context = true;
            params._lueur_conversation_id = cid;
            params._lueur_agent = s.agentEnabled;
            params._lueur_memory = s.memoryEnabled && (model.provider === 'local' || s.memoryCloud);
          }
          stream = llmApi.streamBackgroundChat(cfg, params, current.jobId, ctrl.signal, onMeta);
        } else {
          const history = buildHistory(conv.messages, s);
          // External OpenAI-compatible servers keep the old browser-owned
          // behavior. Remove generationId so a later reload will not try to
          // resume a job that does not exist.
          current.jobId = undefined;
          patchConv(cid, c => ({
            ...c,
            messages: c.messages.map(m => (
              m.id === aid ? { ...m, generationId: undefined } as AssistantMessage : m
            )),
          }));
          persist(cid);

          stream = llmApi.streamChat(
            cfg,
            {
              model: model.id,
              messages: history,
              temperature: s.temperature,
              top_p: s.topP,
              max_tokens: s.maxTokens,
            },
            ctrl.signal,
          );
        }
      }

      for await (const token of stream) {
        arm();
        if (!token) continue;
        if (!firstTokenAt) firstTokenAt = Date.now();
        pending += token;
        if (!raf) raf = requestAnimationFrame(flush);
      }
    } catch (e) {
      if (current.reason === 'user') {
        status = 'stopped';
      } else if (ctrl.signal.aborted && current.background) {
        // Page destruction detaches the browser but must not overwrite the
        // persisted "streaming" state; the job will be recovered next launch.
        detached = true;
      } else {
        status = 'error';
        error = await diagnoseError(e, s.baseUrl, current.reason);
      }
    } finally {
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    }

    if (detached) {
      if (run.current === current) run.current = null;
      setLive(null);
      return;
    }

    full += pending;

    if (current.background && current.jobId) {
      try {
        const snapshot = await llmApi.getBackgroundGeneration(
          { baseUrl: s.baseUrl, apiKey: s.apiKey },
          current.jobId,
        );
        metrics = generationMetrics(snapshot) || metrics;
      } catch {
        // Metrics are best-effort and must never turn a valid answer into an error.
      }
    }
    metrics ||= fallbackMetrics(model, generationStartedAt, firstTokenAt, Date.now(), full);

    if (convsRef.current.some(c => c.id === cid)) {
      finalize(cid, aid, full, status, error, metrics);
    }

    if (run.current === current) run.current = null;
    setLive(null);
    if (status === 'error' && !error?.http) onConnErrRef.current?.();
  }, [finalize, patchConv, persist, setSteps]);

  /**
   * Recover a router-owned job after page refresh/browser restart.
   * First fetch a snapshot (instant catch-up), then attach to SSE if still
   * running.
   */
  const resumeGeneration = useCallback(async (
    cid: string,
    message: AssistantMessage,
  ) => {
    if (!message.generationId || run.current) return;

    const s = settingsRef.current;
    if (s.provider === 'demo') {
      finalize(cid, message.id, message.content, 'stopped');
      return;
    }

    const cfg = { baseUrl: s.baseUrl, apiKey: s.apiKey };
    const ctrl = new AbortController();
    const current: ActiveRun = {
      ctrl,
      reason: null,
      cid,
      mid: message.id,
      jobId: message.generationId,
      background: true,
    };
    run.current = current;

    let full = message.content || '';
    let metrics = message.metrics;
    let pending = '';
    let raf = 0;
    let lastCheckpoint = Date.now();

    const onMeta = (meta: LueurMeta) => {
      if (Array.isArray(meta.steps)) setSteps(cid, message.id, meta.steps);
      if (typeof meta.replace === 'string') {
        full = meta.replace;
        pending = '';
        setLive({ cid, mid: message.id, content: full });
      }
    };

    const flush = () => {
      raf = 0;
      if (!pending) return;
      full += pending;
      pending = '';
      setLive({ cid, mid: message.id, content: full });

      if (Date.now() - lastCheckpoint > CHECKPOINT_MS) {
        lastCheckpoint = Date.now();
        const c = convsRef.current.find(x => x.id === cid);
        if (c) {
          const updated: Conversation = {
            ...c,
            messages: c.messages.map(m => (
              m.id === message.id
                ? { ...m, content: full, status: 'streaming', error: null, metrics } as AssistantMessage
                : m
            )),
          };
          persist(cid, updated);
        }
      }
    };

    try {
      const snapshot = await llmApi.getBackgroundGeneration(cfg, message.generationId);
      full = snapshot.content || full;
      metrics = generationMetrics(snapshot) || metrics;

      patchConv(cid, c => ({
        ...c,
        messages: c.messages.map(m => (
          m.id === message.id
            ? { ...m, content: full, error: null, metrics, steps: snapshot.steps?.length ? snapshot.steps : (m as AssistantMessage).steps } as AssistantMessage
            : m
        )),
      }));
      persist(cid);

      if (snapshot.status === 'done') {
        finalize(cid, message.id, full, 'done', null, metrics);
        return;
      }
      if (snapshot.status === 'stopped') {
        finalize(cid, message.id, full, 'stopped', null, metrics);
        return;
      }
      if (snapshot.status === 'error') {
        const sourceError = snapshot.error_code
          ? new LLMApiError(snapshot.error_code, snapshot.error || 'Background generation failed')
          : new Error(snapshot.error || 'Background generation failed');
        const diagnosed = await diagnoseError(sourceError, s.baseUrl, null);
        finalize(cid, message.id, full, 'error', diagnosed, metrics);
        return;
      }

      setLive({ cid, mid: message.id, content: full });

      const stream = llmApi.resumeBackgroundChat(
        cfg,
        message.generationId,
        snapshot.cursor,
        ctrl.signal,
        onMeta,
      );

      for await (const token of stream) {
        if (!token) continue;
        pending += token;
        if (!raf) raf = requestAnimationFrame(flush);
      }

      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      full += pending;
      pending = '';
      try {
        const doneSnapshot = await llmApi.getBackgroundGeneration(cfg, message.generationId);
        metrics = generationMetrics(doneSnapshot) || metrics;
      } catch {
        // Keep the latest metrics snapshot already persisted.
      }
      finalize(cid, message.id, full, 'done', null, metrics);
    } catch (e) {
      if (current.reason === 'user') {
        finalize(cid, message.id, full, 'stopped', null, metrics);
      } else if (ctrl.signal.aborted) {
        // Browser/page is going away again. Keep the persisted status streaming
        // so the next launch can reconnect to the same router job.
        return;
      } else if (e instanceof LLMApiError && e.status === 404) {
        // Router restarted or the one-hour completed-job cache expired.
        finalize(cid, message.id, full, 'stopped', null, metrics);
      } else {
        const diagnosed = await diagnoseError(e, s.baseUrl, current.reason);
        finalize(cid, message.id, full, 'error', diagnosed, metrics);
        if (!diagnosed?.http) onConnErrRef.current?.();
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      if (run.current === current) run.current = null;
      setLive(null);
    }
  }, [finalize, patchConv, persist, setSteps]);

  // After IndexedDB is loaded, recover any in-flight router job. Including
  // convs in dependencies lets us move on if more than one stale streaming
  // message ever exists, while run.current prevents duplicate attachments.
  useEffect(() => {
    if (!loaded || run.current) return;

    for (const c of convsRef.current) {
      const pending = c.messages.find(
        (m): m is AssistantMessage =>
          m.role === 'assistant' &&
          m.status === 'streaming' &&
          Boolean(m.generationId),
      );
      if (pending) {
        void resumeGeneration(c.id, pending);
        break;
      }
    }
  }, [loaded, convs, resumeGeneration]);

  const stop = useCallback(() => {
    const current = run.current;
    if (!current) return;

    current.reason = 'user';

    if (current.background && current.jobId) {
      const s = settingsRef.current;
      void llmApi.cancelBackgroundGeneration(
        { baseUrl: s.baseUrl, apiKey: s.apiKey },
        current.jobId,
      ).catch(() => {});
    }

    current.ctrl.abort();
  }, []);

  const send = useCallback((text: string, files: AttachedFile[] = []) => {
    const content = text.trim();
    if ((!content && !files.length) || run.current) return false;

    const model = currentModel(settingsRef.current);
    const now = Date.now();
    const userMsg: UserMessage = {
      id: uid(),
      role: 'user',
      content,
      files: files.length ? files : undefined,
      createdAt: now,
    };

    const existing = activeId ? convsRef.current.find(c => c.id === activeId) : undefined;
    const cid = existing ? existing.id : uid();

    if (existing) {
      patchConv(cid, c => ({ ...c, messages: [...c.messages, userMsg], updatedAt: now }));
    } else {
      const conv: Conversation = {
        id: cid,
        title: makeTitle(content || files[0].name),
        createdAt: now,
        updatedAt: now,
        model: model.id,
        modelLabel: model.label,
        messages: [userMsg],
      };
      commit(list => [conv, ...list]);
    }

    setActiveId(cid);
    persist(cid);
    void generate(cid);
    return true;
  }, [activeId, commit, generate, patchConv, persist]);

  /** Drops the given assistant message (and anything after) and asks again. */
  const regenerate = useCallback((cid: string, mid: string, overrides?: Partial<Settings>) => {
    if (run.current) return;
    patchConv(cid, c => {
      const i = c.messages.findIndex(m => m.id === mid);
      return { ...c, messages: i >= 0 ? c.messages.slice(0, i) : c.messages };
    });
    void generate(cid, overrides);
  }, [generate, patchConv]);

  const rename = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    patchConv(id, c => ({ ...c, title: t }));
    persist(id);
  }, [patchConv, persist]);

  const remove = useCallback((id: string) => {
    if (run.current?.cid === id) stop();
    commit(list => list.filter(c => c.id !== id));
    setActiveId(a => (a === id ? null : a));
    conversationDb.remove(id).catch(() => {});
  }, [commit, stop]);

  const clearAll = useCallback(() => {
    stop();
    commit(() => []);
    setActiveId(null);
    conversationDb.clear().catch(() => {});
  }, [commit, stop]);

  const active = useMemo(() => convs.find(c => c.id === activeId) || null, [convs, activeId]);
  const generatingCid = live?.cid ?? null;

  return {
    conversations: convs,
    loaded,
    active,
    activeId,
    setActiveId,
    live,
    generating: generatingCid !== null,
    generatingCid,
    send,
    stop,
    regenerate,
    rename,
    remove,
    clearAll,
  };
}

export type ChatApi = ReturnType<typeof useChat>;
