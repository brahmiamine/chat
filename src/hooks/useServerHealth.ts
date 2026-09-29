import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthStatus, ServerInfo, Settings } from '../types';
import { llmApi } from '../services/llmApi';
import { friendlyError, isMixedContent } from '../services/errors';

const POLL_MS = 20_000;

export type TestResult = { state: 'idle' | 'testing' | 'ok' } | { state: 'fail'; message: string };

/**
 * Online/offline indicator driven by GET /health: polled every 20 s, re-checked
 * on network changes and (debounced) when the URL / key / provider change.
 */
export function useServerHealth(settings: Settings) {
  const { provider, baseUrl, apiKey } = settings;
  const [health, setHealth] = useState<HealthStatus>(provider === 'demo' ? 'demo' : 'checking');
  const [server, setServer] = useState<ServerInfo>({ models: [] });
  const fetched = useRef(false);
  const [test, setTest] = useState<TestResult>({ state: 'idle' });

  const cfgRef = useRef({ provider, baseUrl, apiKey });
  cfgRef.current = { provider, baseUrl, apiKey };
  const seq = useRef(0);

  const loadServerInfo = useCallback(async () => {
    try {
      const info = await llmApi.getServerInfo(cfgRef.current);
      fetched.current = true;
      setServer(info);
      return info;
    } catch {
      return null;
    }
  }, []);

  const check = useCallback(async () => {
    const cfg = cfgRef.current;
    const id = ++seq.current;
    if (cfg.provider === 'demo') return setHealth('demo');
    if (!navigator.onLine || isMixedContent(cfg.baseUrl)) return setHealth('offline');
    let next: HealthStatus;
    try { next = await llmApi.checkHealth(cfg); } catch { next = 'offline'; }
    if (id !== seq.current) return; // a newer check superseded this one
    setHealth(next);
    if (next === 'online' && !fetched.current) loadServerInfo();
  }, [loadServerInfo]);

  // Re-check when the connection settings change (debounced while typing).
  useEffect(() => {
    fetched.current = false;
    setServer({ models: [] });
    setTest({ state: 'idle' });
    const t = setTimeout(check, provider === 'demo' ? 0 : 600);
    return () => clearTimeout(t);
  }, [provider, baseUrl, apiKey, check]);

  useEffect(() => {
    const poll = setInterval(check, POLL_MS);
    const onOffline = () => setHealth(h => (h === 'demo' ? h : 'offline'));
    const onVisible = () => document.visibilityState === 'visible' && check();
    window.addEventListener('online', check);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  const testConnection = useCallback(async () => {
    const cfg = cfgRef.current;
    setTest({ state: 'testing' });
    try {
      const r = await llmApi.checkHealth(cfg, 6000);
      if (r === 'online') {
        await loadServerInfo();
        setHealth('online');
        setTest({ state: 'ok' });
      } else if (r === 'loading') {
        setHealth('loading');
        setTest({ state: 'fail', message: 'Le serveur répond, mais le modèle est encore en cours de chargement.' });
      } else {
        setHealth('offline');
        setTest({ state: 'fail', message: 'Le serveur a répondu de façon inattendue. Vérifiez l’URL.' });
      }
    } catch (e) {
      const fe = friendlyError(e, cfg.baseUrl);
      setHealth('offline');
      setTest({ state: 'fail', message: `${fe.title} ${fe.hint}` });
    }
  }, [loadServerInfo]);

  return { health, server, test, check, testConnection, loadServerInfo };
}
