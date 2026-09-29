import type { FontSize, ThemeMode } from '../../types';
import { MonitorIcon, MoonIcon, SunIcon } from '../ui/Icons';
import { Segmented } from '../ui/Segmented';
import type { SettingsModalProps } from './SettingsModal';

export function AppearanceTab({ settings, update }: SettingsModalProps) {
  return (
    <div className="stack">
      <div>
        <div className="s-label seg-gap">Thème</div>
        <Segmented<ThemeMode>
          options={[
            { value: 'system', label: 'Système', icon: <MonitorIcon /> },
            { value: 'light', label: 'Clair', icon: <SunIcon /> },
            { value: 'dark', label: 'Sombre', icon: <MoonIcon /> },
          ]}
          value={settings.theme}
          onChange={v => update({ theme: v })}
        />
      </div>
      <div>
        <div className="s-label seg-gap">Taille du texte</div>
        <Segmented<FontSize>
          options={[{ value: 15, label: 'Compact' }, { value: 16, label: 'Normal' }, { value: 17, label: 'Grand' }]}
          value={settings.fontSize}
          onChange={v => update({ fontSize: v })}
        />
      </div>
    </div>
  );
}
