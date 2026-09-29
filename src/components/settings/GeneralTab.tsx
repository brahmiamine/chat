import { useState } from 'react';
import { IS_MAC, KBD } from '../../lib/chat';
import { TrashIcon } from '../ui/Icons';
import type { SettingsModalProps } from './SettingsModal';

const SHORTCUTS = [
  { label: 'Rechercher une conversation', keys: KBD.k },
  { label: 'Nouvelle conversation', keys: KBD.n + (IS_MAC ? ' · ⇧⌘O' : ' · Ctrl ⇧ O') },
  { label: 'Envoyer', keys: 'Entrée' },
  { label: 'Nouvelle ligne', keys: 'Maj + Entrée' },
  { label: 'Arrêter la génération', keys: 'Échap' },
];

export function GeneralTab({ settings, update, conversationCount, onClearAll }: SettingsModalProps) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="stack lg">
      <div>
        <div className="s-label">Instructions système</div>
        <textarea
          className="field"
          rows={4}
          value={settings.systemPrompt}
          onChange={e => update({ systemPrompt: e.target.value })}
          placeholder="Ex. Réponds en français, de façon concise."
        />
        <div className="s-help below">Envoyées au modèle au début de chaque conversation.</div>
      </div>
      <div>
        <div className="s-label tight">Raccourcis</div>
        {SHORTCUTS.map(k => (
          <div key={k.label} className="shortcut"><span className="l">{k.label}</span><span className="k">{k.keys}</span></div>
        ))}
      </div>
      <div>
        <div className="s-label tight">Données</div>
        <div className="s-help" style={{ marginBottom: 12 }}>
          {conversationCount === 1 ? '1 conversation enregistrée' : `${conversationCount} conversations enregistrées`} localement dans ce navigateur.
        </div>
        <button
          className="btn-outline danger"
          onClick={() => { if (!confirm) setConfirm(true); else { onClearAll(); setConfirm(false); } }}
        >
          <TrashIcon />{confirm ? 'Confirmer l’effacement' : 'Effacer toutes les conversations'}
        </button>
      </div>
    </div>
  );
}
