import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/chat';

/** Copies text and exposes a short-lived `copied` flag for the ✓ feedback. */
export function useCopy(duration = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    await copyText(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), duration);
  }, [duration]);
  return { copied, copy };
}
