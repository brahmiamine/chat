/**
 * Full-screen preview for attachments: image galleries (zoom, swipe, arrows,
 * download) and text/PDF extracts. Opened from anywhere through `usePreview()`.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon, ZoomInIcon, ZoomOutIcon } from './Icons';

export interface PreviewItem {
  name: string;
  kind: 'image' | 'text';
  /** Image source (data URL). */
  src?: string;
  /** Text content for text / PDF previews. */
  text?: string;
  /** Secondary label, e.g. "Page 2". */
  caption?: string;
}

interface PreviewState { items: PreviewItem[]; index: number }

type OpenPreview = (items: PreviewItem[], index?: number) => void;

const PreviewContext = createContext<OpenPreview>(() => {});

export const usePreview = () => useContext(PreviewContext);

const CLOSE_MS = 160;

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef(0);

  const open = useCallback<OpenPreview>((items, index = 0) => {
    if (!items.length) return;
    clearTimeout(timer.current);
    setClosing(false);
    setState({ items, index: Math.min(Math.max(0, index), items.length - 1) });
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setState(null); setClosing(false); }, CLOSE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <PreviewContext.Provider value={open}>
      {children}
      {state && (
        <Lightbox
          items={state.items}
          index={state.index}
          closing={closing}
          onIndex={i => setState(s => (s ? { ...s, index: i } : s))}
          onClose={close}
        />
      )}
    </PreviewContext.Provider>
  );
}

interface LightboxProps {
  items: PreviewItem[];
  index: number;
  closing: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
}

function Lightbox({ items, index, closing, onIndex, onClose }: LightboxProps) {
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const item = items[index];
  const many = items.length > 1;

  const go = useCallback((d: number) => {
    if (!many) return;
    setZoom(false);
    onIndex((index + d + items.length) % items.length);
  }, [index, items.length, many, onIndex]);

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose]);

  /** The zoomed image follows the pointer so every part of it can be inspected. */
  const aim = (img: HTMLElement, x: number, y: number) => {
    // Measured on the (untransformed) stage so the origin does not feed back into itself.
    const r = (img.parentElement || img).getBoundingClientRect();
    const px = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100));
    const py = Math.min(100, Math.max(0, ((y - r.top) / r.height) * 100));
    setOrigin(`${px.toFixed(1)}% ${py.toFixed(1)}%`);
  };
  const toggleZoom = (e: MouseEvent<HTMLImageElement>) => {
    if (!zoom) aim(e.currentTarget, e.clientX, e.clientY);
    setZoom(z => !z);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (zoom || e.touches.length !== 1) return;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.4) onClose();
  };

  return (
    <div
      className={`lightbox${closing ? ' closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu : ${item.name}`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="lb-bar">
        <div className="lb-title">
          <span className="name">{item.name}</span>
          {(item.caption || many) && (
            <span className="meta">{[item.caption, many ? `${index + 1} / ${items.length}` : ''].filter(Boolean).join(' · ')}</span>
          )}
        </div>
        {item.kind === 'image' && (
          <>
            <button className="lb-btn hide-sm" aria-label={zoom ? 'Ajuster à l’écran' : 'Agrandir'} onClick={() => { setOrigin('50% 50%'); setZoom(z => !z); }}>
              {zoom ? <ZoomOutIcon /> : <ZoomInIcon />}
            </button>
            <a className="lb-btn" href={item.src} download={item.name} aria-label="Télécharger"><DownloadIcon /></a>
          </>
        )}
        <button ref={closeBtn} className="lb-btn" aria-label="Fermer l’aperçu" onClick={onClose}><XIcon size={20} /></button>
      </div>

      <div
        className={`lb-stage${zoom ? ' zoomed' : ''}`}
        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {item.kind === 'image' ? (
          <img
            key={index}
            className="lb-img"
            src={item.src}
            alt={item.caption ? `${item.name} — ${item.caption}` : item.name}
            draggable={false}
            style={{ transformOrigin: origin }}
            onClick={toggleZoom}
            onMouseMove={e => { if (zoom) aim(e.currentTarget, e.clientX, e.clientY); }}
            onTouchMove={e => { if (zoom && e.touches.length === 1) aim(e.currentTarget, e.touches[0].clientX, e.touches[0].clientY); }}
          />
        ) : (
          <pre key={index} className="lb-text">{item.text || 'Aucun texte à afficher.'}</pre>
        )}
      </div>

      {many && (
        <>
          <button className="lb-nav prev" aria-label="Précédent" onClick={() => go(-1)}><ChevronLeftIcon /></button>
          <button className="lb-nav next" aria-label="Suivant" onClick={() => go(1)}><ChevronRightIcon /></button>
          <div className="lb-thumbs">
            {items.map((it, i) => (
              <button
                key={i}
                className={`lb-thumb${i === index ? ' on' : ''}`}
                aria-label={`Afficher ${it.caption || it.name}`}
                aria-current={i === index}
                onClick={() => { setZoom(false); onIndex(i); }}
              >
                {it.kind === 'image' ? <img src={it.src} alt="" draggable={false} /> : <span>Aa</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
