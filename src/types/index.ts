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

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;
  status: MessageStatus;
  /** Display name of the model that produced the answer. */
  author?: string;
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
  /** Server root, e.g. https://…trycloudflare.com (a trailing /v1 or /v1/chat/completions is tolerated). */
  baseUrl: string;
  apiKey?: string;
}

export type HealthStatus = 'checking' | 'online' | 'offline' | 'loading' | 'demo';

export interface ServerInfo {
  models: string[];
  modelPath?: string;
  nCtx?: number;
}

// ---------- Settings ----------

export type ProviderKind = 'openai-compatible' | 'demo';
export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSize = 15 | 16 | 17;

export interface ModelEntry {
  id: string;
  label: string;
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
