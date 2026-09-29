import type { ReactNode } from 'react';

export interface SegOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function Segmented<T extends string | number>({ options, value, onChange }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(o => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
