/**
 * useWakeLock – keep the screen on while `enabled` is true.
 *
 * Uses the Screen Wake Lock API where available. Browsers release the lock
 * whenever the tab is hidden, so it is re-requested on `visibilitychange`.
 * Falls back to a no-op where unsupported (older iOS, or plain-http LAN
 * origins, since the API needs a secure context); `supported` lets the UI
 * show a hint instead.
 */
import { useEffect, useState } from 'react';

type WakeLockState = 'unsupported' | 'active' | 'released';

export function useWakeLock(enabled: boolean): { supported: boolean; state: WakeLockState } {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator && window.isSecureContext;
  const [state, setState] = useState<WakeLockState>(supported ? 'released' : 'unsupported');

  useEffect(() => {
    if (!enabled || !supported) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        setState('active');
        sentinel.addEventListener('release', () => {
          if (!cancelled) setState('released');
        });
      } catch {
        // Denied (battery saver, not visible, policy). Not fatal.
        setState('released');
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled, supported]);

  return { supported, state };
}
