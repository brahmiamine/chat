import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from 'react';

const THRESHOLD = 60;

/**
 * "Smart" auto-scroll: follows the stream only while the user is at the
 * bottom. Scrolling up detaches it and reveals a "scroll to bottom" button.
 *
 * @param deps values whose change may grow the content (messages, live text).
 * @param resetKey changing it re-attaches to the bottom (e.g. conversation switch).
 */
export function useAutoScroll(deps: unknown[], resetKey: unknown) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  /** True while a programmatic smooth scroll is in flight (its scroll events must not detach). */
  const gliding = useRef(false);
  const [atBottom, setAtBottom] = useState(true);

  useLayoutEffect(() => {
    stick.current = true;
    setAtBottom(true);
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [resetKey, ...deps]);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const at = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;
    if (gliding.current) {
      if (!at) return;
      gliding.current = false;
    }
    stick.current = at;
    setAtBottom(prev => (prev === at ? prev : at));
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    stick.current = true;
    gliding.current = smooth;
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  /** Re-attach without animating (used when the user sends a message). */
  const pin = useCallback(() => { stick.current = true; }, []);

  /** Any direct user gesture cancels a pending programmatic glide. */
  const onUserScrollIntent = useCallback(() => { gliding.current = false; }, []);

  return { ref, onScroll, onUserScrollIntent, atBottom, scrollToBottom, pin };
}
