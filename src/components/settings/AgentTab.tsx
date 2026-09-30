import { useCallback, useEffect, useState } from 'react';
import type { MemoryItem } from '../../types';
import { llmApi } from '../../services/llmApi';
import { Segmented } from '../ui/Segmented';
import { PlusIcon, TrashIcon } from '../ui/Icons';
import type { SettingsModalProps } from './SettingsModal';

const EMBEDDINGS_LABEL: Record<string, string> = {
  ready: 'recherche sémantique active',
  downloading: 'modèle d’embeddings en téléchargement (recherche par mots-clés en attendant)',
  starting: 'modèle d’embeddings en démarrage',
  idle: 'recherche par mots-clés',
  error: 'embeddings indisponibles, recherche par mots-clés',
  off: 'embeddings désactivés, recherche par mots-clés',
};

export function AgentTab({ settings, update }: SettingsModalProps) {
  const cfg = { baseUrl: settings.baseUrl, apiKey: settings.apiKey };
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [embeddings, setEmbeddings] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [agentServer, setAgentServer] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const caps = await llmApi.getRouterCapabilities(cfg);
      setAgentServer(caps.agent);
      if (!caps.agent) return;
      const res = await llmApi.listMemories(cfg);
      setMemories(res.memories);
      setEmbeddings(res.embeddings || '');
      setError('');
    } catch (e) {
      setError((e as Error).message || 'Mémoire indisponible');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.baseUrl, settings.apiKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await llmApi.addMemory(cfg, text);
      setDraft('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: number) => {
    setMemories(list => list?.filter(m => m.id !== id) ?? null);
    try { await llmApi.deleteMemory(cfg, id); } catch (e) { setError((e as Error).message); void refresh(); }
  };

  const clear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    try { await llmApi.clearMemories(cfg); await refresh(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="stack lg">
      {agentServer === false && (
        <div className="s-help">
          Le serveur configuré n’est pas le router Lueur (ou il n’est pas joignable) : l’agent, la mémoire et
          les générations en arrière-plan ne sont disponibles qu’avec le router lancé par <code>start-ai.sh</code>.
        </div>
      )}

      <div>
        <div className="s-label">Outils de l’agent</div>
        <Segmented<'on' | 'off'>
          options={[{ value: 'on', label: 'Activés' }, { value: 'off', label: 'Désactivés' }]}
          value={settings.agentEnabled ? 'on' : 'off'}
          onChange={v => update({ agentEnabled: v === 'on' })}
        />
        <div className="s-help below">
          Recherche web, lecture de pages, calculatrice, date, recherche dans les documents joints et en mémoire.
          L’agent tourne sur le téléphone : il continue même si le navigateur est fermé. Phi-4 Mini et
          DeepSeek R1 n’utilisent pas les outils (ils les simulent mal) mais gardent la mémoire et les résumés.
        </div>
      </div>

      <div>
        <div className="s-label">Mémoire long terme</div>
        <Segmented<'on' | 'off'>
          options={[{ value: 'on', label: 'Activée' }, { value: 'off', label: 'Désactivée' }]}
          value={settings.memoryEnabled ? 'on' : 'off'}
          onChange={v => update({ memoryEnabled: v === 'on' })}
        />
        <div className="s-help below">
          Lueur retient les informations durables que vous partagez (préférences, projets, matériel) et les réutilise
          dans les conversations suivantes.
        </div>
      </div>

      {settings.memoryEnabled && (
        <div>
          <div className="s-label">Mémoire avec les modèles cloud</div>
          <Segmented<'local' | 'cloud'>
            options={[{ value: 'local', label: 'Modèles locaux' }, { value: 'cloud', label: 'Aussi le cloud' }]}
            value={settings.memoryCloud ? 'cloud' : 'local'}
            onChange={v => update({ memoryCloud: v === 'cloud' })}
          />
          <div className="s-help below">
            Avec « Aussi le cloud », les souvenirs utiles sont envoyés au fournisseur choisi (Groq, Gemini…).
          </div>
        </div>
      )}

      {agentServer && (
        <div>
          <div className="s-label tight">Souvenirs{memories ? ` (${memories.length})` : ''}</div>
          {embeddings && <div className="s-help" style={{ marginBottom: 10 }}>Recherche : {EMBEDDINGS_LABEL[embeddings] || embeddings}.</div>}
          <div className="memory-add">
            <input
              className="field"
              value={draft}
              maxLength={500}
              placeholder="Ex. Je code surtout en TypeScript"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void add(); }}
            />
            <button className="btn-outline" onClick={() => void add()} disabled={!draft.trim()}><PlusIcon />Ajouter</button>
          </div>
          {error && <div className="s-help memory-error">{error}</div>}
          {memories && !memories.length && <div className="s-help">Aucun souvenir pour l’instant.</div>}
          {!!memories?.length && (
            <ul className="memory-list">
              {memories.map(m => (
                <li key={m.id}>
                  <span className="memory-text">{m.text}</span>
                  {m.source === 'auto' && <span className="memory-src">auto</span>}
                  <button className="icon-btn ghost" aria-label="Oublier ce souvenir" onClick={() => void remove(m.id)}><TrashIcon /></button>
                </li>
              ))}
            </ul>
          )}
          {!!memories?.length && (
            <button className="btn-outline danger" style={{ marginTop: 12 }} onClick={() => void clear()}>
              <TrashIcon />{confirmClear ? 'Confirmer l’effacement' : 'Effacer tous les souvenirs'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
