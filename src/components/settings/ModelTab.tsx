import { useState } from 'react';
import { prettyModel } from '../../lib/settings';
import { RefreshIcon, XIcon } from '../ui/Icons';
import type { SettingsModalProps } from './SettingsModal';

export function ModelTab({ settings: s, update, loadServerInfo }: SettingsModalProps) {
  const [newId, setNewId] = useState('');
  const [importing, setImporting] = useState<string | null>(null);

  const addModel = () => {
    const id = newId.trim();
    if (!id) return;
    if (!s.models.some(m => m.id === id)) update({ models: [...s.models, { id, label: prettyModel(id) }] });
    setNewId('');
  };

  const importModels = async () => {
    setImporting('loading');
    const ids = (await loadServerInfo())?.models || [];
    if (!ids.length) return setImporting('none');
    const have = new Set(s.models.map(m => m.id));
    const add = ids.filter(id => !have.has(id)).map(id => ({ id, label: prettyModel(id) }));
    if (add.length) update({ models: [...s.models, ...add] });
    setImporting(add.length ? (add.length === 1 ? '1 modèle ajouté' : `${add.length} modèles ajoutés`) : 'Liste déjà à jour');
  };

  const importLabel = importing === 'loading' ? 'Recherche…' : importing === 'none' ? 'Aucun modèle trouvé sur le serveur' : importing || 'Importer depuis le serveur';

  return (
    <div className="stack lg">
      <div>
        <div className="s-label tight">Modèles</div>
        <div className="s-help">Le nom affiché remplace l’identifiant technique dans l’interface.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
          {s.models.map(m => {
            const on = m.id === s.modelId;
            return (
              <div key={m.id} className={`model-row${on ? ' on' : ''}`}>
                <button className="pick" aria-label="Utiliser ce modèle" onClick={() => update({ modelId: m.id })}>
                  <span className={`radio${on ? ' on' : ''}`} />
                </button>
                <div className="info">
                  <input
                    value={m.label}
                    aria-label="Nom affiché"
                    placeholder={prettyModel(m.id)}
                    onChange={e => update({ models: s.models.map(x => (x.id === m.id ? { ...x, label: e.target.value } : x)) })}
                  />
                  <div className="id">{m.id}</div>
                </div>
                {s.models.length > 1 && (
                  <button
                    className="rm icon-btn ghost"
                    aria-label="Retirer"
                    onClick={() => {
                      const rest = s.models.filter(x => x.id !== m.id);
                      update({ models: rest, modelId: s.modelId === m.id ? rest[0].id : s.modelId });
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="s-label">Ajouter un modèle</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="field mono"
            style={{ flex: 1, minWidth: 0 }}
            value={newId}
            onChange={e => setNewId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addModel(); }}
            placeholder="Identifiant, ex. Qwen3-8B-Instruct"
            spellCheck={false}
          />
          <button className="btn-outline" onClick={addModel}>Ajouter</button>
        </div>
        <button className="import-btn ghost" onClick={importModels} disabled={importing === 'loading'}>
          <RefreshIcon />{importLabel}
        </button>
      </div>
    </div>
  );
}
