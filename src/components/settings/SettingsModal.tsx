import { useEffect, useRef, type ReactNode } from 'react';
import type { HealthStatus, ServerInfo, Settings, SettingsTab } from '../../types';
import type { TestResult } from '../../hooks/useServerHealth';
import { ContrastIcon, CpuIcon, GearIcon, PlugIcon, SlidersIcon, XIcon } from '../ui/Icons';
import { GeneralTab } from './GeneralTab';
import { ModelTab } from './ModelTab';
import { ConnectionTab } from './ConnectionTab';
import { GenerationTab } from './GenerationTab';
import { AppearanceTab } from './AppearanceTab';

const TABS: [SettingsTab, string, ReactNode][] = [
  ['general', 'Général', <GearIcon />],
  ['model', 'Modèle', <CpuIcon />],
  ['connection', 'Connexion', <PlugIcon />],
  ['generation', 'Génération', <SlidersIcon />],
  ['appearance', 'Apparence', <ContrastIcon />],
];

export interface SettingsModalProps {
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onClose: () => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  health: HealthStatus;
  server: ServerInfo;
  test: TestResult;
  onTest: () => void;
  loadServerInfo: () => Promise<ServerInfo | null>;
  conversationCount: number;
  onClearAll: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const { tab, onTab, onClose } = props;
  const title = (TABS.find(t => t[0] === tab) || TABS[2])[1];
  const nav = useRef<HTMLElement>(null);
  // Mobile: the tab strip scrolls horizontally, keep the active tab visible.
  useEffect(() => {
    nav.current?.querySelector('.settings-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  return (
    <div className="overlay settings-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Paramètres">
        <nav className="settings-nav" role="tablist" ref={nav}>
          <div className="title">Paramètres</div>
          {TABS.map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`settings-tab${tab === id ? ' on' : ''}`} onClick={() => onTab(id)}>
              {icon}{label}
            </button>
          ))}
        </nav>
        <div className="settings-main">
          <div className="settings-head">
            <h2>{title}</h2>
            <button className="settings-close icon-btn ghost" aria-label="Fermer" onClick={onClose}><XIcon /></button>
          </div>
          <div className="settings-body" role="tabpanel" key={tab}>
            {tab === 'general' && <GeneralTab {...props} />}
            {tab === 'model' && <ModelTab {...props} />}
            {tab === 'connection' && <ConnectionTab {...props} />}
            {tab === 'generation' && <GenerationTab {...props} />}
            {tab === 'appearance' && <AppearanceTab {...props} />}
          </div>
        </div>
      </div>
    </div>
  );
}
