import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

/**
 * Tracks the layout viewport width and the *visual* viewport height, so the
 * composer stays above the on-screen keyboard on iOS / Android.
 */
export function useViewport() {
  const read = () => ({ vw: window.innerWidth, vh: window.visualViewport?.height ?? window.innerHeight });
  const [vp, setVp] = useState(read);

  useEffect(() => {
    const vv = window.visualViewport;
    const on = () => {
      setVp(prev => {
        const next = read();
        return prev.vw === next.vw && prev.vh === next.vh ? prev : next;
      });
      // iOS scrolls the page when the keyboard opens; keep the app pinned.
      if (vv && window.scrollY) window.scrollTo(0, 0);
    };
    window.addEventListener('resize', on);
    vv?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      vv?.removeEventListener('resize', on);
    };
  }, []);

  return { ...vp, isMobile: vp.vw < MOBILE_BREAKPOINT };
}
