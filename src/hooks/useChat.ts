/**
 * Conversation state + generation lifecycle.
 *
 * Performance notes
 * - Streamed tokens are buffered and flushed at most once per animation frame.
 * - The in-flight text lives in a separate `live` state, so the conversation
 *   list (and the sidebar) does not re-render on every token; the final text
 *   is committed once when the stream ends.
 * - Partial answers are checkpointed to IndexedDB every ~1.5 s so a refresh
 *   mid-generation keeps what was already received.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantMessage, AttachedFile, ChatError, Conversation, MessageStatus, Settings, UserMessage } from '../types';
import { llmApi } from '../services/llmApi';
import { demoStream } from '../services/demoProvider';
import { conversationDb } from '../services/db';
import { friendlyError, type AbortReason } from '../services/errors';
import { buildHistory, makeTitle, uid } from '../lib/chat';
import { currentModel } from '../lib/settings';

const INACTIVITY_TIMEOUT_MS = 90_000;
const CHECKPOINT_MS = 1500;
const ACTIVE_KEY = 'lueur.active';

export interface LiveStream {
  cid: string;
  mid: string;
  content: string;
}

interface Options {
  /** Called when a generation fails for a network reason (to refresh the Online/Offline badge). */
  onConnectionError?: () => void;
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
  const run = useRef<{ ctrl: AbortController; reason: AbortReason; cid: string } | null>(null);

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
      for (const c of list) for (const m of c.messages) if (m.role === 'assistant' && m.status === 'streaming') m.status = 'stopped';
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

  useEffect(() => () => run.current?.ctrl.abort(), []);

  // ---- generation ----
  const generate = useCallback(async (cid: string, overrides?: Partial<Settings>) => {
    const conv = convsRef.current.find(c => c.id === cid);
    if (!conv || run.current) return;
    const s = { ...settingsRef.current, ...overrides };
    const model = currentModel(s);
    const history = buildHistory(conv.messages, s);
    const lastUser = [...conv.messages].reverse().find((m): m is UserMessage => m.role === 'user');

    const aid = uid();
    const ctrl = new AbortController();
    const current = { ctrl, reason: null as AbortReason, cid };
    run.current = current;

    const placeholder: AssistantMessage = { id: aid, role: 'assistant', content: '', status: 'streaming', author: model.label, createdAt: Date.now() };
    patchConv(cid, c => ({ ...c, updatedAt: Date.now(), model: model.id, modelLabel: model.label, messages: [...c.messages, placeholder] }));
    setLive({ cid, mid: aid, content: '' });

    let full = '';
    let pending = '';
    let raf = 0;
    let timer = 0;
    let lastCheckpoint = Date.now();

    const withContent = (content: string, status: MessageStatus, error: ChatError | null = null) => (c: Conversation): Conversation => ({
      ...c,
      messages: c.messages.map(m => (m.id === aid ? { ...m, content, status, error } as AssistantMessage : m)),
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
    const arm = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => { current.reason = 'timeout'; ctrl.abort(); }, INACTIVITY_TIMEOUT_MS);
    };

    let status: MessageStatus = 'done';
    let error: ChatError | null = null;
    arm();
    try {
      const stream = s.provider === 'demo'
        ? demoStream(lastUser?.content || '', ctrl.signal)
        : llmApi.streamChat(
            { baseUrl: s.baseUrl, apiKey: s.apiKey },
            { model: model.id, messages: history, temperature: s.temperature, top_p: s.topP, max_tokens: s.maxTokens },
            ctrl.signal,
          );
      for await (const token of stream) {
        arm();
        if (!token) continue;
        pending += token;
        if (!raf) raf = requestAnimationFrame(flush);
      }
    } catch (e) {
      if (current.reason === 'user') status = 'stopped';
      else {
        status = 'error';
        error = friendlyError(e, s.baseUrl, current.reason);
      }
    }
    clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    full += pending;

    if (convsRef.current.some(c => c.id === cid)) {
      patchConv(cid, withContent(full, status, error));
      persist(cid);
    }
    run.current = null;
    setLive(null);
    if (status === 'error' && !error?.http) onConnErrRef.current?.();
  }, [patchConv, persist]);

  const stop = useCallback(() => {
    if (!run.current) return;
    run.current.reason = 'user';
    run.current.ctrl.abort();
  }, []);

  const send = useCallback((text: string, files: AttachedFile[] = []) => {
    const content = text.trim();
    if ((!content && !files.length) || run.current) return false;
    const model = currentModel(settingsRef.current);
    const now = Date.now();
    const userMsg: UserMessage = { id: uid(), role: 'user', content, files: files.length ? files : undefined, createdAt: now };
    const existing = activeId ? convsRef.current.find(c => c.id === activeId) : undefined;
    const cid = existing ? existing.id : uid();
    if (existing) {
      patchConv(cid, c => ({ ...c, messages: [...c.messages, userMsg], updatedAt: now }));
    } else {
      const conv: Conversation = {
        id: cid, title: makeTitle(content || files[0].name), createdAt: now, updatedAt: now,
        model: model.id, modelLabel: model.label, messages: [userMsg],
      };
      commit(list => [conv, ...list]);
    }
    setActiveId(cid);
    persist(cid);
    generate(cid);
    return true;
  }, [activeId, commit, generate, patchConv, persist]);

  /** Drops the given assistant message (and anything after) and asks again. */
  const regenerate = useCallback((cid: string, mid: string, overrides?: Partial<Settings>) => {
    if (run.current) return;
    patchConv(cid, c => {
      const i = c.messages.findIndex(m => m.id === mid);
      return { ...c, messages: i >= 0 ? c.messages.slice(0, i) : c.messages };
    });
    generate(cid, overrides);
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
