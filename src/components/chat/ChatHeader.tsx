import { useEffect, useRef, useState } from 'react';
import type { HealthStatus, ModelEntry } from '../../types';
import { modelLabel } from '../../lib/settings';
import { ChevronIcon, MenuIcon, SquarePenIcon } from '../ui/Icons';
import { BrandLogo } from '../ui/BrandLogo';

const STATUS: Record<HealthStatus, [string, string]> = {
  online: ['var(--ok)', 'En ligne'],
  offline: ['var(--bad)', 'Hors ligne'],
  loading: ['var(--warn)', 'Chargement du modèle'],
  checking: ['var(--faint)', 'Connexion…'],
  demo: ['var(--accent)', 'Mode démo'],
};

export function statusLabel(h: HealthStatus) {
  return STATUS[h][1];
}

export function StatusIndicator({ health, showLabel, onClick }: { health: HealthStatus; showLabel: boolean; onClick: () => void }) {
  const [color, label] = STATUS[health];
  return (
    <button className="status-btn ghost" aria-label={label} onClick={onClick}>
      <span className="status-dot" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in oklch, ${color} 18%, transparent)` }} />
      {showLabel && <span>{label}</span>}
    </button>
  );
}

interface Props {
  isMobile: boolean;
  models: ModelEntry[];
  modelId: string;
  currentLabel: string;
  health: HealthStatus;
  onSelectModel: (id: string) => void;
  onManageModels: () => void;
  onOpenConnection: () => void;
  onOpenDrawer: () => void;
  onNewChat: () => void;
}

export function ChatHeader({ isMobile, models, modelId, currentLabel, health, onSelectModel, onManageModels, onOpenConnection, onOpenDrawer, onNewChat }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <header className="header">
      {isMobile && (
        <button className="hdr-icon icon-btn ghost-plain" aria-label="Menu" onClick={onOpenDrawer}><MenuIcon /></button>
      )}
      <div className="header-logo" aria-label="Lueur"><BrandLogo size={28} /></div>
      <div className="model-wrap" ref={wrap}>
        <button className="model-btn ghost-plain" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {currentLabel}<span className="chev"><ChevronIcon /></span>
        </button>
        {open && (
          <div className="model-menu menu" role="menu">
            <div className="label">Modèle</div>
            {models.map(m => (
              <button key={m.id} role="menuitemradio" aria-checked={m.id === modelId} className="model-opt" onClick={() => { onSelectModel(m.id); setOpen(false); }}>
                <span className={`radio${m.id === modelId ? ' on' : ''}`} />
                <span className="name">{modelLabel(m)}</span>
              </button>
            ))}
            <div className="sep" />
            <button className="model-manage ghost" onClick={() => { setOpen(false); onManageModels(); }}>Gérer les modèles…</button>
          </div>
        )}
      </div>
      <div className="spacer" />
      <StatusIndicator health={health} showLabel={!isMobile} onClick={onOpenConnection} />
      {isMobile && (
        <button className="hdr-icon icon-btn ghost-plain" aria-label="Nouvelle conversation" onClick={onNewChat}><SquarePenIcon /></button>
      )}
    </header>
  );
}
