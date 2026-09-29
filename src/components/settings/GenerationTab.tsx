import type { GenerationSettings } from '../../types';
import { GEN_DEFAULTS } from '../../lib/settings';
import type { SettingsModalProps } from './SettingsModal';

const num = (v: number) => Number(v).toLocaleString('fr-FR');
const fixed = (v: number) => v.toFixed(2);

const DEFS: { key: keyof GenerationSettings; label: string; min: number; max: number; step: number; fmt: (v: number) => string; help: string }[] = [
  { key: 'temperature', label: 'Température', min: 0, max: 2, step: 0.05, fmt: fixed, help: 'Plus élevée : réponses plus variées. Plus basse : plus prévisibles.' },
  { key: 'topP', label: 'Top P', min: 0.05, max: 1, step: 0.05, fmt: fixed, help: 'Limite l’échantillonnage aux tokens les plus probables.' },
  { key: 'maxTokens', label: 'Tokens maximum', min: 128, max: 8192, step: 128, fmt: num, help: 'Longueur maximale d’une réponse.' },
  { key: 'contextSize', label: 'Taille du contexte', min: 1024, max: 32768, step: 1024, fmt: num, help: 'À aligner sur --ctx-size de llama-server. L’historique envoyé est tronqué pour tenir dans cette limite.' },
];

export function GenerationTab({ settings, update }: SettingsModalProps) {
  return (
    <div className="stack">
      {DEFS.map(g => (
        <div key={g.key}>
          <div className="gen-head"><span className="l">{g.label}</span><span className="v">{g.fmt(Number(settings[g.key]))}</span></div>
          <input
            type="range"
            min={g.min}
            max={g.max}
            step={g.step}
            value={settings[g.key]}
            aria-label={g.label}
            onChange={e => update({ [g.key]: Number(e.target.value) })}
          />
          <div className="s-help" style={{ marginTop: 8 }}>{g.help}</div>
        </div>
      ))}
      <div>
        <button className="btn-outline" onClick={() => update({ ...GEN_DEFAULTS })}>Réinitialiser les valeurs par défaut</button>
      </div>
    </div>
  );
}
