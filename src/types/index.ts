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

/** One visible step of the router agent: tool call, memory lookup, summary… */
export interface AgentStep {
  type: 'tool' | 'memory' | 'context' | 'documents' | 'info';
  /** Tool name for `tool` steps, e.g. web_search. */
  name?: string;
  label: string;
  /** Tool argument shown to the user (query, URL, expression). */
  detail?: string;
  status?: 'running' | 'done' | 'error';
  /** Start of the tool result. */
  preview?: string;
  /** Memories used for `memory` steps. */
  items?: string[];
}

// ---------- Artifacts (things the assistant builds) ----------

export type ArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'markdown' | 'json' | 'csv' | 'javascript' | 'code';

export interface ArtifactFile {
  name: string;
  lang: string;
  code: string;
}

export interface ArtifactVersion {
  id: string;
  files: ArtifactFile[];
  /** Assistant message that produced this version (absent for manual edits). */
  messageId?: string;
  source: 'assistant' | 'edit' | 'restore';
  createdAt: number;
}

export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  versions: ArtifactVersion[];
  createdAt: number;
  updatedAt: number;
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
  /** Agent steps reported by the router (tools, memory, context). */
  steps?: AgentStep[];
  /** Artifact version this answer created. */
  artifact?: { id: string; version: number };
  /**
   * Text already present before a "Continue" generation: the router job only
   * holds the continuation, the message shows baseContent + job content.
   */
  baseContent?: string;
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
  /** Versioned artifacts built in this conversation. */
  artifacts?: Artifact[];
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
  /** Lueur router: server-side context manager (summary, memory, documents). */
  _lueur_context?: boolean;
  _lueur_conversation_id?: string;
  /** Lueur router: tool-using agent loop. */
  _lueur_agent?: boolean;
  /** Lueur router: long-term memory (injection + extraction). */
  _lueur_memory?: boolean;
}

/** What the server at baseUrl supports (from GET /health). */
export interface RouterCapabilities {
  /** Router-owned generations that survive a closed browser. */
  background: boolean;
  /** Agent loop, memory and server-side context manager. */
  agent: boolean;
}

export interface MemoryItem {
  id: number;
  text: string;
  source?: string | null;
  created_at: number;
  updated_at: number;
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
  /** Let the router agent use tools (web search, page reading, calculator…). */
  agentEnabled: boolean;
  /** Long-term memory across conversations. */
  memoryEnabled: boolean;
  /** Also send memories to cloud models (they leave the phone). */
  memoryCloud: boolean;
}

export type SettingsTab = 'general' | 'model' | 'agent' | 'connection' | 'generation' | 'appearance';
