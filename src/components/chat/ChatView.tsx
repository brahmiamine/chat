import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import type { AttachedFile, Conversation } from '../../types';
import type { LiveStream } from '../../hooks/useChat';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { AssistantMessage, UserMessage } from './Messages';
import { Composer, type ComposerHandle } from './Composer';
import { Hero, Suggestions } from './EmptyState';

interface Props {
  conversation: Conversation | null;
  live: LiveStream | null;
  generatingHere: boolean;
  busy: boolean;
  isMobile: boolean;
  onSend: (text: string, files: AttachedFile[]) => boolean;
  onStop: () => void;
  onRegenerate: (cid: string, mid: string) => void;
  onUseDemo: (cid: string, mid: string) => void;
  onOpenConnection: () => void;
}

export type ChatViewHandle = ComposerHandle;

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { conversation, live, generatingHere, busy, isMobile, onSend, onStop, onRegenerate, onUseDemo, onOpenConnection }, ref,
) {
  const composer = useRef<ComposerHandle>(null);
  useImperativeHandle(ref, () => ({
    focus: () => composer.current?.focus(),
    prefill: t => composer.current?.prefill(t),
    clear: () => composer.current?.clear(),
  }), []);

  const messages = conversation?.messages ?? [];
  const hasMessages = messages.length > 0;
  const liveHere = live && live.cid === conversation?.id ? live : null;
  const scroll = useAutoScroll([messages, liveHere?.content], conversation?.id ?? null);

  const cid = conversation?.id;
  const regen = useCallback((mid: string) => { if (cid) onRegenerate(cid, mid); }, [cid, onRegenerate]);
  const demoRetry = useCallback((mid: string) => { if (cid) onUseDemo(cid, mid); }, [cid, onUseDemo]);

  const { pin } = scroll;
  const send = useCallback((text: string, files: AttachedFile[]) => {
    pin();
    return onSend(text, files);
  }, [onSend, pin]);

  let lastAssistant = -1;
  messages.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });

  return (
    <div className={`chat-body${hasMessages ? '' : ' empty'}`}>
      {hasMessages && (
        <div
          className="scroller"
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          onWheel={scroll.onUserScrollIntent}
          onTouchMove={scroll.onUserScrollIntent}
        >
          <div className="thread">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <UserMessage key={m.id} message={m} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  liveContent={liveHere?.mid === m.id ? liveHere.content : undefined}
                  fallbackAuthor={conversation!.modelLabel}
                  canRegenerate={i === lastAssistant && !busy}
                  onRegenerate={regen}
                  onUseDemo={demoRetry}
                  onOpenConnection={onOpenConnection}
                />
              ),
            )}
          </div>
        </div>
      )}

      {!hasMessages && <Hero />}

      <Composer
        ref={composer}
        generating={generatingHere}
        busy={busy}
        onSend={send}
        onStop={onStop}
        docked={hasMessages}
        showHint={!isMobile && hasMessages}
        showScrollButton={hasMessages && !scroll.atBottom}
        onScrollToBottom={() => scroll.scrollToBottom()}
      />

      {!hasMessages && <Suggestions onPick={t => composer.current?.prefill(t)} />}
    </div>
  );
});
