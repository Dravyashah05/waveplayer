import { useEffect } from 'react';
import { playerEngine } from '../services/playerEngine';
import { matchShortcut, shortcutSeekDelta } from '../services/queueMeta';

/**
 * Queue 2.0 — lightweight transport shortcuts.
 * Space/K toggle, ←/→ seek 10s, N next, P previous. Never fires while
 * typing (inputs, textareas, selects, contentEditable) and never touches
 * audio directly — everything routes through the existing playerEngine.
 */
export function usePlaybackShortcuts(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const action = matchShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: el?.tagName,
        isContentEditable: !!el?.isContentEditable,
      });
      if (!action) return;
      // Space scrolls the page — prevent only when we actually handle it.
      if (e.key === ' ') e.preventDefault();
      try {
        if (action === 'toggle') playerEngine.toggle();
        else if (action === 'next') playerEngine.next();
        else if (action === 'prev') playerEngine.prev();
        else {
          const cur = playerEngine.getSnapshot().progress || 0;
          playerEngine.seek(Math.max(0, cur + shortcutSeekDelta(action)));
        }
      } catch { /* shortcuts never break playback */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
