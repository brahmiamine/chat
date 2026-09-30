import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type DragEvent } from 'react';
import type { AttachedFile, Conversation } from '../../types';
import type { LiveStream } from '../../hooks/useChat';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { AssistantMessage, UserMessage } from './Messages';
import { Composer, type ComposerHandle } from './Composer';
import { Hero, Suggestions } from './EmptyState';
import { UploadIcon } from '../ui/Icons';

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
  onContinue: (cid: string, mid: string) => void;
  onOpenArtifact: (cid: string, artifactId: string) => void;
}

export type ChatViewHandle = Omit<ComposerHandle, 'addFiles'>;

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes('Files');

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  { conversation, live, generatingHere, busy, isMobile, onSend, onStop, onRegenerate, onUseDemo, onOpenConnection, onContinue, onOpenArtifact }, ref,
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
  const continueAnswer = useCallback((mid: string) => { if (cid) onContinue(cid, mid); }, [cid, onContinue]);
  const openArtifact = useCallback((id: string) => { if (cid) onOpenArtifact(cid, id); }, [cid, onOpenArtifact]);
  const fix = useCallback((prompt: string) => { if (!busy) onSend(prompt, []); }, [busy, onSend]);
  const artifactTitles = new Map((conversation?.artifacts || []).map(a => [a.id, a.title]));

  const { pin } = scroll;
  const send = useCallback((text: string, files: AttachedFile[]) => {
    pin();
    return onSend(text, files);
  }, [onSend, pin]);

  // ---- drag & drop anywhere in the chat area ----
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    composer.current?.addFiles([...e.dataTransfer.files]);
  };

  let lastAssistant = -1;
  messages.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });

  return (
    <div
      className={`chat-body${hasMessages ? '' : ' empty'}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {hasMessages && (
        <div
          className="scroller"
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          onWheel={scroll.onUserScrollIntent}
          onTouchMove={scroll.onUserScrollIntent}
        >
          <div className="thread" key={conversation!.id}>
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <UserMessage key={m.id} message={m} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  liveContent={liveHere?.mid === m.id ? liveHere.content : undefined}
                  fallbackAuthor={conversation!.modelLabel}
                  isLast={i === lastAssistant}
                  canRegenerate={i === lastAssistant && !busy}
                  onRegenerate={regen}
                  onUseDemo={demoRetry}
                  onOpenConnection={onOpenConnection}
                  onContinue={continueAnswer}
                  onOpenArtifact={openArtifact}
                  onFix={fix}
                  artifactTitle={m.artifact ? artifactTitles.get(m.artifact.id) : undefined}
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

      {dragging && (
        <div className="drop-zone" aria-hidden="true">
          <div className="drop-card">
            <UploadIcon />
            <div className="t">Déposez vos fichiers ici</div>
            <div className="s">Images, PDF, texte ou code · 5 max</div>
          </div>
        </div>
      )}
    </div>
  );
});
