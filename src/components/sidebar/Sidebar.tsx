import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Conversation } from '../../types';
import { KBD } from '../../lib/chat';
import { ConversationItem } from './ConversationItem';
import { PanelIcon, PlusIcon, SearchIcon, SettingsIcon, XIcon } from '../ui/Icons';
import { BrandLogo } from '../ui/BrandLogo';
import { Tooltip } from '../ui/Tooltip';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  isMobile: boolean;
  collapsed: boolean;
  drawerOpen: boolean;
  onCollapse: (v: boolean) => void;
  onCloseDrawer: () => void;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

const DAY = 86_400_000;

function groupByDate(list: Conversation[]) {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: [string, number][] = [
    ['Aujourd’hui', sod], ['Hier', sod - DAY], ['7 derniers jours', sod - 7 * DAY], ['30 derniers jours', sod - 30 * DAY], ['Plus ancien', -Infinity],
  ];
  const out = buckets.map(([label]) => ({ label, items: [] as Conversation[] }));
  [...list].sort((a, b) => b.updatedAt - a.updatedAt).forEach(c => {
    out[buckets.findIndex(([, t]) => c.updatedAt >= t)].items.push(c);
  });
  return out.filter(g => g.items.length);
}

function MiniButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip label={label} placement="right">
      <button className="sb-mini-btn icon-btn ghost" aria-label={label} onClick={onClick}>{children}</button>
    </Tooltip>
  );
}

export const Sidebar = memo(function Sidebar(props: Props) {
  const { conversations, activeId, isMobile, collapsed, drawerOpen, onCollapse, onCloseDrawer, onNewChat, onOpenSearch, onOpenSettings, onSelect, onRename, onDelete } = props;
  const [menuId, setMenuId] = useState<string | null>(null);
  const groups = useMemo(() => groupByDate(conversations), [conversations]);
  const mini = !isMobile && collapsed;

  // Close the ⋯ menu on outside click / Escape.
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: Event) => { if (!(e.target as Element).closest?.('[data-pop]')) setMenuId(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuId(null); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menuId]);

  const cls = ['sidebar', isMobile ? 'drawer' : '', isMobile && drawerOpen ? 'open' : '', mini ? 'collapsed' : ''].filter(Boolean).join(' ');

  return (
    <>
      <aside className={cls} aria-label="Conversations" inert={isMobile && !drawerOpen ? true : undefined}>
        {mini ? (
          <div className="sb-mini">
            <div className="sb-mini-logo"><BrandLogo size={28} /></div>
            <MiniButton label="Ouvrir la barre latérale" onClick={() => onCollapse(false)}><PanelIcon /></MiniButton>
            <MiniButton label="Nouvelle conversation" onClick={onNewChat}><PlusIcon /></MiniButton>
            <MiniButton label="Rechercher" onClick={onOpenSearch}><SearchIcon /></MiniButton>
            <div className="spacer" />
            <MiniButton label="Paramètres" onClick={onOpenSettings}><SettingsIcon /></MiniButton>
          </div>
        ) : (
          <div className="sb-inner">
            <div className="sb-top">
              <div className="sb-brand"><BrandLogo size={28} /><span>Lueur</span></div>
              <button
                className="sb-toggle icon-btn ghost"
                aria-label={isMobile ? 'Fermer le menu' : 'Réduire la barre latérale'}
                onClick={() => (isMobile ? onCloseDrawer() : onCollapse(true))}
              >
                {isMobile ? <XIcon /> : <PanelIcon />}
              </button>
            </div>
            <div className="sb-actions">
              <button className="sb-action primary" onClick={onNewChat}>
                <PlusIcon /><span className="grow">Nouvelle conversation</span><span className="kbd">{KBD.n}</span>
              </button>
              <button className="sb-action secondary" onClick={onOpenSearch}>
                <SearchIcon /><span className="grow">Rechercher</span><span className="kbd">{KBD.k}</span>
              </button>
            </div>
            <nav className="sb-list">
              {groups.map(g => (
                <div key={g.label}>
                  <div className="sb-group">{g.label}</div>
                  {g.items.map(c => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      active={c.id === activeId}
                      menuOpen={menuId === c.id}
                      onOpen={onSelect}
                      onToggleMenu={setMenuId}
                      onRename={onRename}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              ))}
              {conversations.length === 0 && <div className="sb-empty">Vos conversations apparaîtront ici.</div>}
            </nav>
            <div className="sb-bottom">
              <button className="sb-action" onClick={onOpenSettings}><SettingsIcon />Paramètres</button>
            </div>
          </div>
        )}
      </aside>
      {isMobile && drawerOpen && <div className="scrim" onClick={onCloseDrawer} />}
    </>
  );
});
