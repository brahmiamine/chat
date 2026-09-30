import { useState } from 'react';
import { prettyModel } from '../../lib/settings';
import { PlusIcon, RefreshIcon, TrashIcon } from '../ui/Icons';
import type { ModelEntry, ModelProviderId } from '../../types';
import type { SettingsModalProps } from './SettingsModal';

const KNOWN_PROVIDERS = new Set<ModelProviderId>([
  'local', 'groq', 'gemini', 'mistral', 'openrouter', 'cloudflare', 'cerebras', 'huggingface',
  'nvidia', 'cohere', 'vercel',
]);

function inferredProvider(id: string): ModelProviderId {
  const prefix = id.includes('::') ? id.split('::', 1)[0] as ModelProviderId : 'custom';
  return KNOWN_PROVIDERS.has(prefix) ? prefix : 'custom';
}

function technicalId(id: string) {
  return id.replace(/^[a-z]+::/i, '');
}

export function ModelTab({ settings: s, update, loadServerInfo, server }: SettingsModalProps) {
  const [newId, setNewId] = useState('');
  const [importing, setImporting] = useState<string | null>(null);

  const addModel = () => {
    const id = newId.trim();
    if (!id) return;
    if (!s.models.some(m => m.id === id)) {
      update({ models: [...s.models, { id, label: prettyModel(id), provider: inferredProvider(id) }] });
    }
    setNewId('');
  };

  const importModels = async () => {
    setImporting('loading');
    const ids = (await loadServerInfo())?.models || [];
    if (!ids.length) return setImporting('none');
    const have = new Set(s.models.map(m => m.id));
    const add: ModelEntry[] = ids
      .filter(id => !have.has(id))
      .map(id => ({ id, label: prettyModel(id), provider: inferredProvider(id) }));
    if (add.length) update({ models: [...s.models, ...add] });
    setImporting(add.length ? (add.length === 1 ? '1 modèle ajouté' : `${add.length} modèles ajoutés`) : 'Liste déjà à jour');
  };

  const importLabel = importing === 'loading'
    ? 'Recherche…'
    : importing === 'none'
      ? 'Aucun modèle trouvé sur le serveur'
      : importing || 'Importer depuis le serveur';

  return (
    <div className="stack lg">
      <div>
        <div className="s-label tight">Modèles</div>
        <div className="s-help">
          Les modèles locaux tournent sur le téléphone. Les modèles cloud passent par le router Termux :
          les clés restent dans <code>~/.lueur.env</code>, jamais dans le navigateur.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
          {s.models.map(m => {
            const on = m.id === s.modelId;
            const provider = m.provider || inferredProvider(m.id);
            const state = server.providers?.[provider];
            const providerName = m.providerLabel || state?.label || (provider === 'custom' ? 'Personnalisé' : provider);
            const readiness = provider === 'local'
              ? 'prêt'
              : state
                ? (state.configured ? 'configuré' : 'clé requise')
                : 'cloud';

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
                  <div className="id">{providerName} · {readiness} · {technicalId(m.id)}</div>
                </div>
                {s.models.length > 1 && (
                  <button
                    className="rm icon-btn ghost"
                    aria-label={`Retirer ${m.label || m.id}`}
                    onClick={() => {
                      const rest = s.models.filter(x => x.id !== m.id);
                      update({ models: rest, modelId: s.modelId === m.id ? rest[0].id : s.modelId });
                    }}
                  >
                    <TrashIcon size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="s-label">Ajouter un modèle</div>
        <div className="s-help">
          Pour un modèle géré par le router, utilisez son identifiant retourné par « Importer depuis le serveur ».
        </div>
        <div className="add-row">
          <input
            className="field mono"
            style={{ flex: 1, minWidth: 0 }}
            value={newId}
            onChange={e => setNewId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addModel(); }}
            placeholder="Identifiant du modèle"
            spellCheck={false}
          />
          <button className="btn-outline" onClick={addModel} disabled={!newId.trim()}><PlusIcon size={16} />Ajouter</button>
        </div>
        <button className="import-btn ghost" onClick={importModels} disabled={importing === 'loading'}>
          {importing === 'loading' ? <span className="spinner sm" /> : <RefreshIcon />}{importLabel}
        </button>
      </div>
    </div>
  );
}
