import type { GenerationSettings, ModelEntry, Settings } from '../types';

const env = import.meta.env;

const DEFAULT_MODEL_ID = 'local::qwen2.5-7b-instruct-q4_0';
const PHI4_MINI_MODEL_ID = 'local::phi4-mini-3.8b-q4_0';
const QWEN3_MODEL_ID = 'local::qwen3-8b-q4_0';
const QWEN25_CODER_MODEL_ID = 'local::qwen2.5-coder-7b-q4_0';
const QWEN35_9B_MODEL_ID = 'local::qwen3.5-9b-q4_0';
const DEEPSEEK_R1_7B_MODEL_ID = 'local::deepseek-r1-qwen-7b-q4_0';

const SUPPORTED_LOCAL_MODEL_IDS = new Set([
  PHI4_MINI_MODEL_ID,
  DEFAULT_MODEL_ID,
  QWEN3_MODEL_ID,
  QWEN25_CODER_MODEL_ID,
  QWEN35_9B_MODEL_ID,
  DEEPSEEK_R1_7B_MODEL_ID,
]);

const OLD_LOCAL_MODEL_IDS = new Set([
  'lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M',
  'ggml-org/gemma-3-4b-it-GGUF:Q4_K_M',
  'bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M',
  'bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',
  'bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M',
  'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M',
  'bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M',
]);

const PROVIDER_LABELS = {
  local: 'Local · llama.cpp',
  groq: 'GroqCloud',
  gemini: 'Google Gemini',
  mistral: 'Mistral AI',
  openrouter: 'OpenRouter',
  cloudflare: 'Cloudflare Workers AI',
  huggingface: 'Hugging Face Inference',
  nvidia: 'NVIDIA NIM',
  cohere: 'Cohere',
  vercel: 'Vercel AI Gateway',
} as const;

export const DEFAULT_MODELS: ModelEntry[] = [
  // Snapdragon Hexagon NPU — one local model loaded at a time.
  { id: PHI4_MINI_MODEL_ID, label: 'Phi-4 Mini 3.8B · Snapdragon NPU', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: DEFAULT_MODEL_ID, label: 'Qwen2.5 7B · Snapdragon NPU', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: QWEN3_MODEL_ID, label: 'Qwen3 8B · Snapdragon NPU', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: QWEN25_CODER_MODEL_ID, label: 'Qwen2.5 Coder 7B · Snapdragon NPU', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: QWEN35_9B_MODEL_ID, label: 'Qwen3.5 9B · Snapdragon NPU', provider: 'local', providerLabel: PROVIDER_LABELS.local },
  { id: DEEPSEEK_R1_7B_MODEL_ID, label: 'DeepSeek R1 Qwen 7B · Snapdragon NPU', provider: 'local', providerLabel: PROVIDER_LABELS.local },

  // Cloud providers proxied securely by the Termux router.
  { id: 'groq::openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq', providerLabel: PROVIDER_LABELS.groq },
  { id: 'groq::qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', provider: 'groq', providerLabel: PROVIDER_LABELS.groq },
  { id: 'gemini::gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini', providerLabel: PROVIDER_LABELS.gemini },
  { id: 'mistral::mistral-small-latest', label: 'Mistral Small', provider: 'mistral', providerLabel: PROVIDER_LABELS.mistral },
  { id: 'openrouter::openrouter/free', label: 'OpenRouter Free', provider: 'openrouter', providerLabel: PROVIDER_LABELS.openrouter },
  { id: 'cloudflare::@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'cloudflare', providerLabel: PROVIDER_LABELS.cloudflare },
  { id: 'huggingface::deepseek-ai/DeepSeek-R1:fastest', label: 'DeepSeek R1', provider: 'huggingface', providerLabel: PROVIDER_LABELS.huggingface },

  // NVIDIA hosted free endpoints verified against the current NIM catalog.
  { id: 'nvidia::deepseek-ai/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash Vision', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::z-ai/glm-5.3', label: 'GLM-5.3', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::z-ai/glm-5.3-flash', label: 'GLM-5.3 Flash Vision', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::openai/gpt-oss-20b', label: 'GPT-OSS 20B', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::google/gemma-4-31b-it', label: 'Gemma 4 31B Vision', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },
  { id: 'nvidia::meta/muse-glimmer-30b', label: 'Muse Glimmer 30B Vision', provider: 'nvidia', providerLabel: PROVIDER_LABELS.nvidia },

  { id: 'cohere::command-a-plus-05-2026', label: 'Command A+', provider: 'cohere', providerLabel: PROVIDER_LABELS.cohere },

  { id: 'vercel::inclusionai/ling-3.0-flash-vl', label: 'Ling 3.0 Flash VL Free', provider: 'vercel', providerLabel: PROVIDER_LABELS.vercel },
];

export const GEN_DEFAULTS: GenerationSettings = { temperature: 0.7, topP: 0.8, maxTokens: 1024, contextSize: 4096 };

/**
 * When the app is served by llama-server itself (`llama-server --path dist`)
 * or by the Cloudflare Worker (chat.testcivique.workers.dev), the API lives on
 * the same origin: no CORS, and no URL to configure even when
 * the tunnel address changes. GitHub Pages and the Vite dev/preview servers
 * keep the configured remote default.
 */
export function isServedByLlamaServer(): boolean {
  if (typeof location === 'undefined' || env.DEV) return false;
  return !/\.github\.io$/i.test(location.hostname) && location.port !== '4173';
}

const REMOTE_DEFAULT_URL = env.VITE_LLM_BASE_URL || 'https://chat.testcivique.workers.dev';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai-compatible',
  baseUrl: isServedByLlamaServer() ? location.origin : REMOTE_DEFAULT_URL,
  apiKey: env.VITE_LLM_API_KEY || '',
  models: DEFAULT_MODELS,
  modelId: DEFAULT_MODELS[0].id,
  systemPrompt: '',
  theme: 'system',
  fontSize: 16,
  agentEnabled: true,
  memoryEnabled: true,
  memoryCloud: false,
  ...GEN_DEFAULTS,
};

const KEY = 'lueur.settings';

const MODEL_REPLACEMENTS: Record<string, string> = {
  'local::gemma3-12b-q4_0': QWEN35_9B_MODEL_ID,
  'local::deepseek-r1-qwen-14b-q4_0': DEEPSEEK_R1_7B_MODEL_ID,
  'nvidia::openai/gpt-oss-120b': 'nvidia::openai/gpt-oss-20b',
  'nvidia::deepseek-ai/deepseek-v4-flash': 'nvidia::deepseek-ai/deepseek-v4.1-flash',
  'nvidia::qwen/qwen3-next-80b-a3b-instruct': 'nvidia::z-ai/glm-5.3',
};

const REMOVED_MODELS = new Set([
  'cerebras::gpt-oss-120b',
  ...OLD_LOCAL_MODEL_IDS,
]);

const LEGACY_DEFAULT_MODELS = new Set([
  'mradermacher/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M',
  'Qwen2.5-7B-Instruct-GGUF:Q4_K_M',
  ...OLD_LOCAL_MODEL_IDS,
  ...Object.keys(MODEL_REPLACEMENTS),
]);

function migrateDefaultModel(s: Settings): Settings {
  const selectedWasRemoved =
    REMOVED_MODELS.has(s.modelId)
    || OLD_LOCAL_MODEL_IDS.has(s.modelId)
    || s.modelId.startsWith('cerebras::');
  const modelId = selectedWasRemoved
    ? DEFAULT_MODEL_ID
    : MODEL_REPLACEMENTS[s.modelId]
      || (LEGACY_DEFAULT_MODELS.has(s.modelId) ? DEFAULT_MODEL_ID : s.modelId);
  const models: ModelEntry[] = (s.models || [])
    .filter(m => !LEGACY_DEFAULT_MODELS.has(m.id))
    .filter(m => !OLD_LOCAL_MODEL_IDS.has(m.id))
    .filter(m => String(m.provider || '') !== 'local' || SUPPORTED_LOCAL_MODEL_IDS.has(m.id))
    .filter(m => !REMOVED_MODELS.has(m.id) && !m.id.startsWith('cerebras::') && String(m.provider || '') !== 'cerebras')
    .map((m): ModelEntry => {
      const builtin = DEFAULT_MODELS.find(x => x.id === m.id);
      // Enrich settings saved by older versions with provider metadata while
      // preserving any custom display label chosen by the user.
      return builtin
        ? { ...builtin, ...m, provider: builtin.provider, providerLabel: builtin.providerLabel }
        : { ...m, provider: m.provider || 'custom' };
    });

  // Keep the supported local NPU models + cloud router models available,
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
  'https://expansile-ramiro-intertribal.ngrok-free.dev',
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

/** "local::qwen2.5-7b-instruct-q4_0" → a readable model name. */
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
