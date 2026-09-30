import { useEffect, useMemo, useRef, useState } from 'react';
import type { HealthStatus, ModelEntry } from '../../types';
import { modelLabel } from '../../lib/settings';
import { CheckIcon, ChevronIcon, MenuIcon, SlidersIcon, SquarePenIcon } from '../ui/Icons';
import { Tooltip } from '../ui/Tooltip';

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
  const busy = health === 'checking' || health === 'loading';
  const btn = (
    <button className={`status-btn ghost s-${health}`} aria-label={`Statut : ${label}`} onClick={onClick} style={{ ['--dot' as string]: color }}>
      <span className={`status-dot${busy ? ' pulse' : ''}`} />
      {showLabel && <span className="status-label">{label}</span>}
    </button>
  );
  return showLabel ? btn : <Tooltip label={label} placement="bottom-right">{btn}</Tooltip>;
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
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const providerGroups = useMemo(() => {
    const map = new Map<string, { id: string; label: string; models: ModelEntry[] }>();
    for (const model of models) {
      const id = model.provider || 'custom';
      const label = model.providerLabel || (id === 'custom' ? 'Personnalisé' : id);
      const current = map.get(id);
      if (current) current.models.push(model);
      else map.set(id, { id, label, models: [model] });
    }
    return [...map.values()];
  }, [models]);

  useEffect(() => {
    if (!open) return;
    const selected = models.find(m => m.id === modelId);
    setExpandedProvider(selected?.provider || 'custom');
  }, [open, modelId, models]);

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
        <button className="hdr-icon icon-btn ghost-plain" aria-label="Ouvrir le menu" onClick={onOpenDrawer}><MenuIcon /></button>
      )}
      <div className="model-wrap" ref={wrap}>
        <button
          className={`model-btn ghost-plain${open ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={currentLabel}
          onClick={() => setOpen(o => !o)}
        >
          <span className="model-name">{currentLabel}</span>
          <span className="chev"><ChevronIcon /></span>
        </button>
        {open && (
          <div className="model-menu menu" role="menu">
            <div className="label">Choisir un modèle</div>
            <div className="provider-groups">
              {providerGroups.map(group => {
                const expanded = expandedProvider === group.id;
                const selectedInGroup = group.models.some(m => m.id === modelId);
                return (
                  <div className={`provider-group${expanded ? ' open' : ''}`} key={group.id}>
                    <button
                      className={`provider-head ghost${selectedInGroup ? ' selected' : ''}`}
                      aria-expanded={expanded}
                      onClick={() => setExpandedProvider(v => v === group.id ? null : group.id)}
                    >
                      <span className="provider-name">{group.label}</span>
                      <span className="provider-count">{group.models.length}</span>
                      <span className="provider-chev"><ChevronIcon size={14} /></span>
                    </button>
                    {expanded && (
                      <div className="provider-models">
                        {group.models.map(m => {
                          const on = m.id === modelId;
                          return (
                            <button
                              key={m.id}
                              role="menuitemradio"
                              aria-checked={on}
                              className={`model-opt${on ? ' on' : ''}`}
                              onClick={() => { onSelectModel(m.id); setOpen(false); }}
                            >
                              <span className="txt">
                                <span className="name">{modelLabel(m)}</span>
                                <span className="id">{m.id.replace(/^[a-z]+::/i, '')}</span>
                              </span>
                              <span className="tick">{on && <CheckIcon />}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="sep" />
            <button className="model-manage ghost" onClick={() => { setOpen(false); onManageModels(); }}>
              <SlidersIcon />Gérer les modèles…
            </button>
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
