import React, { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shared destructive-action confirmation (alertdialog semantics, Escape to
 * cancel, focus on the safe action). Replaces native confirm() so dialogs
 * are styled, focus-managed and mobile-friendly everywhere.
 */
export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onCancel,
  onConfirm,
}) => {
  const reduceMotion = useReducedMotion();
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-md safe-bottom safe-top"
        onClick={() => {
          if (!busy) onCancel();
        }}
      >
        <motion.div
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          aria-describedby={body ? 'confirm-dialog-body' : undefined}
          initial={reduceMotion ? undefined : { opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#141416] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.8)]"
        >
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                danger ? 'bg-rose-500/15 text-rose-300' : 'bg-white/10 text-white'
              }`}
              aria-hidden="true"
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-white">{title}</h2>
              {body && (
                <p id="confirm-dialog-body" className="mt-1 text-[13px] leading-relaxed text-white/55">
                  {body}
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-full px-4 py-2 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-40"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold disabled:opacity-40 ${
                danger ? 'bg-rose-500 text-white hover:bg-rose-400' : 'bg-white text-black hover:bg-white/90'
              }`}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
