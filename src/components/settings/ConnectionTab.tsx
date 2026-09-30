import { useState } from 'react';
import type { ProviderKind } from '../../types';
import { currentModel } from '../../lib/settings';
import { statusLabel } from '../chat/ChatHeader';
import { AlertIcon, CheckIcon, EyeIcon, EyeOffIcon, PlugIcon } from '../ui/Icons';
import { Segmented } from '../ui/Segmented';
import type { SettingsModalProps } from './SettingsModal';

export function ConnectionTab({ settings: s, update, health, server, test, onTest }: SettingsModalProps) {
  const [showKey, setShowKey] = useState(false);
  const isDemo = s.provider === 'demo';
  const selected = currentModel(s);

  let host = s.baseUrl;
  try { host = new URL(s.baseUrl).host; } catch { /* keep raw */ }

  const selectedProvider = selected.provider || 'custom';
  const providerState = server.providers?.[selectedProvider];
  const providerName = selected.providerLabel || providerState?.label || selectedProvider;

  const rows = [
    { k: 'Statut', v: statusLabel(health) },
    { k: 'Modèle sélectionné', v: selected.label },
    { k: 'Fournisseur', v: providerName },
    { k: 'API', v: 'Lueur Router · compatible OpenAI' },
    { k: 'Point d’accès', v: host },
  ];
  if (server.nCtx && selectedProvider === 'local') {
    rows.push({ k: 'Contexte local', v: Number(server.nCtx).toLocaleString('fr-FR') + ' tokens' });
  }

  const providers = Object.values(server.providers || {});

  return (
    <div className="stack">
      <div>
        <div className="s-label seg-gap">Source</div>
        <Segmented<ProviderKind>
          options={[{ value: 'openai-compatible', label: 'Router Lueur' }, { value: 'demo', label: 'Démo hors ligne' }]}
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
            <div className="s-label">URL du router</div>
            <input
              className="field mono"
              value={s.baseUrl}
              onChange={e => update({ baseUrl: e.target.value })}
              placeholder="https://votre-url.ngrok.app"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="s-help">
              En accès ngrok, utilisez l’URL publique. Quand Lueur est servie directement par le router, l’application utilise automatiquement la même origine.
            </div>
          </div>

          <div>
            <div className="s-label">Clé API du router</div>
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
              <button className="key-toggle icon-btn ghost" aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'} onClick={() => setShowKey(v => !v)}>
                {showKey ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <div className="s-help">
              Les clés Groq, Gemini, Mistral, OpenRouter, Cloudflare, Cerebras, Hugging Face, NVIDIA, Cohere et Vercel restent côté Termux dans <code>~/.lueur.env</code>.
            </div>
          </div>

          <div>
            <button className="btn-solid" onClick={onTest} disabled={test.state === 'testing'}>
              {test.state === 'testing' ? <span className="spinner sm" /> : <PlugIcon />}
              {test.state === 'testing' ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            {test.state === 'ok' && <div className="test-ok"><CheckIcon />Connecté</div>}
            {test.state === 'fail' && (
              <div className="test-fail" role="alert">
                <AlertIcon size={16} />
                <div>
                  <div className="t">Échec de la connexion</div>
                  <div className="m">{test.message}</div>
                </div>
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

          {providers.length > 0 && (
            <div>
              <div className="s-label seg-gap">Fournisseurs IA</div>
              <div className="s-help" style={{ marginBottom: 8 }}>
                Les modèles restent visibles même sans clé. « Configuré » signifie que le router a trouvé les variables nécessaires au démarrage.
              </div>
              <div className="server-card">
                {providers.map(p => (
                  <div key={p.id} className="server-row">
                    <span className="k">{p.label}</span>
                    <span className="v">
                      {p.configured ? '✓ Configuré' : `À configurer · ${p.missing.join(', ')}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
