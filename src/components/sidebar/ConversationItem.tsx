import { memo, useEffect, useRef, useState } from 'react';
import type { Conversation } from '../../types';
import { MoreIcon, PencilIcon, TrashIcon } from '../ui/Icons';

interface Props {
  conversation: Conversation;
  active: boolean;
  menuOpen: boolean;
  onOpen: (id: string) => void;
  onToggleMenu: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export const ConversationItem = memo(function ConversationItem({ conversation: c, active, menuOpen, onOpen, onToggleMenu, onRename, onDelete }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(c.title);
  const [confirmDel, setConfirmDel] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!menuOpen) setConfirmDel(false); }, [menuOpen]);
  useEffect(() => {
    if (renaming) { input.current?.focus(); input.current?.select(); }
  }, [renaming]);

  const commit = () => {
    if (!renaming) return;
    setRenaming(false);
    onRename(c.id, value);
  };

  return (
    <div className={`conv${active ? ' active' : ''}${menuOpen ? ' menu-open' : ''}`} data-pop={menuOpen ? '' : undefined}>
      {renaming ? (
        <input
          ref={input}
          className="conv-rename"
          value={value}
          aria-label="Nouveau titre"
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setRenaming(false); }
          }}
        />
      ) : (
        <>
          <button className={`conv-btn${active ? ' active' : ''}`} onClick={() => onOpen(c.id)} title={c.title}>{c.title}</button>
          <button
            className="conv-dots icon-btn ghost"
            aria-label="Options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={e => { e.stopPropagation(); onToggleMenu(menuOpen ? null : c.id); }}
          >
            <MoreIcon />
          </button>
        </>
      )}
      {menuOpen && (
        <div className="conv-menu menu" role="menu">
          <button role="menuitem" className="menu-item" onClick={() => { setValue(c.title); setRenaming(true); onToggleMenu(null); }}>
            <PencilIcon />Renommer
          </button>
          <button
            role="menuitem"
            className="menu-item danger"
            onClick={() => { if (!confirmDel) setConfirmDel(true); else { onToggleMenu(null); onDelete(c.id); } }}
          >
            <TrashIcon />{confirmDel ? 'Confirmer la suppression' : 'Supprimer'}
          </button>
        </div>
      )}
    </div>
  );
});
