import { lazy, memo, Suspense } from 'react';
import type { AssistantMessage as AssistantMsg, GenerationMetrics, UserMessage as UserMsg } from '../../types';
import { splitThink } from '../../lib/chat';
import { useCopy } from '../../hooks/useCopy';
import { AlertIcon, CheckIcon, CopyIcon, RefreshIcon, StarIcon, StopIcon } from '../ui/Icons';
import { Tooltip } from '../ui/Tooltip';
import { AttachmentList } from './Attachments';

// Markdown + highlight.js live in their own chunk, prefetched on idle (see main.tsx).
export const loadMarkdown = () => import('./Markdown');
const Markdown = lazy(() => loadMarkdown().then(m => ({ default: m.Markdown })));

/** Plain-text fallback shown for the few ms before the Markdown chunk is ready. */
const PlainText = ({ text }: { text: string }) => <div className="md"><p style={{ whiteSpace: 'pre-wrap' }}>{text}</p></div>;

export function TypingDots({ label }: { label?: string }) {
  return (
    <div className="typing" role="status" aria-label={label || 'Le modèle rédige'}>
      <div className="dots"><span /><span /><span /></div>
      {label && <span className="typing-label">{label}</span>}
    </div>
  );
}

function compactMs(ms?: number) {
  if (typeof ms !== 'number') return null;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function MetricsLine({ metrics }: { metrics?: GenerationMetrics }) {
  if (!metrics) return null;
  const estimated = metrics.tokenCountSource === 'estimated';
  const items: string[] = [];
  if (metrics.providerLabel) items.push(metrics.providerLabel);
  if (typeof metrics.inputTokens === 'number' || typeof metrics.outputTokens === 'number') {
    const input = metrics.inputTokens ?? 0;
    const output = metrics.outputTokens ?? 0;
    items.push(`${estimated ? '≈' : ''}${input.toLocaleString('fr-FR')} in · ${output.toLocaleString('fr-FR')} out`);
  } else if (typeof metrics.totalTokens === 'number') {
    items.push(`${estimated ? '≈' : ''}${metrics.totalTokens.toLocaleString('fr-FR')} tokens`);
  }
  if (typeof metrics.tokensPerSecond === 'number') items.push(`${metrics.tokensPerSecond.toFixed(1)} tok/s`);
  const ttft = compactMs(metrics.ttftMs);
  if (ttft) items.push(`TTFT ${ttft}`);
  const dur = compactMs(metrics.durationMs);
  if (dur) items.push(dur);
  if (metrics.contextLimit && metrics.inputTokens != null) {
    items.push(`ctx ${metrics.inputTokens.toLocaleString('fr-FR')}/${metrics.contextLimit.toLocaleString('fr-FR')}`);
  }
  if (metrics.reconnects) items.push(`${metrics.reconnects} reconnexion${metrics.reconnects > 1 ? 's' : ''}`);
  if (typeof metrics.costUsd === 'number') {
    items.push(metrics.costUsd === 0 ? '0 
export const UserMessage = memo(function UserMessage({ message }: { message: UserMsg }) {
  const { copied, copy } = useCopy();
  return (
    <div className="msg msg-user">
      {!!message.files?.length && <AttachmentList variant="message" files={message.files} />}
      {!!message.content && <div className="bubble">{message.content}</div>}
      {!!message.content && (
        <div className="msg-actions user-actions">
          <Tooltip label={copied ? 'Copié' : 'Copier'}>
            <button className="act-btn icon-btn ghost" aria-label="Copier le message" onClick={() => copy(message.content)}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

interface AssistantProps {
  message: AssistantMsg;
  /** Live text while streaming (overrides message.content). */
  liveContent?: string;
  fallbackAuthor: string;
  isLast: boolean;
  canRegenerate: boolean;
  onRegenerate: (mid: string) => void;
  onUseDemo: (mid: string) => void;
  onOpenConnection: () => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  message, liveContent, fallbackAuthor, isLast, canRegenerate, onRegenerate, onUseDemo, onOpenConnection,
}: AssistantProps) {
  const { copied, copy } = useCopy();
  const streaming = message.status === 'streaming';
  const stopped = message.status === 'stopped';
  const { text, thinking } = splitThink(liveContent ?? message.content ?? '');
  const hasText = !!text.trim();
  const err = message.status === 'error' ? message.error : null;
  const showActions = !streaming && message.status !== 'error' && hasText;

  return (
    <div className={`msg msg-assistant${isLast ? ' last' : ''}${streaming ? ' streaming' : ''}`}>
      <div className="msg-author">
        <span className={`avatar${streaming ? ' live' : ''}`}><StarIcon size={12} /></span>
        <span className="who">{message.author || fallbackAuthor || 'Assistant'}</span>
      </div>
      {hasText && (
        <div className="msg-body">
          <Suspense fallback={<PlainText text={text} />}><Markdown text={text} /></Suspense>
        </div>
      )}
      {streaming && (thinking || !hasText) && <TypingDots label={thinking ? 'Réflexion…' : undefined} />}
      {stopped && (
        <div className="msg-stopped">
          <span className="pill"><StopIcon size={10} />{hasText ? 'Réponse interrompue' : 'Génération interrompue'}</span>
          {!hasText && canRegenerate && (
            <button className="err-retry sm" onClick={() => onRegenerate(message.id)}><RefreshIcon size={14} />Réessayer</button>
          )}
        </div>
      )}
      {message.status === 'error' && (
        <div className="err-card" role="alert">
          <span className="ico"><AlertIcon /></span>
          <div className="txt">
            <div className="title">{err?.title || 'Une erreur est survenue.'}</div>
            {err?.hint && <div className="hint">{err.hint}</div>}
            <div className="btns">
              <button className="err-retry" onClick={() => onRegenerate(message.id)}><RefreshIcon />Réessayer</button>
              {err?.demo && <button className="err-link ghost" onClick={() => onUseDemo(message.id)}>Utiliser le mode démo</button>}
              <button className="err-link ghost" onClick={onOpenConnection}>Paramètres de connexion</button>
            </div>
          </div>
        </div>
      )}
      {!streaming && <MetricsLine metrics={message.metrics} />}
      {showActions && (
        <div className="msg-actions">
          <Tooltip label={copied ? 'Copié' : 'Copier'}>
            <button className={`act-btn icon-btn ghost${copied ? ' done' : ''}`} aria-label="Copier" onClick={() => copy(text)}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </Tooltip>
          {canRegenerate && (
            <Tooltip label="Régénérer">
              <button className="act-btn icon-btn ghost" aria-label="Régénérer" onClick={() => onRegenerate(message.id)}>
                <RefreshIcon />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
});
 : `${metrics.costUsd.toFixed(4)} import { lazy, memo, Suspense } from 'react';
import type { AssistantMessage as AssistantMsg, GenerationMetrics, UserMessage as UserMsg } from '../../types';
import { splitThink } from '../../lib/chat';
import { useCopy } from '../../hooks/useCopy';
import { AlertIcon, CheckIcon, CopyIcon, RefreshIcon, StarIcon, StopIcon } from '../ui/Icons';
import { Tooltip } from '../ui/Tooltip';
import { AttachmentList } from './Attachments';

// Markdown + highlight.js live in their own chunk, prefetched on idle (see main.tsx).
export const loadMarkdown = () => import('./Markdown');
const Markdown = lazy(() => loadMarkdown().then(m => ({ default: m.Markdown })));

/** Plain-text fallback shown for the few ms before the Markdown chunk is ready. */
const PlainText = ({ text }: { text: string }) => <div className="md"><p style={{ whiteSpace: 'pre-wrap' }}>{text}</p></div>;

);
  }

  const detail = [
    metrics.resolvedModel && `Modèle: ${metrics.resolvedModel}`,
    metrics.finishReason && `Arrêt: ${metrics.finishReason}`,
    metrics.queueMs != null && `File: ${compactMs(metrics.queueMs)}`,
    estimated && 'Tokens estimés (le fournisseur n’a pas renvoyé de comptage exact)',
  ].filter(Boolean).join(' · ');

  return <div className="msg-metrics" title={detail || undefined}>{items.map((x, i) => <span key={i}>{x}</span>)}</div>;
}

export const UserMessage = memo(function UserMessage({ message }: { message: UserMsg }) {
  const { copied, copy } = useCopy();
  return (
    <div className="msg msg-user">
      {!!message.files?.length && <AttachmentList variant="message" files={message.files} />}
      {!!message.content && <div className="bubble">{message.content}</div>}
      {!!message.content && (
        <div className="msg-actions user-actions">
          <Tooltip label={copied ? 'Copié' : 'Copier'}>
            <button className="act-btn icon-btn ghost" aria-label="Copier le message" onClick={() => copy(message.content)}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

interface AssistantProps {
  message: AssistantMsg;
  /** Live text while streaming (overrides message.content). */
  liveContent?: string;
  fallbackAuthor: string;
  isLast: boolean;
  canRegenerate: boolean;
  onRegenerate: (mid: string) => void;
  onUseDemo: (mid: string) => void;
  onOpenConnection: () => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  message, liveContent, fallbackAuthor, isLast, canRegenerate, onRegenerate, onUseDemo, onOpenConnection,
}: AssistantProps) {
  const { copied, copy } = useCopy();
  const streaming = message.status === 'streaming';
  const stopped = message.status === 'stopped';
  const { text, thinking } = splitThink(liveContent ?? message.content ?? '');
  const hasText = !!text.trim();
  const err = message.status === 'error' ? message.error : null;
  const showActions = !streaming && message.status !== 'error' && hasText;

  return (
    <div className={`msg msg-assistant${isLast ? ' last' : ''}${streaming ? ' streaming' : ''}`}>
      <div className="msg-author">
        <span className={`avatar${streaming ? ' live' : ''}`}><StarIcon size={12} /></span>
        <span className="who">{message.author || fallbackAuthor || 'Assistant'}</span>
      </div>
      {hasText && (
        <div className="msg-body">
          <Suspense fallback={<PlainText text={text} />}><Markdown text={text} /></Suspense>
        </div>
      )}
      {streaming && (thinking || !hasText) && <TypingDots label={thinking ? 'Réflexion…' : undefined} />}
      {stopped && (
        <div className="msg-stopped">
          <span className="pill"><StopIcon size={10} />{hasText ? 'Réponse interrompue' : 'Génération interrompue'}</span>
          {!hasText && canRegenerate && (
            <button className="err-retry sm" onClick={() => onRegenerate(message.id)}><RefreshIcon size={14} />Réessayer</button>
          )}
        </div>
      )}
      {message.status === 'error' && (
        <div className="err-card" role="alert">
          <span className="ico"><AlertIcon /></span>
          <div className="txt">
            <div className="title">{err?.title || 'Une erreur est survenue.'}</div>
            {err?.hint && <div className="hint">{err.hint}</div>}
            <div className="btns">
              <button className="err-retry" onClick={() => onRegenerate(message.id)}><RefreshIcon />Réessayer</button>
              {err?.demo && <button className="err-link ghost" onClick={() => onUseDemo(message.id)}>Utiliser le mode démo</button>}
              <button className="err-link ghost" onClick={onOpenConnection}>Paramètres de connexion</button>
            </div>
          </div>
        </div>
      )}
      {showActions && (
        <div className="msg-actions">
          <Tooltip label={copied ? 'Copié' : 'Copier'}>
            <button className={`act-btn icon-btn ghost${copied ? ' done' : ''}`} aria-label="Copier" onClick={() => copy(text)}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </Tooltip>
          {canRegenerate && (
            <Tooltip label="Régénérer">
              <button className="act-btn icon-btn ghost" aria-label="Régénérer" onClick={() => onRegenerate(message.id)}>
                <RefreshIcon />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
});
