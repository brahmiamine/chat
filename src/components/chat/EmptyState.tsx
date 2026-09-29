import type { ReactNode } from 'react';
import { BugIcon, BulbIcon, CodeIcon, ImageIcon } from '../ui/Icons';
import { BrandLogo } from '../ui/BrandLogo';

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bonjour';
  if (h >= 12 && h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

export function Hero() {
  return (
    <div className="hero">
      <div className="hero-mark"><BrandLogo size={52} /></div>
      <p className="hero-kicker">{greeting()} 👋</p>
      <h1>Comment puis‑je vous aider&nbsp;?</h1>
    </div>
  );
}

const SUGGESTIONS: { icon: ReactNode; label: string; sub: string; text: string; tone: string }[] = [
  { icon: <CodeIcon />, label: 'Écrire du code', sub: 'Fonction, script, composant', text: 'Écris une fonction TypeScript qui ', tone: 'blue' },
  { icon: <BugIcon />, label: 'Corriger une erreur', sub: 'Collez le message d’erreur', text: 'J’ai cette erreur, peux-tu m’aider à la corriger ?\n\n', tone: 'red' },
  { icon: <ImageIcon />, label: 'Analyser une image', sub: 'Capture, photo, schéma', text: 'Décris et analyse l’image jointe : ', tone: 'green' },
  { icon: <BulbIcon />, label: 'Expliquer un concept', sub: 'Simplement, avec exemples', text: 'Explique-moi simplement ', tone: 'amber' },
];

export function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="suggestions">
      {SUGGESTIONS.map((s, i) => (
        <button key={s.label} className="suggest" style={{ animationDelay: `${80 + i * 50}ms` }} onClick={() => onPick(s.text)}>
          <span className={`suggest-ico t-${s.tone}`}>{s.icon}</span>
          <span className="suggest-txt">
            <span className="l">{s.label}</span>
            <span className="s">{s.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
