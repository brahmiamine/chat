import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { AttachedFile } from '../../types';
import { uid } from '../../lib/chat';
import { ATTACHMENT_ACCEPT, prepareAttachment } from '../../lib/attachments';
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, PaperclipIcon, StopIcon, XIcon } from '../ui/Icons';
import { Tooltip } from '../ui/Tooltip';
import { AttachmentList } from './Attachments';

const MAX_H = 200; // ≈ 8 lines
const MAX_FILES = 5;

export interface ComposerHandle {
  focus: () => void;
  prefill: (text: string) => void;
  clear: () => void;
  addFiles: (files: File[]) => void;
}

interface Props {
  /** A generation is running in this conversation (shows Stop). */
  generating: boolean;
  /** A generation is running somewhere (sending is disabled). */
  busy: boolean;
  /** Returns false if the message could not be sent (the draft is then kept). */
  onSend: (text: string, files: AttachedFile[]) => boolean;
  onStop: () => void;
  docked: boolean;
  showHint: boolean;
  showScrollButton: boolean;
  onScrollToBottom: () => void;
}

type Draft = AttachedFile & { id: string };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { generating, busy, onSend, onStop, docked, showHint, showScrollButton, onScrollToBottom }, ref,
) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Draft[]>([]);
  const [pending, setPending] = useState(0);
  const [fileError, setFileError] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const count = useRef(0);
  count.current = files.length + pending;

  // Auto-resize: 1 line → ~8 lines, then scroll.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_H) + 'px';
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, [text]);

  const addFiles = useCallback(async (list: File[]) => {
    if (!list.length) return;
    const remaining = Math.max(0, MAX_FILES - count.current);
    const take = list.slice(0, remaining);
    setFileError(list.length > remaining ? `Maximum ${MAX_FILES} pièces jointes par message.` : '');
    if (!take.length) return;

    setPending(p => p + take.length);
    // Prepared in parallel, added in the order they were picked.
    const prepared = await Promise.all(take.map(async f => {
      try {
        return { id: uid(), ...(await prepareAttachment(f)) } as Draft;
      } catch (err) {
        setFileError(err instanceof Error ? err.message : `Impossible de lire ${f.name}`);
        return null;
      }
    }));
    setPending(p => p - take.length);
    const ok = prepared.filter((d): d is Draft => !!d);
    if (ok.length) setFiles(x => [...x, ...ok].slice(0, MAX_FILES));
    if (window.matchMedia?.('(hover: hover)').matches) ta.current?.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    prefill: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = ta.current;
        if (el) { el.focus(); el.setSelectionRange(t.length, t.length); }
      });
    },
    clear: () => { setText(''); setFiles([]); setFileError(''); },
    addFiles: (list: File[]) => { addFiles(list); },
  }), [addFiles]);

  const processing = pending > 0;
  const canSend = (!!text.trim() || files.length > 0) && !busy && !processing;

  const submit = useCallback(() => {
    if (!canSend) return;
    const payload = files.map(({ id: _id, ...file }) => file);
    if (onSend(text, payload)) {
      setText('');
      setFiles([]);
      setFileError('');
    }
  }, [canSend, files, onSend, text]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (!pasted.length) return;
    e.preventDefault();
    addFiles(pasted);
  };

  const full = count.current >= MAX_FILES;

  return (
    <div className={`composer-wrap${docked ? ' docked' : ''}`}>
      <button
        className={`to-bottom${showScrollButton ? ' show' : ''}`}
        aria-label="Aller en bas"
        tabIndex={showScrollButton ? 0 : -1}
        aria-hidden={!showScrollButton}
        onClick={onScrollToBottom}
      >
        <ArrowDownIcon size={17} />
      </button>
      <div className={`composer${generating ? ' is-generating' : ''}`}>
        {(files.length > 0 || processing) && (
          <AttachmentList
            variant="composer"
            files={files}
            pending={pending}
            onRemove={i => setFiles(x => x.filter((_, j) => j !== i))}
          />
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={files.length ? 'Ajoutez une question sur ces fichiers…' : 'Posez votre question…'}
          aria-label="Message"
          enterKeyHint="send"
        />
        {!!fileError && (
          <div className="attach-error" role="alert">
            <AlertIcon size={14} /><span>{fileError}</span>
            <button className="icon-btn ghost" aria-label="Masquer" onClick={() => setFileError('')}><XIcon size={13} /></button>
          </div>
        )}
        <div className="bar">
          <div className="attach">
            <Tooltip label={full ? `Maximum ${MAX_FILES} fichiers` : 'Joindre une image, un PDF ou un fichier'} placement="top-left">
              <button
                className="round-btn ghost attach-btn"
                aria-label="Joindre une image, un PDF ou un fichier"
                disabled={full}
                onClick={() => fileInput.current?.click()}
              >
                <PaperclipIcon size={19} />
              </button>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; addFiles(l); }}
              hidden
            />
            {processing && <span className="attach-status">Préparation…</span>}
          </div>
          <div className="send-slot">
            {generating ? (
              <button key="stop" className="round-btn stop-btn" aria-label="Arrêter la génération" onClick={onStop}><StopIcon size={16} /></button>
            ) : (
              <button key="send" className={`round-btn send-btn${canSend ? ' ready' : ''}`} aria-label="Envoyer" disabled={!canSend} onClick={submit}>
                <ArrowUpIcon size={19} />
              </button>
            )}
          </div>
        </div>
      </div>
      {showHint && <div className="composer-hint">Entrée pour envoyer · Maj + Entrée pour aller à la ligne · Glissez ou collez des images</div>}
    </div>
  );
});
