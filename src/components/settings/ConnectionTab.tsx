import { useState } from 'react';
import type { ProviderKind } from '../../types';
import { currentModel } from '../../lib/settings';
import { statusLabel } from '../chat/ChatHeader';
import { CheckIcon } from '../ui/Icons';
import { Segmented } from '../ui/Segmented';
import type { SettingsModalProps } from './SettingsModal';

export function ConnectionTab({ settings: s, update, health, server, test, onTest }: SettingsModalProps) {
  const [showKey, setShowKey] = useState(false);
  const isDemo = s.provider === 'demo';

  let host = s.baseUrl;
  try { host = new URL(s.baseUrl).host; } catch { /* keep raw */ }
  const srvModel = server.models[0] || (server.modelPath ? String(server.modelPath).split(/[\\/]/).pop() : '') || currentModel(s).id;
  const isLlamaCpp = !!(server.modelPath || server.nCtx);
  const rows = [
    { k: 'Statut', v: statusLabel(health) },
    { k: 'Modèle', v: srvModel },
    { k: 'API', v: isLlamaCpp ? 'llama.cpp · compatible OpenAI' : 'Compatible OpenAI' },
    { k: 'Point d’accès', v: host },
  ];
  if (server.nCtx) rows.push({ k: 'Contexte serveur', v: Number(server.nCtx).toLocaleString('fr-FR') + ' tokens' });

  return (
    <div className="stack">
      <div>
        <div className="s-label seg-gap">Source</div>
        <Segmented<ProviderKind>
          options={[{ value: 'openai-compatible', label: 'llama-server' }, { value: 'demo', label: 'Démo hors ligne' }]}
          value={s.provider}
          onChange={v => update({ provider: v })}
        />
      </div>
      {isDemo ? (
        <div className="s-help" style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: -12 }}>
          Les réponses sont simulées localement, sans serveur. Pratique pour tester l’interface.
        </div>
      ) : (
        <div className="stack md">
          <div>
            <div className="s-label">URL du serveur</div>
            <input
              className="field mono"
              value={s.baseUrl}
              onChange={e => update({ baseUrl: e.target.value })}
              placeholder="http://192.168.1.98:8080"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div>
            <div className="s-label">Clé API</div>
            <div className="key-wrap">
              <input
                className="field mono"
                type={showKey ? 'text' : 'password'}
                value={s.apiKey}
                onChange={e => update({ apiKey: e.target.value })}
                placeholder="Optionnelle"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="key-toggle ghost" onClick={() => setShowKey(v => !v)}>{showKey ? 'Masquer' : 'Afficher'}</button>
            </div>
          </div>
          <div>
            <button className="btn-solid" onClick={onTest} disabled={test.state === 'testing'}>
              {test.state === 'testing' ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            {test.state === 'ok' && <div className="test-ok"><CheckIcon />Connecté</div>}
            {test.state === 'fail' && (
              <div className="test-fail" role="alert">
                <div className="t">Échec de la connexion</div>
                <div className="m">{test.message}</div>
              </div>
            )}
          </div>
          <div>
            <div className="s-label seg-gap">Serveur</div>
            <div className="server-card">
              {rows.map(r => (
                <div key={r.k} className="server-row"><span className="k">{r.k}</span><span className="v">{r.v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
