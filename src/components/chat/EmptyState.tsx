import type { ReactNode } from 'react';
import { BugIcon, BulbIcon, CodeIcon, PenLineIcon, StarIcon } from '../ui/Icons';

export function Hero() {
  return (
    <div className="hero">
      <div className="mark"><StarIcon size={30} /></div>
      <h1>Comment puis-je vous aider ?</h1>
    </div>
  );
}

const SUGGESTIONS: { icon: ReactNode; label: string; text: string }[] = [
  { icon: <CodeIcon />, label: 'Écrire du code', text: 'Écris une fonction TypeScript qui ' },
  { icon: <BugIcon />, label: 'Corriger une erreur', text: 'J’ai cette erreur, peux-tu m’aider à la corriger ?\n\n' },
  { icon: <BulbIcon />, label: 'Expliquer un concept', text: 'Explique-moi simplement ' },
  { icon: <PenLineIcon />, label: 'Rédiger un texte', text: 'Rédige un court texte pour ' },
];

export function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="suggestions">
      {SUGGESTIONS.map(s => (
        <button key={s.label} className="chip" onClick={() => onPick(s.text)}>{s.icon}{s.label}</button>
      ))}
    </div>
  );
}
