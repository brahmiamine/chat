import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { AttachedFile } from '../../types';
import { uid } from '../../lib/chat';
import { ATTACHMENT_ACCEPT, prepareAttachment } from '../../lib/attachments';
import { ArrowDownIcon, ArrowUpIcon, FileIcon, PlusIcon, StopIcon, XIcon } from '../ui/Icons';
import { Tooltip } from '../ui/Tooltip';

const MAX_H = 156; // ≈ 6 lines
const MAX_FILES = 5;

export interface ComposerHandle {
  focus: () => void;
  prefill: (text: string) => void;
  clear: () => void;
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
  const [processingFiles, setProcessingFiles] = useState(false);
  const [fileError, setFileError] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Auto-resize: 1 line → ~6 lines, then scroll.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_H) + 'px';
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, [text]);

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
  }), []);

  const canSend = (!!text.trim() || files.length > 0) && !busy && !processingFiles;

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

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;

    setFileError('');
    setProcessingFiles(true);
    const out: Draft[] = [];
    const remaining = Math.max(0, MAX_FILES - files.length);

    try {
      for (const f of list.slice(0, remaining)) {
        try {
          out.push({ id: uid(), ...(await prepareAttachment(f)) });
        } catch (err) {
          setFileError(err instanceof Error ? err.message : `Impossible de lire ${f.name}`);
        }
      }
      if (list.length > remaining) setFileError(`Maximum ${MAX_FILES} pièces jointes par message.`);
      if (out.length) setFiles(x => [...x, ...out].slice(0, MAX_FILES));
    } finally {
      setProcessingFiles(false);
      ta.current?.focus();
    }
  };

  return (
    <div className={`composer-wrap${docked ? ' docked' : ''}`}>
      {showScrollButton && (
        <button className="to-bottom" aria-label="Aller en bas" onClick={onScrollToBottom}><ArrowDownIcon /></button>
      )}
      <div className="composer">
        {files.length > 0 && (
          <div className="attached">
            {files.map(f => (
              <div key={f.id} className="file-chip">
                <FileIcon /><span>{f.name}</span>
                <button className="chip-x icon-btn ghost" aria-label="Retirer le fichier" onClick={() => setFiles(x => x.filter(y => y.id !== f.id))}>
                  <XIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Posez votre question…"
          aria-label="Message"
          enterKeyHint="send"
        />
        <div className="bar">
          <div className="attach">
            <Tooltip label="Joindre une image, un PDF ou un fichier" placement="top-left">
              <button
                className="round-btn ghost"
                aria-label="Joindre une image, un PDF ou un fichier"
                disabled={processingFiles || files.length >= MAX_FILES}
                onClick={() => fileInput.current?.click()}
              >
                <PlusIcon />
              </button>
            </Tooltip>
            <input ref={fileInput} type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={onFile} style={{ display: 'none' }} />
          </div>
          {generating ? (
            <button className="round-btn stop-btn" aria-label="Arrêter la génération" onClick={onStop}><StopIcon /></button>
          ) : (
            <button className={`round-btn send-btn${canSend ? ' ready' : ''}`} aria-label="Envoyer" disabled={!canSend} onClick={submit}>
              <ArrowUpIcon />
            </button>
          )}
        </div>
        {processingFiles && <div className="attach-status">Préparation des pièces jointes…</div>}
        {!!fileError && <div className="attach-error" role="alert">{fileError}</div>}
      </div>
      {showHint && <div className="composer-hint">Entrée pour envoyer · Maj + Entrée pour aller à la ligne</div>}
    </div>
  );
});
