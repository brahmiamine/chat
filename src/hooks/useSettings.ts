import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../types';
import { loadSettings, saveSettings } from '../lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => { saveSettings(settings); }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch })), []);

  return { settings, update };
}
