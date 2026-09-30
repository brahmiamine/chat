// ---------- Chat domain ----------

export type Role = 'system' | 'user' | 'assistant';

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

export type AttachedFileKind = 'text' | 'image' | 'pdf';

export interface AttachedFile {
  name: string;
  /** Optional for backward compatibility with conversations saved before multimodal support. */
  kind?: AttachedFileKind;
  mimeType?: string;
  /** Extracted text for text files and text-based PDFs. */
  text?: string;
  /** Base64 data URL for an image attachment. */
  dataUrl?: string;
  /** Rendered page images for scanned/image-only PDFs. */
  images?: string[];
  pageCount?: number;
}

/** A user-facing, stack-trace-free error attached to a failed assistant message. */
export interface ChatError {
  title: string;
  hint: string;
  /** The server answered with an HTTP error (it is reachable). */
  http?: boolean;
  /** Offer the offline demo mode as a way out. */
  demo?: boolean;
}

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  files?: AttachedFile[];
  createdAt: number;
}

export type TokenCountSource = 'provider' | 'local' | 'estimated';

export interface GenerationMetrics {
  /** Provider id handled by the Lueur router, e.g. local, groq, gemini. */
  provider: string;
  providerLabel?: string;
  /** Lueur model id requested by the conversation. */
  modelId: string;
  /** Actual upstream model when a router/provider resolved a generic model. */
  resolvedModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  tokenCountSource?: TokenCountSource;
  /** Request start → first visible token. */
  ttftMs?: number;
  /** Request start → terminal state. */
  durationMs?: number;
  /** First visible token → terminal state. */
  generationMs?: number;
  /** Output throughput based on output tokens / generation time. */
  tokensPerSecond?: number;
  /** Time spent waiting before the upstream request started. */
  queueMs?: number;
  /** Local llama.cpp context window when known. */
  contextLimit?: number;
  finishReason?: string;
  /** Provider-reported cost when available. Local inference is exactly 0. */
  costUsd?: number | null;
  /** Number of SSE viewer re-connections to the same background job. */
  reconnects?: number;
  httpStatus?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;
  status: MessageStatus;
  /** Display name of the model that produced the answer. */
  author?: string;
  /**
   * Router-owned generation id. When present, the generation can continue on
   * the Termux server even if the browser/tab is closed, then resume later.
   */
  generationId?: string;
  /** Runtime/token telemetry. Contains metrics only, never prompt contents. */
  metrics?: GenerationMetrics;
  error?: ChatError | null;
  createdAt: number;
}

export type Message = UserMessage | AssistantMessage;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Technical model id used for the conversation. */
  model: string;
  /** Friendly model name, e.g. "Qwen3.5 4B Vision". */
  modelLabel: string;
  messages: Message[];
}

// ---------- Provider / API (OpenAI-compatible) ----------

export type ApiChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** Wire format sent to `/v1/chat/completions`. */
export interface ApiChatMessage {
  role: Role;
  content: string | ApiChatContentPart[];
}

export interface ChatCompletionParams {
  model: string;
  messages: ApiChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ProviderConfig {
  /** Lueur/OpenAI-compatible server root, e.g. the public ngrok URL. */
  baseUrl: string;
  apiKey?: string;
}

export type HealthStatus = 'checking' | 'online' | 'offline' | 'loading' | 'demo';

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  missing: string[];
}

export interface ServerInfo {
  models: string[];
  modelPath?: string;
  nCtx?: number;
  providers?: Record<string, ProviderStatus>;
}

// ---------- Settings ----------

export type ProviderKind = 'openai-compatible' | 'demo';
export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSize = 15 | 16 | 17;

export type ModelProviderId =
  | 'local'
  | 'groq'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'cloudflare'
  | 'huggingface'
  | 'nvidia'
  | 'cohere'
  | 'vercel'
  | 'custom';

export interface ModelEntry {
  id: string;
  label: string;
  /** Provider handled by the Lueur Termux router. */
  provider?: ModelProviderId;
  providerLabel?: string;
}

export interface GenerationSettings {
  temperature: number;
  topP: number;
  maxTokens: number;
  contextSize: number;
}

export interface Settings extends GenerationSettings {
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  models: ModelEntry[];
  modelId: string;
  systemPrompt: string;
  theme: ThemeMode;
  fontSize: FontSize;
}

export type SettingsTab = 'general' | 'model' | 'connection' | 'generation' | 'appearance';
