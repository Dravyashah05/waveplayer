import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownToLine, WifiOff, X, Loader2 } from 'lucide-react';
import { useInstallPrompt, useOnline } from '../hooks/usePwa';

/**
 * PWA chrome: unobtrusive install banner + lightweight connection pill.
 * Neither blocks interaction; the pill is screen-reader announced.
 */
export const PwaChrome: React.FC = () => {
  const { canInstall, install, dismiss } = useInstallPrompt();
  const online = useOnline();

  return (
    <>
      {/* Connection indicator — bottom-left, out of the player's way */}
      <div className="pointer-events-none fixed bottom-[calc(176px+env(safe-area-inset-bottom))] sm:bottom-[calc(172px+env(safe-area-inset-bottom))] lg:bottom-6 left-3 sm:left-4 lg:left-auto lg:right-[calc(50%+330px)] z-30">
        <AnimatePresence>
          {online !== 'online' && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-xl ${
                online === 'offline'
                  ? 'border-amber-500/30 bg-amber-500/15 text-amber-200'
                  : 'border-white/10 bg-black/60 text-white/70'
              }`}
            >
              {online === 'offline' ? <WifiOff className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {online === 'offline' ? 'Offline — cached content available' : 'Reconnecting…'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Install banner — once, dismissable, never modal */}
      <AnimatePresence>
        {canInstall && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-[calc(212px+env(safe-area-inset-bottom))] sm:bottom-[calc(208px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 w-[calc(100%-24px)] max-w-[420px]"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#141416]/95 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-black">
                <ArrowDownToLine className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-white">Install Wave Player</p>
                <p className="truncate text-[11px] text-white/50">Faster startup, offline shell, home-screen access</p>
              </div>
              <button
                type="button"
                onClick={() => void install()}
                className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90"
              >
                Install
              </button>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss install prompt"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
