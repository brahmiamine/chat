import { useEffect, useState } from 'react';
import type { FontSize, ThemeMode } from '../types';

const query = () => (typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** Applies light/dark (following the OS in "system" mode) and the text size to <html>. */
export function useTheme(theme: ThemeMode, fontSize: FontSize) {
  const [sysDark, setSysDark] = useState(() => !!query()?.matches);

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && sysDark);
    const r = document.documentElement;
    r.dataset.theme = dark ? 'dark' : 'light';
    r.style.colorScheme = dark ? 'dark' : 'light';
    r.style.setProperty('--fs', fontSize + 'px');
  }, [theme, sysDark, fontSize]);
}
