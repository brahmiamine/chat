const DEFAULT_ALLOWED_ORIGINS = [
  'https://brahmiamine.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const PROVIDERS = {
  local: {
    label: 'Local · llama.cpp',
    required: ['LUEUR_LOCAL_URL'],
  },
  groq: {
    label: 'GroqCloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    key: 'GROQ_API_KEY',
    required: ['GROQ_API_KEY'],
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: 'GEMINI_API_KEY',
    required: ['GEMINI_API_KEY'],
  },
  mistral: {
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    key: 'MISTRAL_API_KEY',
    required: ['MISTRAL_API_KEY'],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: 'OPENROUTER_API_KEY',
    required: ['OPENROUTER_API_KEY'],
  },
  cloudflare: {
    label: 'Cloudflare Workers AI',
    key: 'CLOUDFLARE_AI_API_TOKEN',
    required: ['CLOUDFLARE_AI_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
  },
  huggingface: {
    label: 'Hugging Face Inference',
    baseUrl: 'https://router.huggingface.co/v1',
    key: 'HF_TOKEN',
    required: ['HF_TOKEN'],
  },
  nvidia: {
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    key: 'NVIDIA_API_KEY',
    required: ['NVIDIA_API_KEY'],
  },
  cohere: {
    label: 'Cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    key: 'COHERE_API_KEY',
    required: ['COHERE_API_KEY'],
  },
  vercel: {
    label: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    key: 'AI_GATEWAY_API_KEY',
    required: ['AI_GATEWAY_API_KEY'],
  },
};

const MODELS = {
  'local::qwen2.5-7b-instruct-q4_0': {
    label: 'Qwen2.5 7B · Snapdragon NPU',
    provider: 'local',
    vision: false,
  },

  'groq::openai/gpt-oss-120b': {
    label: 'GPT-OSS 120B',
    provider: 'groq',
    remoteId: 'openai/gpt-oss-120b',
    vision: false,
  },
  'groq::qwen/qwen3.8-27b': {
    label: 'Qwen 3.8 27B',
    provider: 'groq',
    remoteId: 'qwen/qwen3.8-27b',
    vision: true,
  },
  'gemini::gemini-3.8-flash': {
    label: 'Gemini 3.8 Flash',
    provider: 'gemini',
    remoteId: 'gemini-3.8-flash',
    vision: true,
  },
  'mistral::mistral-small-latest': {
    label: 'Mistral Small',
    provider: 'mistral',
    remoteId: 'mistral-small-latest',
    vision: false,
  },
  'openrouter::openrouter/free': {
    label: 'OpenRouter Free',
    provider: 'openrouter',
    remoteId: 'openrouter/free',
    vision: true,
  },
  'cloudflare::@cf/openai/gpt-oss-120b': {
    label: 'GPT-OSS 120B',
    provider: 'cloudflare',
    remoteId: '@cf/openai/gpt-oss-120b',
    vision: false,
  },
  'huggingface::deepseek-ai/DeepSeek-R1:fastest': {
    label: 'DeepSeek R1',
    provider: 'huggingface',
    remoteId: 'deepseek-ai/DeepSeek-R1:fastest',
    vision: false,
  },

  'nvidia::deepseek-ai/deepseek-v4.1-flash': {
    label: 'DeepSeek V4.1 Flash Vision',
    provider: 'nvidia',
    remoteId: 'deepseek-ai/deepseek-v4.1-flash',
    vision: true,
  },
  'nvidia::z-ai/glm-5.3': {
    label: 'GLM-5.3',
    provider: 'nvidia',
    remoteId: 'z-ai/glm-5.3',
    vision: false,
  },
  'nvidia::z-ai/glm-5.3-flash': {
    label: 'GLM-5.3 Flash Vision',
    provider: 'nvidia',
    remoteId: 'z-ai/glm-5.3-flash',
    vision: true,
  },
  'nvidia::nvidia/nemotron-3.5-lightning-30b-a3b': {
    label: 'Nemotron 3.5 Lightning 30B',
    provider: 'nvidia',
    remoteId: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    vision: false,
  },
  'nvidia::nvidia/nemotron-3-super-120b-a12b': {
    label: 'Nemotron 3 Super 120B',
    provider: 'nvidia',
    remoteId: 'nvidia/nemotron-3-super-120b-a12b',
    vision: false,
  },
  'nvidia::openai/gpt-oss-20b': {
    label: 'GPT-OSS 20B',
    provider: 'nvidia',
    remoteId: 'openai/gpt-oss-20b',
    vision: false,
  },
  'nvidia::google/gemma-4-31b-it': {
    label: 'Gemma 4 31B Vision',
    provider: 'nvidia',
    remoteId: 'google/gemma-4-31b-it',
    vision: true,
  },
  'nvidia::meta/muse-glimmer-30b': {
    label: 'Muse Glimmer 30B Vision',
    provider: 'nvidia',
    remoteId: 'meta/muse-glimmer-30b',
    vision: true,
  },

  'cohere::command-a-plus-05-2026': {
    label: 'Command A+',
    provider: 'cohere',
    remoteId: 'command-a-plus-05-2026',
    vision: false,
  },
  'vercel::inclusionai/ling-3.0-flash-vl': {
    label: 'Ling 3.0 Flash VL Free',
    provider: 'vercel',
    remoteId: 'inclusionai/ling-3.0-flash-vl',
    vision: true,
  },
};

const MODEL_ALIASES = {
  'nvidia::openai/gpt-oss-120b': 'nvidia::openai/gpt-oss-20b',
  'nvidia::deepseek-ai/deepseek-v4-flash': 'nvidia::deepseek-ai/deepseek-v4.1-flash',
  'nvidia::qwen/qwen3-next-80b-a3b-instruct': 'nvidia::z-ai/glm-5.3',
};

function clean(value) {
  return String(value || '').trim();
}

function allowedOrigins(env) {
  const configured = clean(env.LUEUR_ALLOWED_ORIGIN)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function requestOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return '';
  // The Worker also serves the Lueur app itself, so its own origin is trusted.
  if (origin === new URL(request.url).origin) return origin;
  return allowedOrigins(env).has(origin) ? origin : null;
}

function corsHeaders(origin) {
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Lueur-Provider, X-Request-Id',
    'Access-Control-Max-Age': '86400',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function providerStatuses(env) {
  const result = {};
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const missing = provider.required.filter(name => !clean(env[name]));
    result[id] = {
      id,
      label: provider.label,
      configured: missing.length === 0,
      missing,
    };
  }
  return result;
}

function providerBaseUrl(providerId, env) {
  if (providerId === 'cloudflare') {
    const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID);
    if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID manquant');
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  }
  return PROVIDERS[providerId]?.baseUrl || '';
}

function providerHeaders(providerId, env) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Fournisseur inconnu: ${providerId}`);

  const missing = provider.required.filter(name => !clean(env[name]));
  if (missing.length) {
    throw new Error(`${provider.label} non configuré: ${missing.join(', ')}`);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };

  if (providerId !== 'local') {
    headers.Authorization = `Bearer ${clean(env[provider.key])}`;
  }

  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'https://brahmiamine.github.io/chat/';
    headers['X-Title'] = 'Lueur';
  }

  return headers;
}

function normalizeCohereMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(message => (
    message && typeof message === 'object' && message.role === 'system'
      ? { ...message, role: 'developer' }
      : message
  ));
}

function upstreamError(raw, status) {
  const text = clean(raw);
  if (!text) return `HTTP ${status}`;
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') {
      if (data.error && typeof data.error === 'object' && data.error.message) return String(data.error.message);
      if (typeof data.error === 'string') return data.error;
      if (data.message) return String(data.message);
      if (data.detail) return String(data.detail);
      if (data.title) return String(data.title);
    }
  } catch {
    // Plain-text provider error.
  }
  return text.slice(0, 4000);
}

async function proxyChat(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'JSON invalide' } }, 400, origin);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: { message: 'Corps de requête invalide' } }, 400, origin);
  }

  let modelId = clean(body.model);
  modelId = MODEL_ALIASES[modelId] || modelId;
  const model = MODELS[modelId];
  if (!model) {
    return json({ error: { message: `Modèle inconnu: ${modelId}` } }, 400, origin);
  }

  const providerId = model.provider;
  const upstream = { ...body };
  delete upstream._lueur_job_id;
  delete upstream._lueur_cursor;

  let url;
  let headers;

  try {
    if (providerId === 'local') {
      const localUrl = clean(env.LUEUR_LOCAL_URL).replace(/\/+$/, '');
      if (!localUrl) throw new Error('LUEUR_LOCAL_URL non configuré');
      url = `${localUrl}/v1/chat/completions`;
      upstream.model = modelId;
      headers = providerHeaders('local', env);
    } else {
      const baseUrl = providerBaseUrl(providerId, env).replace(/\/+$/, '');
      url = `${baseUrl}/chat/completions`;
      upstream.model = model.remoteId || modelId;
      if (providerId === 'cohere') upstream.messages = normalizeCohereMessages(upstream.messages);
      headers = providerHeaders(providerId, env);
    }
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : String(error) } }, 503, origin);
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstream),
      redirect: 'follow',
    });
  } catch (error) {
    return json({
      error: {
        message: `Impossible de joindre ${PROVIDERS[providerId].label}: ${error instanceof Error ? error.message : String(error)}`,
      },
    }, 502, origin);
  }

  if (!response.ok) {
    const raw = await response.text();
    return json({
      error: {
        message: upstreamError(raw, response.status),
        code: response.status,
        provider: providerId,
      },
    }, response.status, origin);
  }

  const outHeaders = new Headers(corsHeaders(origin));
  outHeaders.set('Content-Type', response.headers.get('Content-Type') || (upstream.stream ? 'text/event-stream' : 'application/json'));
  outHeaders.set('Cache-Control', 'no-store');
  outHeaders.set('X-Lueur-Provider', providerId);

  const requestId = response.headers.get('x-request-id') || response.headers.get('cf-ray');
  if (requestId) outHeaders.set('X-Request-Id', requestId);

  return new Response(response.body, {
    status: response.status,
    headers: outHeaders,
  });
}

function modelsResponse(origin, env, openAiShape = false) {
  const statuses = providerStatuses(env);
  if (openAiShape) {
    return json({
      object: 'list',
      data: Object.entries(MODELS).map(([id, model]) => ({
        id,
        object: 'model',
        owned_by: model.provider,
      })),
    }, 200, origin);
  }

  return json({
    models: Object.entries(MODELS).map(([id, model]) => ({
      id,
      label: model.label,
      vision: model.vision,
      provider: model.provider,
      provider_label: PROVIDERS[model.provider].label,
      configured: statuses[model.provider]?.configured === true,
    })),
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = requestOrigin(request, env);

    if (origin === null) {
      return json({ error: { message: 'Origin non autorisée' } }, 403, '');
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    // `/` serves the Lueur app from static assets; this JSON summary moved here.
    if (request.method === 'GET' && url.pathname === '/api') {
      return json({
        name: 'Lueur Cloud Router',
        status: 'ok',
        api: '/v1/chat/completions',
        models: '/v1/models',
        health: '/health',
        local_url_configured: Boolean(clean(env.LUEUR_LOCAL_URL)),
      }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        status: 'ok',
        router: 'cloudflare-worker',
        background_generations: false,
        providers: providerStatuses(env),
      }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/providers') {
      return json({ providers: providerStatuses(env) }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/props') {
      return json({
        model_path: '',
        router: 'cloudflare-worker',
        providers: providerStatuses(env),
      }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/models') {
      return modelsResponse(origin, env, false);
    }

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      return modelsResponse(origin, env, true);
    }

    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      // The GitHub Pages frontend always sends Origin. Reject anonymous
      // origin-less POSTs by default so the Worker is not an entirely open
      // proxy for the provider keys. This is an abuse guard, not a replacement
      // for Cloudflare Access if the app needs strong authentication.
      if (!origin && clean(env.LUEUR_ALLOW_DIRECT) !== '1') {
        return json({
          error: {
            message: 'Requête directe refusée. Utilise Lueur depuis https://chat.testcivique.workers.dev/.',
          },
        }, 403, '');
      }
      return proxyChat(request, env, origin);
    }

    if (env.ASSETS && request.method === 'GET') return env.ASSETS.fetch(request);
    return json({ error: { message: 'Not found' } }, 404, origin);
  },
};
