import type { GenerationSettings, ModelEntry, Settings } from '../types';

const env = import.meta.env;

const DEFAULT_MODEL_ID = env.VITE_LLM_MODEL || 'lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M';
const GEMMA_MODEL_ID = 'ggml-org/gemma-3-4b-it-GGUF:Q4_K_M';
const PHI_MODEL_ID = 'bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M';
const LLAMA_MODEL_ID = 'bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M';
const SMOL_MODEL_ID = 'bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M';
const DEEPSEEK_MODEL_ID = 'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M';
const CODER_MODEL_ID = 'bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M';

const PROVIDER_LABELS = {
  local: 'Local · llama.cpp',
  groq: 'GroqCloud',
  gemini: 'Google Gemini',
  mistral: 'Mistral AI',
  openrouter: 'OpenRouter',
  cloudflare: 'Cloudflare Workers AI',
  cerebras: 'Cerebras',
  huggingface: 'Hugging Face Inference',
  nvidia: 'NVIDIA NIM',
  cohere: 'Cohere',
  vercel: 'Vercel AI Gateway',
} as const;

export const DEFAULT_MODELS: ModelEntry[] = [
  // Local GGUF
  { id: DEFAULT_MODEL_ID, label: 'Qwen3.5 4B Vision', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: GEMMA_MODEL_ID, label: 'Gemma 3 4B Vision', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: PHI_MODEL_ID, label: 'Phi-4 Mini 3.8B', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: LLAMA_MODEL_ID, label: 'Llama 3.2 3B', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: SMOL_MODEL_ID, label: 'SmolLM3 3B', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: DEEPSEEK_MODEL_ID, label: 'DeepSeek R1 1.5B', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: CODER_MODEL_ID, label: 'Qwen2.5 Coder 3B', provider: 'local', providerLabel: PROVIDER_LABELS.local },

  // Cloud providers proxied securely by the Termux router.
  { id: 'groq::openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq', providerLabel: PROVIDER_LABELS.groq },
  { id: 'groq::qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', provider: 'groq', providerLabel: PROVIDER_LABELS.groq },
  { id: 'gemini::gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini', providerLabel: PROVIDER_LABELS.gemini },
  { id: 'mistral::mistral-small-latest', label: 'Mistral Small', provider: 'mistral', providerLabel: PROVIDER_LABELS.mistral },
  { id: 'openrouter::openrouter/free', label: 'OpenRouter Free', provider: 'openrouter', providerLabel: PROVIDER_LABELS.openrouter },
  { id: 'cloudflare::@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'cloudflare', providerLabel: PROVIDER_LABELS.cloudflare },
  { id: 'cerebras::gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'cerebras', providerLabel: PROVIDER_LABELS.cerebras },
  { id: 'huggingface::deepseek-ai/DeepSeek-R1:fastest', label: 'DeepSeek R1', provider: 'huggingface', providerLabel: PROVIDER_LABELS.huggingface },

  { id: 'nvidia::openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::deepseek-ai/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::qwen/qwen3-next-80b-a3b-instruct', label: 'Qwen3 Next 80B A3B', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },

  { id: 'cohere::command-a-plus-05-2026', label: 'Command A+', provider: 'cohere', providerLabel: PROVIDER_LABELS.cohere },

  { id: 'vercel::inclusionai/ling-3.0-flash-vl', label: 'Ling 3.0 Flash VL Free', provider: 'vercel', providerLabel: PROVIDER_LABELS.vercel },
];

export const GEN_DEFAULTS: GenerationSettings = { temperature: 0.7, topP: 0.8, maxTokens: 1024, contextSize: 4096 };

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

const REMOTE_DEFAULT_URL = env.VITE_LLM_BASE_URL || 'https://expansile-ramiro-intertribal.ngrok-free.dev';

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

const LEGACY_DEFAULT_MODELS = new Set([
  'mradermacher/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M',
  'Qwen2.5-7B-Instruct-GGUF:Q4_K_M',
]);

function migrateDefaultModel(s: Settings): Settings {
  const modelId = LEGACY_DEFAULT_MODELS.has(s.modelId) ? DEFAULT_MODEL_ID : s.modelId;
  const models: ModelEntry[] = (s.models || [])
    .filter(m => !LEGACY_DEFAULT_MODELS.has(m.id))
    .map((m): ModelEntry => {
      const builtin = DEFAULT_MODELS.find(x => x.id === m.id);
      // Enrich settings saved by older versions with provider metadata while
      // preserving any custom display label chosen by the user.
      return builtin
        ? { ...builtin, ...m, provider: builtin.provider, providerLabel: builtin.providerLabel }
        : { ...m, provider: m.provider || 'custom' };
    });

  // Keep all built-in local + cloud router models available in the selector,
  // including for users who already have settings saved locally.
  for (const builtin of [...DEFAULT_MODELS].reverse()) {
    if (!models.some(m => m.id === builtin.id)) models.unshift(builtin);
  }

  const contextSize = s.contextSize === 8192 ? 4096 : s.contextSize;
  const maxTokens = s.maxTokens === 2048 ? 1024 : s.maxTokens;
  return { ...s, models, modelId: modelId || DEFAULT_MODEL_ID, contextSize, maxTokens };
}

/** Former built-in defaults: a saved value equal to one of these follows the current default. */
const PREVIOUS_DEFAULT_URLS = [
  'http://192.168.1.98:8080',
  'https://searched-track-dsc-perhaps.trycloudflare.com',
  'https://below-cancer-loads-dat.trycloudflare.com',
];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      if (s.provider !== 'demo') s.provider = 'openai-compatible'; // also migrates the prototype's "llamacpp"
      if (!Array.isArray(s.models) || !s.models.length) s.models = DEFAULT_MODELS;
      if (PREVIOUS_DEFAULT_URLS.includes(String(s.baseUrl).trim().replace(/\/+$/, ''))) s.baseUrl = DEFAULT_SETTINGS.baseUrl;
      return migrateDefaultModel(s);
    }
  } catch { /* corrupted or unavailable storage */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

/** "lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M" → "Qwen3.5 4B". */
export function prettyModel(id: string): string {
  const raw = String(id || '').replace(/^[a-z]+::/i, '');
  const s = raw.split('/').pop()!.replace(/\.gguf$/i, '').replace(/[:@].*$/, '').replace(/-GGUF.*$/i, '');
  const m = s.match(/^([A-Za-z]+[\d.]*)[-_ ]?(\d+(?:\.\d+)?[BbMm])\b/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2].toUpperCase();
  return s.replace(/[-_]+/g, ' ').trim() || 'Modèle local';
}

export function modelLabel(m: ModelEntry): string {
  return (m.label || '').trim() || prettyModel(m.id);
}

export function currentModel(s: Settings): ModelEntry {
  const m = s.models.find(x => x.id === s.modelId) || s.models[0] || { id: s.modelId, label: '' };
  return { ...m, label: modelLabel(m) };
}
