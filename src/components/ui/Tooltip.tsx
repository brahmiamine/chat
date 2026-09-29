import type { ReactNode } from 'react';

type Placement = 'top' | 'top-left' | 'right' | 'bottom-right';

/** CSS-only hover tooltip (hidden on touch devices). */
export function Tooltip({ label, placement = 'top', children }: { label: string; placement?: Placement; children: ReactNode }) {
  return (
    <div className="tip-wrap">
      {children}
      <div className={`tip ${placement}`} role="tooltip">{label}</div>
    </div>
  );
}
