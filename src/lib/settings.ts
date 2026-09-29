import type { GenerationSettings, ModelEntry, Settings } from '../types';

const env = import.meta.env;

export const DEFAULT_MODELS: ModelEntry[] = [
  { id: env.VITE_LLM_MODEL || 'mradermacher/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M', label: 'Qwen3 4B' },
  { id: 'Qwen2.5-7B-Instruct-GGUF:Q4_K_M', label: 'Qwen 7B' },
];

export const GEN_DEFAULTS: GenerationSettings = { temperature: 0.7, topP: 0.8, maxTokens: 2048, contextSize: 8192 };

/**
 * When the app is served by llama-server itself (`llama-server --path dist`),
 * the API lives on the same origin: no CORS, and no URL to configure even when
 * the tunnel address changes. GitHub Pages and the Vite dev/preview servers
 * keep the configured remote default.
 */
export function isServedByLlamaServer(): boolean {
  if (typeof location === 'undefined' || env.DEV) return false;
  return !/\.github\.io$/i.test(location.hostname) && location.port !== '4173';
}

const REMOTE_DEFAULT_URL = env.VITE_LLM_BASE_URL || 'https://below-cancer-loads-dat.trycloudflare.com';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai-compatible',
  baseUrl: isServedByLlamaServer() ? location.origin : REMOTE_DEFAULT_URL,
  apiKey: env.VITE_LLM_API_KEY || '',
  models: DEFAULT_MODELS,
  modelId: DEFAULT_MODELS[0].id,
  systemPrompt: '',
  theme: 'system',
  fontSize: 16,
  ...GEN_DEFAULTS,
};

const KEY = 'lueur.settings';

/** Former built-in defaults: a saved value equal to one of these follows the current default. */
const PREVIOUS_DEFAULT_URLS = ['http://192.168.1.98:8080', 'https://searched-track-dsc-perhaps.trycloudflare.com'];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      if (s.provider !== 'demo') s.provider = 'openai-compatible'; // also migrates the prototype's "llamacpp"
      if (!Array.isArray(s.models) || !s.models.length) s.models = DEFAULT_MODELS;
      if (PREVIOUS_DEFAULT_URLS.includes(String(s.baseUrl).trim().replace(/\/+$/, ''))) s.baseUrl = DEFAULT_SETTINGS.baseUrl;
      return s;
    }
  } catch { /* corrupted or unavailable storage */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

/** "mradermacher/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M" → "Qwen3 4B". */
export function prettyModel(id: string): string {
  const s = String(id || '').split('/').pop()!.replace(/\.gguf$/i, '').replace(/[:@].*$/, '').replace(/-GGUF.*$/i, '');
  const m = s.match(/^([A-Za-z]+[\d.]*)[-_ ]?(\d+(?:\.\d+)?[BbMm])\b/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2].toUpperCase();
  return s.replace(/[-_]+/g, ' ').trim() || 'Modèle local';
}

export function modelLabel(m: ModelEntry): string {
  return (m.label || '').trim() || prettyModel(m.id);
}

export function currentModel(s: Settings): ModelEntry {
  const m = s.models.find(x => x.id === s.modelId) || s.models[0] || { id: s.modelId, label: '' };
  return { id: m.id, label: modelLabel(m) };
}
